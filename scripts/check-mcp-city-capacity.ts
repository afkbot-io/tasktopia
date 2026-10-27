/** Отдельная локальная проверка продуктового предела, не HTTP latency test. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createDb } from "../src/server/db";
import { CitySceneCapacityError, readActiveBlockLayout, synchronizeCityBlocks } from "../src/server/world/active-block-layout";

const uri = process.env.TEST_DATABASE_URL;
assert.ok(uri, "TEST_DATABASE_URL is required");
const target = new URL(uri);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)
  && (target.pathname.endsWith("_test") || /^\/mcp_scale_\d{8}$/.test(target.pathname)) && !target.search,
  "Only a local isolated benchmark database is allowed");
const folder = ".builder/mcp-scale-10000-20261028/performance";
await mkdir(folder, { recursive: true });
if (process.argv.includes("--worker")) {
  const schema = process.env.MCP_CAPACITY_SCHEMA!;
  assert.match(schema, /^mcp_capacity_[a-f0-9]{32}$/);
  const db = await createDb(uri, { schema, maxConnections: 2 });
  try {
    const owner = await registerUser(db, { email: "capacity-10000@example.test", name: "Локальная проверка вместимости", password: "local-capacity-fixture-only" });
    const countryId = owner.user.countryId;
    await db.prepare("UPDATE countries SET seed=424242 WHERE id=?").run(countryId);
    const service = new AppService(db);
    const city = await service.createCity(countryId, { name: "Один город 10000 задач", morphology: "DENSE_CORE", idempotencyKey: "capacity-city" });
    const district = await service.createDistrict(countryId, { cityId: city.id, name: "Нагрузочный район", activate: true, archetype: "NEW_BUILD", idempotencyKey: "capacity-district" });
    const first = await service.createTask(countryId, { cityId: city.id, districtId: district.id, title: "Первая задача", estimate: 1, idempotencyKey: "capacity-task" });
    const previous = (await readActiveBlockLayout(db, city.id))!;
    await db.prepare(`INSERT INTO tasks_v3 SELECT (jsonb_populate_record(NULL::tasks_v3,to_jsonb(t)||jsonb_build_object(
      'id',gen_random_uuid()::text,'task_number',0,'title','Задача вместимости '||n))).*
      FROM tasks_v3 t CROSS JOIN generate_series(2,10000) n WHERE t.id=?`).run(first.id);
    const count = Number((await db.prepare("SELECT count(*)::integer AS count FROM tasks_v3 WHERE city_id=?").get<{ count: number }>(city.id))!.count);
    assert.equal(count, 10_000);
    const start = performance.now();
    let status: "PASS" | "CAPACITY_EXCEEDED" = "PASS";
    try { await synchronizeCityBlocks(db, countryId, city.id); }
    catch (error) {
      if (!(error instanceof CitySceneCapacityError)) throw error;
      status = "CAPACITY_EXCEEDED";
    }
    const actual = (await readActiveBlockLayout(db, city.id))!;
    const chunks = (Math.floor(actual.bounds.maxX / 64) - Math.floor(actual.bounds.minX / 64) + 1)
      * (Math.floor(actual.bounds.maxY / 64) - Math.floor(actual.bounds.minY / 64) + 1);
    if (status === "PASS") assert.equal(actual.placements.length, 10_000);
    else assert.equal(actual.checksum, previous.checksum, "Failed capacity check must preserve the previous canonical layout");
    console.log(JSON.stringify({ status, tasksAttempted: count, cityCount: 1, chunkLimit: 256, activeChunksAfter: chunks,
      previousLayoutPreservedOnRejection: status === "CAPACITY_EXCEEDED" ? actual.checksum === previous.checksum : null,
      realCompilerAndTerrainAllocator: true, elapsedMs: performance.now() - start, heapUsedBytes: process.memoryUsage().heapUsed }));
  } finally { await db.close(); }
} else {
  const schema = "mcp_capacity_" + randomUUID().replaceAll("-", "");
  const admin = await createDb(uri, { migrate: false, maxConnections: 1 });
  await admin.exec(`CREATE SCHEMA ${schema}`);
  let output = "", errorBytes = 0, timedOut = false;
  const at = performance.now();
  try {
    const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(import.meta.url), "--worker"], {
      env: { ...process.env, MCP_CAPACITY_SCHEMA: schema }, stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", chunk => { output += String(chunk); });
    child.stderr.on("data", chunk => { errorBytes += chunk.length; });
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 120_000);
    const code = await new Promise<number | null>((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
    clearTimeout(timer);
    const result = code === 0 && !timedOut ? JSON.parse(output.trim()) : { status: timedOut ? "TIMEOUT" : "FAILED", exitCode: code, stderrBytes: errorBytes };
    await writeFile(`${folder}/single-city-10000-capacity.json`, JSON.stringify({ ...result, deadlineMs: 120_000,
      totalElapsedMs: performance.now() - at, localOnly: true, schemaRemoved: true, checkedAt: new Date().toISOString() }, null, 2) + "\n");
    console.log(JSON.stringify(result));
    if (result.status !== "PASS" && result.status !== "CAPACITY_EXCEEDED") process.exitCode = 1;
  } finally { await admin.exec(`DROP SCHEMA ${schema} CASCADE`); await admin.close(); }
}
