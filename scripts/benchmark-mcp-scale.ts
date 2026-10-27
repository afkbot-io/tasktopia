/** Локальный MCP benchmark: изолированная схема, 10 городов × 1000 задач.
 * SQL добавляет только рабочие данные; участки/входы/дороги создаёт штатный
 * synchronizeCityBlocks. Fixture сохраняется для сопоставимого before/after.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createDb, type Db, type Row } from "../src/server/db";
import { createMcpServer } from "../src/server/mcp";
import { blockTaskGeometry, readActiveBlockLayout, synchronizeCityBlocks } from "../src/server/world/active-block-layout";

const label = process.argv.find(value => value.startsWith("--label="))?.slice(8) ?? "candidate";
assert.match(label, /^[a-z0-9-]{1,40}$/);
assert.ok(Number(process.versions.node.split(".")[0]) >= 24, "Use supported Node 24+");
assert.ok(process.env.TEST_DATABASE_URL, "TEST_DATABASE_URL is required");
const target = new URL(process.env.TEST_DATABASE_URL);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)
  && (target.pathname.endsWith("_test") || /^\/mcp_scale_\d{8}$/.test(target.pathname)) && !target.search,
  "Only a local dedicated *_test or mcp_scale_YYYYMMDD database is accepted");
const schema = "mcp_scale_20261028";
const folder = ".builder/mcp-scale-10000-20261028/performance";
await mkdir(folder, { recursive: true });
const admin = await createDb(target.toString(), { migrate: false, maxConnections: 1 });
await admin.exec(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
await admin.close();
const db = await createDb(target.toString(), { schema, maxConnections: 4 });
const sourcePaths = ["src/server/app-service.ts", "src/server/task-list-read.ts", "src/server/task-detail-read.ts",
  "src/server/world/active-block-layout.ts", "src/server/mcp.ts", "src/server/db.ts"];
type Trace = { query: string; rows: number; bytes: number; ms: number; geometryPlacements: number; geometryBlocks: number };
let traces: Trace[] = [];
const measured: Db = {
  prepare(query) {
    const statement = db.prepare(query);
    const record = async <T>(run: () => Promise<T>): Promise<T> => {
      const start = performance.now();
      const value = await run();
      const rows = Array.isArray(value) ? value : value && typeof value === "object" && "rows" in value ? value.rows : value ? [value] : [];
      const records = rows as Row[];
      traces.push({ query, rows: records.length, bytes: Buffer.byteLength(JSON.stringify(value) ?? ""), ms: performance.now() - start,
        geometryPlacements: records.reduce((sum, row) => sum + (Array.isArray(row.placements) ? row.placements.length
          : Array.isArray(row.selected_placements) ? row.selected_placements.length : 0), 0),
        geometryBlocks: records.reduce((sum, row) => sum + (Array.isArray(row.blocks) ? row.blocks.length : query.includes("city_blocks_v1") ? 1 : 0), 0) });
      return value;
    };
    return { all: <T extends Row>(...args: unknown[]) => record(() => statement.all<T>(...args)),
      get: <T extends Row>(...args: unknown[]) => record(() => statement.get<T>(...args)),
      run: (...args) => record(() => statement.run(...args)) };
  },
  exec: query => db.exec(query), transaction: callback => db.transaction(callback), close: async () => undefined,
};
const stats = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { p50: sorted[Math.ceil(sorted.length * .5) - 1]!, p95: sorted[Math.ceil(sorted.length * .95) - 1]!, max: sorted.at(-1)! };
};
const report: Record<string, unknown> = { label, schema, node: process.version, requestedTasks: 10_000,
  revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), startedAt: new Date().toISOString(),
  transport: "MCP InMemoryTransport (network-independent handler/SQL evidence)", samples: 20, poolConnections: 4 };
let client: Client | undefined;
let mcp: Awaited<ReturnType<typeof createMcpServer>> | undefined;
try {
  const email = "mcp-scale-10000@example.test";
  let owner = await db.prepare("SELECT id,active_country_id FROM users WHERE email=?").get<Row>(email);
  if (!owner) {
    const created = await registerUser(db, { email, password: "local-mcp-scale-fixture-only", name: "Локальный MCP benchmark" });
    owner = { id: created.user.id, active_country_id: created.user.countryId };
    await db.prepare("UPDATE countries SET seed=424242 WHERE id=?").run(created.user.countryId);
  }
  const userId = String(owner.id), countryId = String(owner.active_country_id);
  const writer = new AppService(db);
  const seededAt = performance.now();
  const selected: Array<{ cityId: string; taskId: string; districtId: string }> = [];
  for (let index = 0; index < 10; index++) {
    const name = `MCP scale city ${index + 1}`;
    const city = (await writer.listCities(countryId)).find(value => value.name === name)
      ?? await writer.createCity(countryId, { name, morphology: "DENSE_CORE", idempotencyKey: `mcp-scale-city-${index}` });
    const district = (await writer.listDistricts(countryId, city.id))[0]
      ?? await writer.createDistrict(countryId, { cityId: city.id, name: "Нагрузочный район", archetype: "NEW_BUILD", activate: true,
        idempotencyKey: `mcp-scale-district-${index}` });
    let first = await db.prepare("SELECT id FROM tasks_v3 WHERE city_id=? ORDER BY task_number LIMIT 1").get<{ id: string }>(city.id);
    if (!first) first = await writer.createTask(countryId, { cityId: city.id, districtId: district.id, title: `MCP scale task ${index + 1}.1`,
      description: "Реальная задача локального нагрузочного стенда.", estimate: 1, creatorUserId: userId, idempotencyKey: `mcp-scale-task-${index}` });
    const count = Number((await db.prepare("SELECT count(*)::integer AS count FROM tasks_v3 WHERE city_id=?").get<{ count: number }>(city.id))!.count);
    assert.ok(count <= 1000, "Fixture city unexpectedly contains more than 1000 tasks");
    if (count < 1000) {
      await db.prepare(`INSERT INTO tasks_v3 SELECT (jsonb_populate_record(NULL::tasks_v3,to_jsonb(t)||jsonb_build_object(
        'id',gen_random_uuid()::text,'task_number',0,'title',?||n,'status','PLANNING','progress',0))).*
        FROM tasks_v3 t CROSS JOIN generate_series(?::integer,1000) n WHERE t.id=?`).run(`MCP scale task ${index + 1}.`, count + 1, first.id);
      await synchronizeCityBlocks(db, countryId, city.id);
    }
    const layout = (await readActiveBlockLayout(db, city.id))!;
    assert.equal(layout.placements.length, 1000, "Every fixture task needs a canonical placement");
    assert.equal(blockTaskGeometry(layout).size, 1000, "Every canonical placement needs authored geometry");
    selected.push({ cityId: city.id, districtId: district.id, taskId: first.id });
    console.log(JSON.stringify({ fixtureCity: index + 1, tasks: 1000, blocks: layout.blocks.length }));
  }
  const actual = Number((await db.prepare("SELECT count(*)::integer AS count FROM tasks_v3 t JOIN cities_v3 city ON city.id=t.city_id WHERE city.country_id=?")
    .get<{ count: number }>(countryId))!.count);
  assert.equal(actual, 10_000);
  report.actualTasks = actual; report.countryId = countryId; report.selected = selected; report.seedMs = performance.now() - seededAt;
  for (const table of ["tasks_v3", "cities_v3", "districts_v3", "city_layouts_v1", "city_blocks_v1", "task_placements_v1"]) await db.exec(`ANALYZE ${table}`);
  report.sourceFingerprints = Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, createHash("sha256").update(await readFile(path)).digest("hex")])));
  await writeFile(`${folder}/fixture.json`, JSON.stringify({ countryId, userId, selected, tasks: actual, schema }, null, 2) + "\n");
  const service = new AppService(measured);
  mcp = await createMcpServer(measured, service, { userId, tokenId: crypto.randomUUID(), scopes: ["tasks:read", "tasks:write", "comments:write"] });
  client = new Client({ name: "mcp-scale-benchmark", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcp.connect(serverTransport); await client.connect(clientTransport);
  const targetTask = selected[0]!;
  const operations: Record<string, unknown> = {}; report.operations = operations;
  for (const [name, tool, args] of [
    ["compactCard", "task.get", { taskId: targetTask.taskId, view: "compact" }],
    ["listPage50", "task.list_page", { limit: 50 }],
    ["searchNoMatch", "task.list_page", { limit: 50, q: "no-matching-title-10000" }],
    ["compactComment", "task.add_comment", { taskId: targetTask.taskId, body: "Локальный замер компактного результата", resultMode: "compact" }],
  ] as const) {
    const elapsed: number[] = [], queryCount: number[] = [], sqlBytes: number[] = [], sqlMs: number[] = [], placements: number[] = [], blocks: number[] = [], payloadBytes: number[] = [];
    const loop = monitorEventLoopDelay({ resolution: 10 }); loop.enable();
    for (let sample = -3; sample < 20; sample++) {
      traces = []; const at = performance.now();
      const result = await client.callTool({ name: tool, arguments: { countryId, ...args,
        ...(name === "compactComment" ? { idempotencyKey: `benchmark-${label}-${Date.now()}-${sample}` } : {}) } });
      assert.ok(!result.isError, "MCP operation failed: " + JSON.stringify(result.content));
      if (sample === -3) operations[name + "First"] = { elapsedMs: performance.now() - at,
        queries: traces.length, sqlBytes: traces.reduce((sum, trace) => sum + trace.bytes, 0),
        hydratedPlacements: traces.reduce((sum, trace) => sum + trace.geometryPlacements, 0),
        hydratedBlocks: traces.reduce((sum, trace) => sum + trace.geometryBlocks, 0) };
      if (sample < 0) continue;
      elapsed.push(performance.now() - at); queryCount.push(traces.length);
      sqlBytes.push(traces.reduce((sum, trace) => sum + trace.bytes, 0)); sqlMs.push(traces.reduce((sum, trace) => sum + trace.ms, 0));
      placements.push(traces.reduce((sum, trace) => sum + trace.geometryPlacements, 0)); blocks.push(traces.reduce((sum, trace) => sum + trace.geometryBlocks, 0));
      payloadBytes.push(Buffer.byteLength(JSON.stringify(result)));
    }
    loop.disable();
    operations[name] = { elapsedMs: stats(elapsed), queries: stats(queryCount), sqlBytes: stats(sqlBytes), sqlMs: stats(sqlMs),
      hydratedPlacements: stats(placements), hydratedBlocks: stats(blocks), payloadBytes: stats(payloadBytes),
      eventLoopP95Ms: loop.percentile(95) / 1e6 };
    console.log(JSON.stringify({ operation: name, ...operations[name] as object }));
  }
  const endingFingerprints = Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, createHash("sha256").update(await readFile(path)).digest("hex")])));
  report.sourcesUnchangedDuringMeasurement = JSON.stringify(report.sourceFingerprints) === JSON.stringify(endingFingerprints);
  report.operations = operations;
  report.status = report.sourcesUnchangedDuringMeasurement ? "MEASURED" : "SOURCES_CHANGED";
  assert.ok(report.sourcesUnchangedDuringMeasurement, "Measured production sources changed during the run");
} catch (error) {
  report.status = "FAILED"; report.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(`${folder}/${label}.json`, JSON.stringify(report, null, 2) + "\n");
  await client?.close(); await mcp?.close(); await db.close();
}
