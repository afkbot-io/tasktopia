import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createDb, type Db } from "../src/server/db";
import { auditWorld } from "../src/server/world/world-audit";

// Local synthetic rehearsal, never an operator-facing production restore tool.
const container = process.env.REHEARSAL_POSTGRES_CONTAINER;
assert(container && /^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/.test(container), "Identify the local PostgreSQL container explicitly");
const base = new URL(process.env.TEST_DATABASE_URL ?? "postgres://tasktopia:tasktopia@127.0.0.1:5432/tasktopia_test");
assert(base.hostname === "127.0.0.1" && base.port === "5432" && base.pathname === "/tasktopia_test" && !base.search,
  "Only the identified local tasktopia_test server is allowed");
const docker = (args: string[], input?: Buffer) => execFileSync("docker", ["exec", ...(input ? ["-i"] : []), container, ...args],
  { input, maxBuffer: 32 * 1024 * 1024, timeout: 60_000 });
const ports = JSON.parse(execFileSync("docker", ["inspect", "--format", "{{json .NetworkSettings.Ports}}", container], { encoding: "utf8" })) as Record<string, Array<{ HostIp: string; HostPort: string }>>;
assert(ports["5432/tcp"]?.some(port => port.HostIp === "127.0.0.1" && port.HostPort === "5432"), "Container must own the identified loopback server");
const version = docker(["pg_dump", "--version"]).toString().trim();
assert(version.includes(" 16."), "Use matching PostgreSQL 16 dump/restore tools");
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const names = ["before", "candidate", "rollback"].map(stage => `release_rehearsal_${suffix}_${stage}`);
const output = join(process.cwd(), "docs/evidence/compact-rc", `cutover-${suffix}`);
const reportPath = join(output, "local-cutover-rehearsal.json");
const created: string[] = [];
const connection = (name: string) => { const url = new URL(base); url.pathname = `/${name}`; return url.toString(); };
let db: Db | undefined;
const timestamp = "2026-09-05T00:00:00.000Z";
const report: Record<string, unknown> = { version, databases: names, synthetic: true, production: false, startedAt: new Date().toISOString() };

async function snapshot(db: Db, durableOnly: boolean) {
  const projections: Record<string, string> = {
    countries: "id,name,seed,created_at",
    cities_v3: "id,country_id,name,description,status,created_at",
    districts_v3: "id,city_id,name,status,created_at",
    tasks_v3: "id,task_number,city_id,district_id,title,description,estimate,status,progress,work_item_type,created_at,updated_at",
    task_comments_v3: "*", task_events_v7: "*", task_dependencies_v1: "*",
    task_documents_v1: "*", task_checklist_items_v1: "*", task_defects_v18: "*",
  };
  const tables = durableOnly ? Object.keys(projections) : (await db.prepare(
    "SELECT tablename FROM pg_tables WHERE schemaname=current_schema() ORDER BY tablename",
  ).all<{ tablename: string }>()).map(row => row.tablename);
  const hashes: Record<string, { count: number; sha256: string }> = {};
  for (const table of tables) {
    assert(/^[a-z0-9_]+$/.test(table));
    const rows = await db.prepare(`SELECT to_jsonb(r)::text AS value FROM (SELECT ${durableOnly ? projections[table] : "*"} FROM "${table}") r ORDER BY to_jsonb(r)::text`).all<{ value: string }>();
    hashes[table] = { count: rows.length, sha256: createHash("sha256").update(JSON.stringify(rows)).digest("hex") };
  }
  return hashes;
}

try {
  await mkdir(output, { recursive: true });
  await writeFile(reportPath, `${JSON.stringify({ ...report, status: "running" }, null, 2)}\n`);
  for (const name of names) { docker(["createdb", "-U", "tasktopia", name]); created.push(name); }
  db = await createDb(connection(names[0]!), { migrate: false });
  await db.exec("CREATE TABLE schema_migrations(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
  const directory = join(process.cwd(), "migrations/postgres");
  for (const name of (await readdir(directory)).filter(name => /^\d+.*\.sql$/.test(name) && name < "0023_").sort()) {
    const source = await readFile(join(directory, name), "utf8");
    const migrationDb = db;
    await migrationDb.transaction(async () => {
      await migrationDb.exec(source);
      await migrationDb.prepare("INSERT INTO schema_migrations(name,checksum) VALUES (?,?)").run(name, createHash("sha256").update(source).digest("hex"));
    });
  }
  const { user } = await registerUser(db, { email: "restore-fixture@tasktopia.local", name: "Synthetic restore fixture", password: "local-rehearsal-only" });
  await db.prepare("UPDATE countries SET seed=424242 WHERE id=?").run(user.countryId);
  const city = randomUUID(), district = randomUUID(), tasks = Array.from({ length: 3 }, () => randomUUID());
  await db.prepare(`INSERT INTO cities_v3(id,country_id,name,status,center_x,center_y,bounds_json,style_id,created_at)
    VALUES (?,?,'Restore city','ACTIVE',96,-128,'{"minX":64,"minY":-160,"maxX":160,"maxY":-64}','old',?)`).run(city, user.countryId, timestamp);
  await db.prepare(`INSERT INTO districts_v3(id,city_id,name,status,cells_json,lots_json,growth_direction,color,created_at)
    VALUES (?,?,'Restore district','ACTIVE','[{"x":96,"y":-128}]','[]','E','#fff',?)`).run(district, city, timestamp);
  for (const [index, task] of tasks.entries()) {
    await db.prepare(`INSERT INTO tasks_v3(id,task_number,city_id,district_id,title,description,estimate,status,progress,
      building_type,platform_type,origin_x,origin_y,footprint_json,visual_kind,visual_asset_key,work_item_type,created_at,updated_at)
      VALUES (?,?,?,?,?,'Preserve content',3,?,?,'house-cottage','YARD',96,-128,'[{"x":96,"y":-128}]','BUILDING','house-cottage','TASK',?,?)`)
      .run(task, index + 1, city, district, `Preserve task ${index + 1}`, ["PLANNING", "IN_PROGRESS", "COMPLETED"][index], [0, 50, 100][index], timestamp, timestamp);
  }
  await db.prepare("INSERT INTO task_comments_v3(id,task_id,body,actor,created_at) VALUES (?,?,'Preserve comment','Tester',?)").run(randomUUID(), tasks[0], timestamp);
  await db.prepare("INSERT INTO task_events_v7(task_id,actor_label,event_type,details_json,created_at) VALUES (?,'Tester','STATUS_CHANGED','{}',?)").run(tasks[0], timestamp);
  await db.prepare("INSERT INTO task_dependencies_v1(task_id,depends_on_task_id,created_at) VALUES (?,?,?)").run(tasks[1], tasks[0], timestamp);
  await db.prepare("INSERT INTO task_documents_v1(task_id,file_name,title,content) VALUES (?,'spec.md','Preserve spec','Required content')").run(tasks[0]);
  await db.prepare("INSERT INTO task_checklist_items_v1(task_id,title,position) VALUES (?,'Preserve check',0)").run(tasks[0]);
  await db.prepare("INSERT INTO task_defects_v18(id,task_id,title,status,created_at,updated_at) VALUES (?,?,'Preserve defect','VERIFYING',?,?)").run(randomUUID(), tasks[0], timestamp, timestamp);
  await db.prepare("INSERT INTO roads_v3(country_id,x,y) VALUES (?,96,-128)").run(user.countryId);
  const durable = await snapshot(db, true), allBefore = await snapshot(db, false);
  await db.close(); db = undefined;
  const dump = docker(["pg_dump", "-U", "tasktopia", "-d", names[0]!, "-Fc", "--no-owner", "--no-acl"]);
  const dumpPath = join(output, `synthetic-pre-cutover-${suffix}.dump`);
  await writeFile(dumpPath, dump, { mode: 0o600 });
  report.backup = { path: dumpPath, bytes: dump.length, sha256: createHash("sha256").update(dump).digest("hex") };
  docker(["pg_restore", "-U", "tasktopia", "-d", names[1]!, "--exit-on-error", "--no-owner", "--no-acl"], dump);
  // Exercise the built release entry point, including its dedicated advisory
  // lock and migration ordering, before opening the candidate for read audit.
  const bundle = join(process.cwd(), "dist/regenerate-worlds.mjs");
  const bundleSha256 = createHash("sha256").update(await readFile(bundle)).digest("hex");
  const cliOutput = execFileSync(process.execPath, [bundle], {
    encoding: "utf8", maxBuffer: 4 * 1024 * 1024, timeout: 60_000,
    env: { ...process.env, NODE_ENV: "test", DATABASE_URL: connection(names[1]!), DATABASE_POOL_MAX: "4",
      REDIS_URL: "", VAPID_SUBJECT: "", VAPID_PUBLIC_KEY: "", VAPID_PRIVATE_KEY: "",
      REGENERATION_RUN_ID: `rehearsal-${suffix}`, REGENERATION_FORCE: "1", REGENERATION_MAX_ATTEMPTS: "1" },
  });
  const cliEvents = cliOutput.trim().split("\n").map(line => JSON.parse(line) as Record<string, unknown>);
  assert(cliEvents.some(event => event.event === "world-regeneration.finished"), "Built release CLI did not finish");
  const regeneration = cliEvents.find(event => event.event === "world-regeneration.completed");
  assert(regeneration, "Built release CLI did not regenerate the synthetic country");
  report.cli = { bundleSha256, events: cliEvents };
  db = await createDb(connection(names[1]!), { migrate: false });
  const expectedMigrations = await Promise.all((await readdir(directory)).filter(name => /^\d+.*\.sql$/.test(name)).sort().map(async name => ({
    name, checksum: createHash("sha256").update(await readFile(join(directory, name))).digest("hex"),
  })));
  const actualMigrations = await db.prepare("SELECT name,checksum FROM schema_migrations ORDER BY name").all<{ name: string; checksum: string }>();
  assert.deepEqual(actualMigrations, expectedMigrations, "Built release CLI did not apply exactly the expected migrations");
  report.migrations = actualMigrations;
  const service = new AppService(db);
  assert.deepEqual(await snapshot(db, true), durable, "Durable product content changed during migration/regeneration");
  const audit = await auditWorld(db, service, user.countryId);
  assert.deepEqual(audit.violations, []);
  report.candidate = { regeneration, audit, durableHashes: durable };
  await db.close(); db = undefined;
  docker(["pg_restore", "-U", "tasktopia", "-d", names[2]!, "--exit-on-error", "--no-owner", "--no-acl"], dump);
  db = await createDb(connection(names[2]!), { migrate: false });
  assert.deepEqual(await snapshot(db, false), allBefore, "Rollback restore differs from the complete pre-cutover database");
  assert.equal((await db.prepare("SELECT to_regclass('roads_v3')::text AS old").get<{ old: string }>())!.old, "roads_v3");
  report.rollback = { exactTableHashes: allBefore, legacySchemaRestored: true };
  report.status = "passed";
} catch (error) {
  report.status = "failed"; report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  const cleanupErrors: string[] = [];
  try { await db?.close(); }
  catch (error) { cleanupErrors.push(`close: ${error instanceof Error ? error.message : String(error)}`); }
  for (const name of created.reverse()) {
    assert(/^release_rehearsal_[a-f0-9]{12}_(before|candidate|rollback)$/.test(name));
    try { docker(["dropdb", "-U", "tasktopia", name]); }
    catch { cleanupErrors.push(`Unable to remove disposable database ${name}`); }
  }
  report.disposableDatabasesRemoved = cleanupErrors.length === 0;
  if (cleanupErrors.length) { report.status = "failed"; report.cleanupErrors = cleanupErrors; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: report.status, error: report.error, reportPath, production: false }));
}
