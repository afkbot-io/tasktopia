import assert from "node:assert/strict";
import { AppService } from "../../src/server/app-service";
import { registerUser } from "../../src/server/auth";
import { createDb } from "../../src/server/db";
import { getBuilding } from "../../src/shared/catalog";
import type { TaskDto, TaskStatus } from "../../src/shared/contracts";

/**
 * One-time local visual fixture. The operator creates this exact empty schema;
 * this script never creates/drops schemas, resets countries or reuses old data.
 * E2E_COMPACT_SERVICE_ART_FIXTURE=true E2E_DATABASE_URL=<local schema URL>
 * node --import tsx tests/fixtures/seed-compact-service-art.ts
 */
const SCHEMA = "compact_service_art_20260905";
const CITY_NAME = "Compact service art";
const url = new URL(process.env.E2E_DATABASE_URL ?? "invalid");
if (process.env.E2E_COMPACT_SERVICE_ART_FIXTURE !== "true"
  || !["postgres:", "postgresql:"].includes(url.protocol)
  || !["localhost", "127.0.0.1"].includes(url.hostname)
  || !["", "5432"].includes(url.port)
  || url.pathname !== "/tasktopia_test"
  || url.searchParams.get("options") !== `-csearch_path=${SCHEMA}`
  || [...url.searchParams.keys()].some(key => key !== "options")) {
  throw new Error(`Service art seeding requires explicit opt-in and the exact disposable local ${SCHEMA} schema`);
}

const serviceArt = [
  { number: 12, role: "MEDICAL", family: "compact-clinic-v1" },
  { number: 16, role: "FIRE", family: "compact-fire-station-v1" },
] as const;
for (const expected of serviceArt) {
  const building = getBuilding(expected.family);
  assert.equal(building.key, expected.family);
  assert.deepEqual(building.footprint, { width: 6, height: 4 });
}

// A missing search_path must fail before migration DDL can fall back elsewhere.
const preflight = await createDb(url.toString(), { migrate: false, maxConnections: 1 });
try {
  assert.equal((await preflight.prepare("SELECT current_schema() AS schema").get<{ schema: string }>())?.schema, SCHEMA,
    "Create the exact isolated schema first; no fallback to public is allowed");
  for (const table of ["users", "countries"] as const) {
    const exists = await preflight.prepare("SELECT to_regclass(?) IS NOT NULL AS present").get<{ present: boolean }>(`${SCHEMA}.${table}`);
    if (exists?.present) {
      const count = await preflight.prepare(`SELECT count(*) AS count FROM ${table}`).get<{ count: string | number }>();
      assert.equal(Number(count?.count), 0, "Refusing to migrate a populated fixture; no reset or reseed is supported");
    }
  }
} finally { await preflight.close(); }

const db = await createDb(url.toString(), { maxConnections: 1 });
try {
  const summary = await db.transaction(async () => {
    await db.prepare("SELECT pg_advisory_xact_lock(hashtext(?))").get(`${SCHEMA}-one-time-seed`);
    const existing = await db.prepare("SELECT (SELECT count(*) FROM users) + (SELECT count(*) FROM countries) AS count")
      .get<{ count: string | number }>();
    assert.equal(Number(existing?.count), 0, "Refusing to change a populated fixture; no reset or reseed is supported");
    const { user } = await registerUser(db, {
      email: "demo@tasktopia.local", password: "tasktopia-demo", name: "Service art QA", countryName: "Compact service art QA",
    });
    // Seed selection is the only fixture-owned domain row update. All geometry,
    // reservations, stages and roads below go through normal service commands.
    await db.prepare("UPDATE countries SET seed = ? WHERE id = ?").run(424242, user.countryId);
    const service = new AppService(db);
    const city = await service.createCity(user.countryId, { name: CITY_NAME, idempotencyKey: "service-art-city" });
    const district = await service.createDistrict(user.countryId, {
      cityId: city.id, name: "Service art sprint", activate: true, idempotencyKey: "service-art-sprint",
    });
    assert.equal(district.status, "ACTIVE");
    const tasks: TaskDto[] = [];
    for (let number = 1; number <= 16; number += 1) {
      const task = await service.createTask(user.countryId, {
        cityId: city.id, districtId: district.id, title: `Service art ${number}`,
        description: "Автоматический выбор семейства по реальному слоту и инфраструктурному резерву.",
        estimate: 1,
        // BUILDING fixes the business workload count; it does not select art.
        // No buildingHint/explicit family: #12 and #16 must consume real roles.
        visualKind: "BUILDING", idempotencyKey: `service-art-task-${number}`,
      });
      assert.equal(task.taskNumber, number);
      tasks.push(task);
    }
    const statuses: TaskStatus[] = ["PLANNING", "STARTED", "IN_PROGRESS", "TESTING", "COMPLETED"];
    for (let index = 0; index < tasks.length; index += 1) {
      let task = tasks[index]!;
      const expected = serviceArt.find(entry => entry.number === task.taskNumber);
      if (expected) {
        assert.equal(task.serviceRole, expected.role);
        assert.equal(task.buildingType, expected.family);
        assert.equal(task.footprint.length, 24);
      }
      const targetStage = expected ? 5 : 3 + index % 3;
      for (let stage = 2; stage <= targetStage; stage += 1) {
        task = await service.updateTaskStatus(user.countryId, {
          taskId: task.id, status: statuses[stage - 1]!,
          comment: "Штатное продвижение задачи изолированного визуального стенда.",
          actor: "Service art QA", idempotencyKey: `service-art-task-${task.taskNumber}-stage-${stage}`,
        });
      }
      tasks[index] = task;
    }
    const scene = await new AppService(db).getCityScene(user.countryId, city.id);
    const rendered = new Map([
      ...scene.chunks.flatMap(chunk => chunk.tasks),
      ...scene.completedDistrictSnapshots.flatMap(snapshot => snapshot.tasks),
    ].map(task => [task.id, task]));
    assert.equal(rendered.size, 16, "No phantom service tasks or omitted render tasks");
    assert.equal((await service.listTasks(user.countryId)).length, 16);
    assert.equal((await service.listCities(user.countryId)).length, 1);
    assert.equal((await service.listDistricts(user.countryId)).length, 1);
    for (const expected of serviceArt) {
      const task = tasks[expected.number - 1]!;
      assert.equal(task.stage, 5);
      assert.deepEqual(rendered.get(task.id)?.footprint, task.footprint);
      assert.equal(rendered.get(task.id)?.buildingType, expected.family);
      assert.equal(rendered.get(task.id)?.serviceRole, expected.role);
      assert.equal(rendered.get(task.id)?.stage, 5);
    }
    return {
      schema: SCHEMA, seed: 424242, countryId: user.countryId, cityId: city.id, cityName: CITY_NAME,
      districtId: district.id, taskCount: tasks.length, sceneRevision: scene.sceneRevision,
      tasks: tasks.map(task => ({ id: task.id, number: task.taskNumber, family: task.buildingType,
        role: task.serviceRole ?? null, stage: task.stage, origin: task.origin, footprintCells: task.footprint.length })),
    };
  });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} finally { await db.close(); }
