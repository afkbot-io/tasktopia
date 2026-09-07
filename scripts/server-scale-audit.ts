import { performance } from "node:perf_hooks";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { AppService } from "../src/server/app-service";
import { loginUser, registerUser } from "../src/server/auth";
import { createDb, type Db, type Row } from "../src/server/db";

// Explicit, reusable, local-only fixtures: no production URLs, default schema,
// imported spatial rows, or deletion of existing demo countries.
const tiers = {
  a: { cities: 1, tasks: 100, districts: 6 },
  b: { cities: 1, tasks: 1000, districts: 20 },
  c: { cities: 10, tasks: 100, districts: 6 },
  d: { cities: 100, tasks: 10, districts: 3 },
  e: { cities: 1, tasks: 1000, districts: 1 },
} as const;
const tier = (process.env.PERF_TIER ?? "a") as keyof typeof tiers;
if (!Object.hasOwn(tiers, tier)) throw new Error("PERF_TIER must be a, b, c, d or e");
if (Number(process.versions.node.split(".")[0]) < 24) throw new Error("Server scale evidence requires the supported Node 24+ runtime");
const workload = tiers[tier];
const databaseUrl = new URL(process.env.TEST_DATABASE_URL ?? "postgres://tasktopia:tasktopia@127.0.0.1:5432/tasktopia_test");
if (!["127.0.0.1", "localhost", "::1"].includes(databaseUrl.hostname)
  || !databaseUrl.pathname.endsWith("_test") || databaseUrl.search) {
  throw new Error("Use a local *_test database URL without schema/options");
}
const schema = process.env.PERF_SCHEMA ?? `release_perf_20260905_${tier}`;
if (!/^release_perf_\d{8}_[a-e]$/.test(schema)) throw new Error("Explicit release_perf_YYYYMMDD_<tier> schema required");
const output = process.env.PERF_OUTPUT ?? `/tmp/tasktopia-server-scale-${tier}.json`;
const samples = 20;
const existingOnly = process.env.PERF_EXISTING_ONLY === "1";
const admin = await createDb(databaseUrl.toString(), { migrate: false, maxConnections: 1 });
const exists = await admin.prepare("SELECT 1 FROM information_schema.schemata WHERE schema_name=?").get(schema);
if (!exists && existingOnly) throw new Error("Existing-only measurements require an already created fixture schema");
if (!exists) await admin.exec(`CREATE SCHEMA "${schema}"`);
await admin.close();
const db = await createDb(databaseUrl.toString(), { schema, maxConnections: 10 });

type QueryTrace = { query: string; parameters: unknown[]; ms: number };
let traces: QueryTrace[] = [];
const measuredDb: Db = {
  prepare(query) {
    const statement = db.prepare(query);
    const measure = async <T>(parameters: unknown[], run: () => Promise<T>): Promise<T> => {
      const start = performance.now();
      try { return await run(); }
      finally { traces.push({ query, parameters, ms: performance.now() - start }); }
    };
    return {
      all: <T extends Row>(...parameters: unknown[]) => measure(parameters, () => statement.all<T>(...parameters)),
      get: <T extends Row>(...parameters: unknown[]) => measure(parameters, () => statement.get<T>(...parameters)),
      run: (...parameters) => measure(parameters, () => statement.run(...parameters)),
    };
  },
  exec: query => db.exec(query),
  transaction: callback => db.transaction(callback),
  close: async () => undefined,
};
const percentile = (values: number[], fraction: number) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1]!;
const report: Record<string, unknown> = { tier, schema, workload, node: process.version, platform: process.platform, samples,
  budgetsMs: { taskOpenP95: 100, cityWarmP95: 150, countryWarmP95: 150, planetP95: 100,
    cityCold: 2000, countryCold: workload.cities === 100 ? 5000 : 2000, stageUpdateP95: workload.tasks === 1000 ? 750 : 250 } };
const operationBudgets: Record<string, number> = { taskOpen: 100, cityWarm: 150, countryWarm: 150, planet: 100,
  cityCold: 2000, countryCold: workload.cities === 100 ? 5000 : 2000, stageUpdate: workload.tasks === 1000 ? 750 : 250 };
const budgetFailures: Array<{ operation: string; measuredMs: number; budgetMs: number }> = [];
const sources = ["src/server/app-service.ts","src/server/task-detail-read.ts","src/server/db.ts",
  "src/server/world/active-block-layout.ts","src/server/world/block-layout-compiler.ts","src/server/world/compact-city-site.ts",
  "src/server/world/intercity-road-store.ts","src/server/world/intercity-road-planner.ts",
  "src/server/world/country-road-projection.ts","src/shared/district-separator.ts",
  "src/shared/compact-building-families.ts","src/shared/block-parcel-plan.ts","src/shared/block-templates.ts",
  "migrations/postgres/0025_task_history_read_index.sql","migrations/postgres/0029_country_road_snapshots.sql",
  "scripts/server-scale-audit.ts"];
const fingerprints = async () => Object.fromEntries(await Promise.all(sources.map(async path => [path,
  createHash("sha256").update(await readFile(path)).digest("hex")])));
report.sourceFingerprints = await fingerprints();
const plans = new Map<string, QueryTrace>();
async function measure(name: string, operation: (index: number) => Promise<unknown>, repetitions = samples) {
  const elapsed: number[] = [], counts: number[] = [], sqlMs: number[] = [];
  const countryLockWait: number[] = [];
  let payload: unknown;
  for (let index = 0; index < repetitions; index++) {
    traces = [];
    const start = performance.now();
    payload = await operation(index);
    elapsed.push(performance.now() - start);
    counts.push(traces.length);
    sqlMs.push(traces.reduce((sum, trace) => sum + trace.ms, 0));
    countryLockWait.push(...traces.filter(trace => /FROM countries[^]*FOR UPDATE/.test(trace.query)).map(trace => trace.ms));
    for (const trace of traces) if (/^\s*(SELECT|WITH)\b/.test(trace.query) && !/FOR UPDATE|FOR KEY SHARE|pg_advisory|DELETE|UPDATE|INSERT/.test(trace.query)) {
      const previous = plans.get(trace.query);
      if (!previous || previous.ms < trace.ms) plans.set(trace.query, trace);
    }
  }
  const wire = JSON.stringify(payload);
  const value = { p50Ms: percentile(elapsed, .5), p95Ms: percentile(elapsed, .95), maxMs: Math.max(...elapsed),
    queriesMin: Math.min(...counts), queriesMax: Math.max(...counts), sqlP95Ms: percentile(sqlMs, .95),
    bytes: Buffer.byteLength(wire), gzipBytes: gzipSync(wire).length,
    ...(countryLockWait.length ? { countryLockWaitP95Ms: percentile(countryLockWait,.95) } : {}) };
  report[name] = value;
  const budgetMs = operationBudgets[name];
  if (budgetMs !== undefined && value.p95Ms > budgetMs) budgetFailures.push({ operation: name, measuredMs: value.p95Ms, budgetMs });
  console.log(JSON.stringify({ operation: name, ...value }));
}

try {
  const email = `release-scale-${tier}@tasktopia.local`;
  const password = "local-scale-fixture-only";
  const existing = await db.prepare("SELECT id FROM users WHERE email=?").get(email);
  const user = existing
    ? (await loginUser(db, email, password)).user
    : (await registerUser(db, { email, password, name: "Local scale fixture", countryName: `Scale ${tier}` })).user;
  if (!existing) await db.prepare("UPDATE countries SET seed=424242 WHERE id=?").run(user.countryId);
  const writer = new AppService(db);
  const seedStarted = performance.now();
  const initialCities = new Map((await writer.listCities(user.countryId)).map(city => [city.name, city]));
  for (let cityIndex = 0; !existingOnly && cityIndex < workload.cities; cityIndex++) {
    const name = `Scale city ${cityIndex + 1}`;
    const city = initialCities.get(name) ?? await writer.createCity(user.countryId, { name, idempotencyKey: `city-${cityIndex}` });
    const currentDistricts = new Map((await writer.listDistricts(user.countryId, city.id)).map(district => [district.name, district]));
    const districts = [];
    for (let index = 0; index < workload.districts; index++) {
      const districtName = `Scale district ${index + 1}`;
      districts.push(currentDistricts.get(districtName) ?? await writer.createDistrict(user.countryId, {
        cityId: city.id, name: districtName, activate: index === 0, idempotencyKey: `district-${cityIndex}-${index}`,
      }));
    }
    const existingTasks = new Set((await writer.listTasks(user.countryId)).filter(task => task.cityId === city.id).map(task => task.title));
    for (let index = 0; index < workload.tasks; index++) {
      const title = `Scale task ${cityIndex + 1}.${index + 1}`;
      if (existingTasks.has(title)) continue;
      await writer.createTask(user.countryId, { cityId: city.id, districtId: districts[index % districts.length]!.id,
        title, estimate: 1, idempotencyKey: `task-${cityIndex}-${index}` });
      if ((index + 1) % 100 === 0) console.log(JSON.stringify({ seededCity: cityIndex + 1, seededTasks: index + 1 }));
    }
    console.log(JSON.stringify({ cityComplete: cityIndex + 1, cities: workload.cities }));
  }
  report.seedMs = performance.now() - seedStarted;
  const fixtureTables = await db.prepare(`SELECT table_name FROM information_schema.tables
    WHERE table_schema=? AND table_type='BASE TABLE'`).all<{ table_name: string }>(schema);
  for (const { table_name: table } of fixtureTables) {
    if (!/^[a-z0-9_]+$/.test(table)) throw new Error("Unexpected fixture table identifier");
    await db.exec(`ANALYZE "${schema}"."${table}"`);
  }
  const cities = await writer.listCities(user.countryId);
  const counts = await db.prepare(`SELECT (SELECT count(*) FROM cities_v3) AS cities,
    (SELECT count(*) FROM districts_v3) AS districts,(SELECT count(*) FROM tasks_v3) AS tasks`).get();
  report.actualWorkload = counts;
  report.requestedWorkloadComplete = Number(counts!.cities) === workload.cities
    && Number(counts!.districts) === workload.cities * workload.districts
    && Number(counts!.tasks) === workload.cities * workload.tasks;
  if (!report.requestedWorkloadComplete) throw new Error("Measured fixture does not contain the complete requested cities, districts and tasks");
  const taskRows = await db.prepare("SELECT t.id,t.status,t.city_id FROM tasks_v3 t JOIN districts_v3 d ON d.id=t.district_id WHERE d.status='ACTIVE' ORDER BY t.task_number").all();
  const target = taskRows[0]!;
  // These rows are disposable fixture projections. Clear only this dedicated
  // country's caches so repeated before/after runs measure an actual cold build.
  await db.prepare("DELETE FROM world_chunk_payloads_v1 WHERE country_id=?").run(user.countryId);
  await db.prepare("DELETE FROM country_overview_snapshots_v1 WHERE country_id=?").run(user.countryId);
  const service = new AppService(measuredDb);
  await measure("cityCold", () => service.getCityScene(user.countryId, cities[0]!.id), 1);
  await measure("countryCold", () => service.getCountryOverview(user.id, user.countryId), 1);
  for (let index = 0; index < 3; index++) {
    await service.getTask(user.countryId, String(target.id));
    await service.getCityScene(user.countryId, cities[0]!.id);
    await service.getCountryOverview(user.id, user.countryId);
    await service.getPlanetAtlas(user.id);
  }
  await measure("taskOpen", () => service.getTask(user.countryId, String(target.id)));
  await measure("cityWarm", () => service.getCityScene(user.countryId, cities[0]!.id));
  await measure("countryWarm", () => service.getCountryOverview(user.id, user.countryId));
  await measure("planet", () => service.getPlanetAtlas(user.id));
  await measure("taskOpenConcurrent8", () => Promise.all(Array.from({ length: 8 }, () => service.getTask(user.countryId, String(target.id)))), 5);
  await measure("cityRestartPublished", () => new AppService(measuredDb).getCityScene(user.countryId, cities[0]!.id), 3);
  if (target.status === "PLANNING") await writer.updateTaskStatus(user.countryId, { taskId: String(target.id), status: "STARTED", idempotencyKey: "perf-start" });
  if (target.status === "PLANNING" || target.status === "STARTED") await writer.updateTaskStatus(user.countryId, { taskId: String(target.id), status: "IN_PROGRESS", idempotencyKey: "perf-in-progress" });
  const run = Date.now();
  await measure("stageUpdate", index => service.updateTaskStatus(user.countryId, {
    taskId: String(target.id), status: "IN_PROGRESS", progress: 40 + index,
    idempotencyKey: `perf-progress-${run}-${index}`,
  }));
  const second = taskRows.find(row => row.city_id !== target.city_id) ?? taskRows[1];
  if (second) {
    if (second.status === "PLANNING") await writer.updateTaskStatus(user.countryId, { taskId: String(second.id), status: "STARTED", idempotencyKey: `perf-start-${second.id}` });
    if (second.status === "PLANNING" || second.status === "STARTED") await writer.updateTaskStatus(user.countryId, { taskId: String(second.id), status: "IN_PROGRESS", idempotencyKey: `perf-progress-${second.id}` });
    await measure("stageUpdateConcurrent2", index => Promise.all([target,second].map(row => service.updateTaskStatus(user.countryId, {
      taskId: String(row.id), status: "IN_PROGRESS", progress: 45 + index,
      idempotencyKey: `perf-concurrent-${run}-${row.id}-${index}`,
    }))), 5);
  }
  const explain = [];
  for (const trace of [...plans.values()].sort((a, b) => b.ms - a.ms).slice(0, 12)) {
    const plan = await db.transaction(async () => {
      await db.exec("SET TRANSACTION READ ONLY");
      await db.exec("SET LOCAL statement_timeout='5s'");
      await db.exec("SET LOCAL lock_timeout='1s'");
      return db.prepare(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${trace.query}`).all(...trace.parameters);
    });
    explain.push({ query: trace.query, observedMs: trace.ms, plan });
  }
  report.explain = explain;
  report.memory = process.memoryUsage();
  report.finishedAt = new Date().toISOString();
  report.sourcesUnchangedDuringMeasurement = JSON.stringify(report.sourceFingerprints) === JSON.stringify(await fingerprints());
  report.budgetFailures = budgetFailures;
  report.accepted = report.requestedWorkloadComplete === true && report.sourcesUnchangedDuringMeasurement === true && budgetFailures.length === 0;
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ report: output, schema, retainedForComparison: true }));
  if (budgetFailures.length || report.sourcesUnchangedDuringMeasurement !== true) process.exitCode = 1;
} catch (error) {
  report.error = error instanceof Error ? { message: error.message, stack: error.stack } : String(error);
  report.partialFixture = await db.prepare(`SELECT c.id,c.center_x,c.center_y,c.bounds_json,
    (SELECT count(*) FROM tasks_v3 t WHERE t.city_id=c.id) AS tasks,
    (SELECT count(*) FROM districts_v3 d WHERE d.city_id=c.id) AS districts
    FROM cities_v3 c ORDER BY c.created_at`).all();
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  throw error;
} finally { await db.close(); }
