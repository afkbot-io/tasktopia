/** Dedicated local benchmark database only. Domain service authors every lot,
 * entrance and road. Bulk statuses reuse the established fixture-only pattern. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createDb, transaction } from "../src/server/db";
import { registerUser } from "../src/server/auth";
import { AppService } from "../src/server/app-service";
import { synchronizeCityBlocks } from "../src/server/world/active-block-layout";
import { auditWorld } from "../src/server/world/world-audit";
import { CITY_SCALE_BASELINE, cityScaleDatabase, cityScaleSize, type CityScaleFixture } from "./city-scale-benchmark-contract";

const count = cityScaleSize(process.env.CITY_SCALE_TASKS);
const sourceRevision = process.env.CITY_SCALE_SOURCE_REVISION ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
assert.equal(sourceRevision, CITY_SCALE_BASELINE, "Freeze fixtures using the baseline service before candidate measurements");
assert.ok(process.env.CITY_SCALE_DATABASE_FILE, "A private URI file is required; never pass credentials on the CLI");
const url = cityScaleDatabase((await readFile(process.env.CITY_SCALE_DATABASE_FILE, "utf8")).trim(), count);
const output = process.env.CITY_SCALE_OUTPUT ?? `.builder/world-perf-20261016/fixture-${count}.json`;
const db = await createDb(url.toString());
try {
  const existing = await db.prepare("SELECT count(*)::int AS count FROM tasks_v3").get<{ count: number }>();
  assert.equal(existing?.count, 0, "Refuse to overwrite or reseed an existing benchmark; preserve the frozen dataset");
  const email = `city-scale-${count}@tasktopia.local`;
  const { user } = await registerUser(db, { email, password: "local-city-scale-fixture-only", name: "Локальный нагрузочный стенд" });
  await db.prepare("UPDATE countries SET seed=? WHERE id=?").run(424242, user.countryId);
  const service = new AppService(db);
  const city = await service.createCity(user.countryId, { name: `Город ровно ${count} задач`, morphology: "DENSE_CORE", idempotencyKey: "scale-city" });
  for (let first = 0; first < count; first += 25) {
    const district = await service.createDistrict(user.countryId, { cityId: city.id, name: `Район ${first / 25 + 1}`,
      archetype: "NEW_BUILD", activate: false, idempotencyKey: `scale-district-${first}` });
    for (let ordinal = first; ordinal < Math.min(first + 25, count); ordinal++) {
      await service.createTask(user.countryId, { cityId: city.id, districtId: district.id, title: `Нагрузка ${ordinal + 1}`,
        description: `Воспроизводимая локальная задача ${ordinal + 1}.`, estimate: 1, creatorUserId: user.id,
        assigneeUserId: ordinal % 3 === 0 ? user.id : undefined, idempotencyKey: `scale-task-${ordinal}` });
    }
    console.log(JSON.stringify({ count, created: Math.min(first + 25, count) }));
  }
  const tasks = (await service.listTasks(user.countryId)).sort((a, b) => a.taskNumber - b.taskNumber);
  assert.equal(tasks.length, count, "Infrastructure slots must not add hidden business tasks");
  await transaction(db, async () => {
    for (let index = 0; index < tasks.length; index++) {
      const status = index < count * .8 ? "COMPLETED" : index < count * .95 ? "IN_PROGRESS" : "PLANNING";
      await db.prepare("UPDATE tasks_v3 SET status=?,progress=? WHERE id=?").run(status, status === "COMPLETED" ? 100 : status === "IN_PROGRESS" ? 50 : 0, tasks[index]!.id);
    }
    await synchronizeCityBlocks(db, user.countryId, city.id);
    await db.prepare("UPDATE countries SET world_version=world_version+1 WHERE id=?").run(user.countryId);
  });
  await service.activateDistrict(user.countryId, tasks[Math.ceil(count * .8)]!.districtId, "scale-active");
  const audit = await auditWorld(db, service, user.countryId);
  assert.deepEqual(audit.violations, [], "Real world geometry audit must pass before measuring");
  const scene = await service.getCityScene(user.countryId, city.id);
  const canonical = [...new Map([...scene.chunks.flatMap(chunk => chunk.tasks),
    ...scene.completedDistrictSnapshots.flatMap(snapshot => snapshot.tasks)].map(task => [task.id, task])).values()].sort((a, b) => a.taskNumber - b.taskNumber);
  assert.equal(canonical.length, count);
  const geometryHash = createHash("sha256").update(JSON.stringify({ city: scene.city, roads: scene.roadContext,
    tasks: canonical.map(task => ({ id: task.id, stage: task.stage, buildingType: task.buildingType, origin: task.origin,
      footprint: task.footprint, accessPath: task.accessPath })), chunks: scene.chunks.map(chunk => ({ x: chunk.chunkX,
      y: chunk.chunkY, roads: chunk.roadRuns, surfaces: chunk.surfaceRuns, districts: chunk.districts })) })).digest("hex");
  const statusCounts = Object.fromEntries(await db.prepare("SELECT status,count(*)::int AS count FROM tasks_v3 GROUP BY status ORDER BY status").all<{ status: string; count: number }>()
    .then(rows => rows.map(row => [row.status, row.count])));
  const report: CityScaleFixture = { schemaVersion: 1, tasks: count, districts: count / 25, seed: 424242,
    countryId: user.countryId, cityId: city.id, email, createdAt: new Date().toISOString(), geometryHash, statusCounts,
    chunks: scene.chunks.length, auditViolations: audit.violations.length,
    sourceRevision };
  await mkdir(output.substring(0, output.lastIndexOf("/")) || ".", { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ ...report, email: undefined }));
} finally { await db.close(); }
