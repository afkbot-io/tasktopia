/** Owned local fixture only. Row preparation and native geometry are separate,
 * explicit phases so the expensive old capacity failure is never retried. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createDb, transaction } from "../src/server/db";
import { readActiveBlockLayout, synchronizeCityBlocks } from "../src/server/world/active-block-layout";
import { auditWorld } from "../src/server/world/world-audit";
import { CITY_SCENE_MAX_CHUNKS, citySceneChunkRange } from "../src/shared/city-capacity";
import { encodeCitySceneWire, CITY_SCENE_COMPACT_ACCEPT } from "../src/shared/city-scene-wire";
import { assertCity10000Scene, city10000Database, city10000FixtureRows, city10000GeometryHash, city10000Tasks,
  CITY_10000_SCENE_BYTES, type City10000Fixture, type City10000Prepared } from "./city-10000-contract";

const folder = ".builder/city-10000-20261028/fixture-v2";
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const sources = ["src/server/app-service.ts", "src/server/world/block-layout-compiler.ts",
  "src/server/world/active-block-layout.ts", "src/server/world/compact-city-site.ts", "src/server/world/scene-spatial-index.ts",
  "src/server/routes.ts", "src/shared/city-capacity.ts", "src/shared/city-scene-wire.ts",
  "src/shared/block-templates.ts", "src/shared/block-parcel-plan.ts", "src/shared/world-terrain.ts",
  "scripts/city-10000-contract.ts", "scripts/seed-city-10000.ts"];
async function sourceHashes() { return Object.fromEntries(await Promise.all(sources.map(async path => [path, hash(await readFile(path))]))); }
async function main() {
  const mode = process.argv.slice(2); assert.equal(mode.length, 1);
  assert.ok(["--prepare-rows", "--build-fixture", "--finalize-existing"].includes(mode[0]!));
  assert.ok(process.env.CITY_10000_DATABASE_FILE, "Private database URI file required");
  const handle = await open(process.env.CITY_10000_DATABASE_FILE, constants.O_RDONLY | constants.O_NOFOLLOW);
  let uri: string;
  try { const st = await handle.stat(); assert.ok(st.isFile() && st.uid === process.getuid?.() && st.size < 4096 && (st.mode & 0o777) === 0o600);
    uri = city10000Database((await handle.readFile("utf8")).trim()).toString(); }
  finally { await handle.close(); }
  process.umask(0o077); await mkdir(folder, { recursive: true, mode: 0o700 });
  const db = await createDb(uri, { maxConnections: 1 });
  try {
    const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const service = new AppService(db);
    if (mode[0] === "--prepare-rows") {
      const count = await db.prepare("SELECT count(*)::integer AS count FROM users").get<{ count: number }>();
      assert.equal(count?.count, 0, "Refuse an existing/shared fixture database");
      const prepared = await transaction(db, async (): Promise<City10000Prepared> => {
        const email = "city-10000@tasktopia.local";
        const { user } = await registerUser(db, { email, password: "local-city-10000-fixture-only", name: "Один город — 10000 задач" });
        await db.prepare("UPDATE countries SET seed=424242 WHERE id=?").run(user.countryId);
        const city = await service.createCity(user.countryId, { name: "Реальный город 10000 задач", morphology: "DENSE_CORE", idempotencyKey: "city-10000" });
        const district = await service.createDistrict(user.countryId, { cityId: city.id, name: "10000 в одном активном районе",
          archetype: "NEW_BUILD", capacitySp: 10000, activate: true, idempotencyKey: "district-10000" });
        const first = await service.createTask(user.countryId, { cityId: city.id, districtId: district.id, title: "Нагрузка 1",
          estimate: 1, creatorUserId: user.id, assigneeUserId: user.id, idempotencyKey: "task-10000-first" });
        const rows = city10000FixtureRows(user.id);
        // Fixture-only row batching. Domain compiler, terrain, slots, roads and
        // scene payload are never substituted by handcrafted spatial data.
        await db.prepare(`INSERT INTO tasks_v3 SELECT (jsonb_populate_record(NULL::tasks_v3,to_jsonb(t)||r.value)).*
          FROM tasks_v3 t CROSS JOIN jsonb_array_elements(?::jsonb) WITH ORDINALITY r(value,ordinality)
          WHERE t.id=? ORDER BY r.ordinality`).run(JSON.stringify(rows), first.id);
        await db.prepare("UPDATE tasks_v3 SET status='COMPLETED',progress=100 WHERE id=?").run(first.id);
        const actual = await db.prepare(`SELECT count(*)::integer AS tasks,count(DISTINCT task_number)::integer AS numbers,
          min(task_number)::integer AS first,max(task_number)::integer AS last,count(DISTINCT city_id)::integer AS cities,
          count(DISTINCT district_id)::integer AS districts FROM tasks_v3`).get();
        assert.deepEqual(actual, { tasks: 10000, numbers: 10000, first: 1, last: 10000, cities: 1, districts: 1 });
        const allocation = await db.prepare(`SELECT count(*) FILTER (WHERE service_role_assigned)::integer AS assigned,
          count(*) FILTER (WHERE service_role IS NOT NULL)::integer AS roles,
          count(*) FILTER (WHERE service_trigger IS NOT NULL)::integer AS triggers FROM tasks_v3`).get();
        assert.deepEqual(allocation, { assigned: 1, roles: 0, triggers: 0 }, "Only the real first task has already passed infrastructure allocation");
        return { schemaVersion: 1, status: "ROWS_PREPARED_NOT_GEOMETRY", tasks: 10000, seed: 424242,
          userId: user.id, countryId: user.countryId, cityId: city.id, districtId: district.id, email,
          sourceRevision, sourceHashes: await sourceHashes(), createdAt: new Date().toISOString() };
      });
      await writeFile(`${folder}/prepared-rows.json`, JSON.stringify(prepared, null, 2) + "\n", { flag: "wx", mode: 0o600 });
      console.log(JSON.stringify({ status: prepared.status, tasks: 10000, cityId: prepared.cityId, geometryGeneratedFor10000: false }));
      return;
    }
    const body = await readFile(`${folder}/prepared-rows.json`);
    assert.equal(hash(body), process.env.CITY_10000_PREPARED_SHA256, "Explicit prepared-rows binding required");
    const prepared = JSON.parse(body.toString()) as City10000Prepared;
    assert.equal(prepared.status, "ROWS_PREPARED_NOT_GEOMETRY");
    const actual = await db.prepare(`SELECT count(*)::integer AS tasks,count(DISTINCT city_id)::integer AS cities,
      count(DISTINCT district_id)::integer AS districts FROM tasks_v3`).get<{ tasks: number; cities: number; districts: number }>();
    assert.deepEqual(actual, { tasks: 10000, cities: 1, districts: 1 });
    const district = await db.prepare("SELECT city_id,status FROM districts_v3 WHERE id=?").get(prepared.districtId);
    assert.deepEqual(district, { city_id: prepared.cityId, status: "ACTIVE" });
    const beforeSource = await sourceHashes(), started = performance.now();
    let nativeEvidence: City10000Fixture["nativeEvidence"];
    if (mode[0] === "--finalize-existing") {
      const readbackBytes = await readFile(".builder/city-10000-20261028/native-v2/db-after.json");
      const resultBytes = await readFile(".builder/city-10000-20261028/native-v2/result.json");
      assert.equal(hash(readbackBytes), process.env.CITY_10000_NATIVE_READBACK_SHA256);
      assert.equal(hash(resultBytes), process.env.CITY_10000_NATIVE_RESULT_SHA256);
      const readback = JSON.parse(readbackBytes.toString()), result = JSON.parse(resultBytes.toString());
      const before = JSON.parse(await readFile(".builder/city-10000-20261028/native-v2/before.json", "utf8"));
      assert.deepEqual(result.sourceHashes, before.sourceHashes);
      const lines = (await readFile(".builder/city-10000-20261028/native-v2/stdout.log", "utf8")).trim().split("\n").map(line => JSON.parse(line));
      const compiler = lines.find(line => line.phase === "native-compiler-complete");
      assert.equal(result.exitCode, 1); assert.equal(result.timedOut, false); assert.equal(compiler.placements, 10000);
      assert.equal(readback.status, "REAL_NATIVE_LAYOUT_COMMITTED_RAW_SCENE_BUDGET_FAILED_AUDIT_NOT_RUN");
      const existing = await readActiveBlockLayout(db, prepared.cityId); assert.ok(existing);
      assert.equal(existing.checksum, readback.layout.checksum); assert.equal(existing.placements.length, 10000);
      nativeEvidence = { readbackSha256: hash(readbackBytes), resultSha256: hash(resultBytes),
        layoutChecksum: existing.checksum, historicalCompilerMs: compiler.compilerMs, generationSourceHashes: before.sourceHashes };
    }
    const layout = mode[0] === "--finalize-existing" ? (await readActiveBlockLayout(db, prepared.cityId))!
      : await synchronizeCityBlocks(db, prepared.countryId, prepared.cityId);
    const compilerMs = performance.now() - started, nativeChunks = citySceneChunkRange(layout.bounds).count;
    console.log(JSON.stringify({ phase: nativeEvidence ? "bound-existing-native-geometry" : "native-compiler-complete", chunks: nativeChunks, chunkLimit: CITY_SCENE_MAX_CHUNKS,
      placements: layout.placements.length, bounds: layout.bounds, compilerMs: nativeEvidence ? null : compilerMs,
      historicalCompilerMs: nativeEvidence?.historicalCompilerMs, heapUsedBytes: process.memoryUsage().heapUsed }));
    assert.ok(nativeChunks > 256 && nativeChunks <= CITY_SCENE_MAX_CHUNKS);
    if (!nativeEvidence) await db.prepare("UPDATE countries SET world_version=world_version+1 WHERE id=?").run(prepared.countryId);
    const sceneStarted = performance.now();
    const scene = await new AppService(db).getCitySceneForUser(prepared.userId, prepared.countryId, prepared.cityId);
    const authenticatedSceneMs = performance.now() - sceneStarted;
    assertCity10000Scene(scene, prepared.cityId, CITY_SCENE_MAX_CHUNKS);
    assert.equal(layout.placements.length, 10000);
    const legacy = JSON.stringify(scene), legacyRawSceneBytes = Buffer.byteLength(legacy), legacyGzipSceneBytes = gzipSync(legacy).length;
    const wire = JSON.stringify(encodeCitySceneWire(scene)), rawSceneBytes = Buffer.byteLength(wire), gzipSceneBytes = gzipSync(wire).length;
    console.log(JSON.stringify({ phase: "authenticated-scene-complete", chunks: scene.chunks.length, rawSceneBytes,
      gzipSceneBytes, legacyRawSceneBytes, legacyGzipSceneBytes, compactAccept: CITY_SCENE_COMPACT_ACCEPT,
      authenticatedSceneMs, heapUsedBytes: process.memoryUsage().heapUsed,
      cacheScope: nativeEvidence ? "fresh-service-instance; bound committed geometry reused; PostgreSQL and OS caches may be warm"
        : "fresh-service-instance; compiler just ran; PostgreSQL and OS caches may be warm" }));
    assert.ok(rawSceneBytes <= CITY_10000_SCENE_BYTES, "Declared 48MiB raw JSON workload budget exceeded; this is not a transport limit");
    const auditStarted = performance.now(), audit = await auditWorld(db, service, prepared.countryId);
    const auditMs = performance.now() - auditStarted; assert.deepEqual(audit.violations, []);
    const tasks = city10000Tasks(scene), target = (task: typeof tasks[number]) => ({ id: task.id,
      taskNumber: task.taskNumber, title: task.title, origin: task.origin });
    const far = [...tasks].sort((a, b) => Math.hypot(b.origin.x - scene.city.center.x, b.origin.y - scene.city.center.y)
      - Math.hypot(a.origin.x - scene.city.center.x, a.origin.y - scene.city.center.y))[0]!;
    const statusCounts = Object.fromEntries((await db.prepare("SELECT status,count(*)::integer AS count FROM tasks_v3 GROUP BY status ORDER BY status")
      .all<{ status: string; count: number }>()).map(row => [row.status, row.count]));
    assert.deepEqual(statusCounts, { COMPLETED: 8000, IN_PROGRESS: 1500, PLANNING: 500 });
    const afterSource = await sourceHashes(); assert.deepEqual(afterSource, beforeSource, "Source changed during native build");
    const fixture: City10000Fixture = { ...prepared, status: "REAL_GEOMETRY_READY", sourceRevision,
      sourceHashes: afterSource, geometryHash: city10000GeometryHash(scene), chunks: scene.chunks.length,
      chunkLimit: CITY_SCENE_MAX_CHUNKS, bounds: layout.bounds, statusCounts, auditViolations: 0,
      rawSceneBytes, gzipSceneBytes, legacyRawSceneBytes, legacyGzipSceneBytes, compactAccept: CITY_SCENE_COMPACT_ACCEPT,
      buildOrFinalizeWallMs: performance.now() - started,
      existingGeometryReused: !!nativeEvidence, ...(nativeEvidence ? { nativeEvidence } : {}),
      phaseMs: { compiler: nativeEvidence ? 0 : compilerMs, authenticatedScene: authenticatedSceneMs, audit: auditMs }, farTarget: target(far),
      targets: Array.from({ length: 20 }, (_, n) => target(tasks[Math.floor(n * 9999 / 19)]!)), builtAt: new Date().toISOString() };
    await writeFile(`${folder}/fixture.json`, JSON.stringify(fixture, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ status: fixture.status, tasks: 10000, chunks: fixture.chunks,
      chunkLimit: fixture.chunkLimit, rawSceneBytes, gzipSceneBytes, existingGeometryReused: fixture.existingGeometryReused,
      buildOrFinalizeWallMs: fixture.buildOrFinalizeWallMs }));
  } finally { await db.close(); }
}
await main().catch(error => {
  console.error(JSON.stringify({ status: "CITY_10000_FIXTURE_FAILED", errorName: error instanceof Error ? error.name : "UnknownError",
    detail: "Подробности БД и URI не выводятся; подготовленные данные сохранены, автоматического повтора нет." }));
  process.exitCode = 1;
});
