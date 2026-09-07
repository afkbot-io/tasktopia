import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { AppService } from "../../src/server/app-service";
import { registerUser } from "../../src/server/auth";
import { createDb } from "../../src/server/db";
import { BUILDING_CATALOG } from "../../src/shared/catalog";
import type { TaskStatus } from "../../src/shared/contracts";

/** One-time isolated workload. Never resets/reseeds an existing world. */
const schema = "compact_release_20260906";
const url = new URL(process.env.E2E_DATABASE_URL ?? "invalid");
assert.ok(process.env.E2E_COMPACT_RELEASE_FIXTURE === "true"
  && ["postgres:", "postgresql:"].includes(url.protocol)
  && ["localhost", "127.0.0.1"].includes(url.hostname)
  && ["", "5432"].includes(url.port) && url.pathname === "/tasktopia_test"
  && url.searchParams.get("options") === `-csearch_path=${schema}`
  && [...url.searchParams.keys()].every(key => key === "options"), "Exact disposable loopback schema and explicit opt-in required");
const preflight = await createDb(url.toString(), { migrate: false, maxConnections: 1 });
try {
  assert.equal((await preflight.prepare("SELECT current_schema() AS name").get<{ name: string }>())?.name, schema);
  for (const table of ["users", "countries"]) {
    const exists = await preflight.prepare("SELECT to_regclass(?) IS NOT NULL AS present").get<{ present: boolean }>(`${schema}.${table}`);
    if (exists?.present) assert.equal(Number((await preflight.prepare(`SELECT count(*) AS n FROM ${table}`).get<{ n: string }>())?.n), 0);
  }
} finally { await preflight.close(); }
const homes = BUILDING_CATALOG.filter(entry => !entry.serviceRole && entry.category === "HOUSE"
  && !["compact-row-v1", "compact-wide-v1", "compact-apartment-v1"].includes(entry.key));
assert.equal(homes.length, 10, "Run the final catalog fixture only after all ten reviewed homes are published");
const db = await createDb(url.toString(), { maxConnections: 1 });
const timings: number[] = [];
const stageStatuses: readonly TaskStatus[] = ["PLANNING", "STARTED", "IN_PROGRESS", "TESTING", "COMPLETED"];
try {
  const result = await db.transaction(async () => {
    await db.prepare("SELECT pg_advisory_xact_lock(hashtext(?))").get(`${schema}-one-time-seed`);
    assert.equal(Number((await db.prepare("SELECT (SELECT count(*) FROM users)+(SELECT count(*) FROM countries) AS n").get<{ n: string }>())?.n), 0);
    const { user } = await registerUser(db, { email: "demo@tasktopia.local", password: "tasktopia-demo",
      name: "Compact release QA", countryName: "Компактный мир · RC" });
    // Only the reproducible geography seed is assigned directly; all task,
    // district, block and stage mutations use the production service commands.
    await db.prepare("UPDATE countries SET seed=? WHERE id=?").run(424242, user.countryId);
    const service = new AppService(db);
    const city = await service.createCity(user.countryId, { name: "Город двадцати спринтов", idempotencyKey: "rc-city" });
    const expected: Array<{ id: string; number: number; family: string; stage: number; districtId: string }> = [];
    for (let sprint = 0; sprint < 20; sprint++) {
      const district = await service.createDistrict(user.countryId, { cityId: city.id, name: `Спринт ${String(sprint + 1).padStart(2, "0")}`,
        idempotencyKey: `rc-sprint-${sprint}` });
      await service.activateDistrict(user.countryId, district.id, `rc-sprint-${sprint}-active`);
      for (let slot = 0; slot < 24; slot++) {
        // First three ordinary requests consume queued city-level services;
        // authored home examples then precede the ninth-building school.
        const art = sprint < homes.length && slot >= 3 && slot < 6 ? homes[sprint] : undefined;
        const stage = art ? slot : [5, 5, 5, 4, 1, 2][slot % 6]!;
        const park = slot === 23;
        const key = `rc-task-${sprint}-${slot}`;
        const start = performance.now();
        let task = await service.createTask(user.countryId, { cityId: city.id, districtId: district.id,
          title: `${sprint + 1}.${slot + 1} · ${art?.label ?? (park ? "Сад квартала" : "Городская задача")} · стадия ${stage}`,
          estimate: 1, visualKind: park ? "PARK" : "BUILDING", parkVariant: park ? "urban-pocket" : undefined,
          buildingHint: art?.key, idempotencyKey: key });
        timings.push(performance.now() - start);
        for (let next = 2; next <= stage; next++) task = await service.updateTaskStatus(user.countryId, {
          taskId: task.id, status: stageStatuses[next - 1]!, actor: "Compact release QA", idempotencyKey: `${key}-stage-${next}` });
        if (art) { assert.equal(task.buildingType, art.key); expected.push({ id: task.id, number: task.taskNumber,
          family: art.key, stage, districtId: district.id }); }
      }
      process.stderr.write(`Seeded sprint ${sprint + 1}/20\n`);
    }
    const coldStart = performance.now();
    const scene = await new AppService(db).getCityScene(user.countryId, city.id);
    const coldSceneMs = performance.now() - coldStart;
    const sceneTasks = new Map([...scene.chunks.flatMap(chunk => chunk.tasks),
      ...scene.completedDistrictSnapshots.flatMap(snapshot => snapshot.tasks)].map(task => [task.id, task]));
    assert.equal(sceneTasks.size, 480);
    assert.equal(new Set([...sceneTasks.values()].map(task => task.districtId)).size, 20);
    for (const item of expected) assert.equal(sceneTasks.get(item.id)?.buildingType, item.family);
    const sorted = [...timings].sort((a, b) => a - b);
    return { schema, countryId: user.countryId, cityId: city.id, seed: 424242, cityName: city.name,
      taskCount: sceneTasks.size, districts: 20, coldSceneMs, sceneBytes: Buffer.byteLength(JSON.stringify(scene)),
      taskCreateMs: { count: sorted.length, p50: sorted[Math.floor(sorted.length * .5)], p95: sorted[Math.floor(sorted.length * .95)], max: sorted.at(-1) },
      sceneRevision: scene.sceneRevision, chunks: scene.chunks.length, bounds: scene.city.bounds, expected };
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally { await db.close(); }
