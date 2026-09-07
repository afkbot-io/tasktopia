import assert from "node:assert/strict";
import { AppService } from "../../src/server/app-service";
import { registerUser } from "../../src/server/auth";
import { createDb } from "../../src/server/db";
import type { TaskDto, TaskStatus } from "../../src/shared/contracts";
import { TASK_PARK_LABELS, TASK_PARK_VARIANTS } from "../../src/shared/task-park-catalog";
import { PUBLIC_SPACES_CITY_NAME, PUBLIC_SPACES_DISTRICTS, PUBLIC_SPACES_PLAN } from "./compact-public-spaces-plan";

/** One-time empty-schema fixture only. The operator must create the exact
 * schema first. This script never drops, creates, clears or reseeds a schema. */
const SCHEMA = "compact_public_spaces_20260905";
const url = new URL(process.env.E2E_DATABASE_URL ?? "invalid");
if (process.env.E2E_COMPACT_PUBLIC_SPACES_FIXTURE !== "true"
  || !["postgres:", "postgresql:"].includes(url.protocol)
  || !["localhost", "127.0.0.1"].includes(url.hostname)
  || !["", "5432"].includes(url.port) || url.pathname !== "/tasktopia_test"
  || url.searchParams.get("options") !== `-csearch_path=${SCHEMA}`
  || [...url.searchParams.keys()].some(key => key !== "options")) {
  throw new Error(`Public spaces QA requires explicit opt-in and the exact disposable local ${SCHEMA} schema`);
}
assert.equal(PUBLIC_SPACES_PLAN.flat().length, 30);
assert.deepEqual([...new Set(PUBLIC_SPACES_PLAN.flat().flatMap(item => item.parkVariant ? [item.parkVariant] : []))].sort(),
  [...TASK_PARK_VARIANTS].sort(), "Fixture covers every public task-park variant");

const preflight = await createDb(url.toString(), { migrate: false, maxConnections: 1 });
try {
  assert.equal((await preflight.prepare("SELECT current_schema() AS schema").get<{ schema: string }>())?.schema, SCHEMA,
    "Create the exact isolated schema first; never fall back to public");
  for (const table of ["users", "countries"] as const) {
    const exists = await preflight.prepare("SELECT to_regclass(?) IS NOT NULL AS present").get<{ present: boolean }>(`${SCHEMA}.${table}`);
    if (exists?.present) assert.equal(Number((await preflight.prepare(`SELECT count(*) AS count FROM ${table}`)
      .get<{ count: string | number }>())?.count), 0, "Refusing to migrate or reseed a populated fixture");
  }
} finally { await preflight.close(); }

const db = await createDb(url.toString(), { maxConnections: 1 });
try {
  const summary = await db.transaction(async () => {
    await db.prepare("SELECT pg_advisory_xact_lock(hashtext(?))").get(`${SCHEMA}-one-time-seed`);
    assert.equal(Number((await db.prepare("SELECT (SELECT count(*) FROM users)+(SELECT count(*) FROM countries) AS count")
      .get<{ count: string | number }>())?.count), 0, "No reset or reseed is supported");
    const { user } = await registerUser(db, { email: "demo@tasktopia.local", password: "tasktopia-demo",
      name: "Public spaces QA", countryName: "Страна общественных пространств" });
    // Seed is the sole fixture-owned domain update. Coordinates, slots, roads,
    // variants and stages below are produced by normal service operations.
    await db.prepare("UPDATE countries SET seed=? WHERE id=?").run(424242, user.countryId);
    const service = new AppService(db);
    const city = await service.createCity(user.countryId, { name: PUBLIC_SPACES_CITY_NAME, idempotencyKey: "public-city" });
    const tasks: TaskDto[] = [];
    const stages: readonly TaskStatus[] = ["PLANNING", "STARTED", "IN_PROGRESS", "TESTING", "COMPLETED"];
    const districtIds: string[] = [];
    for (const [index, examples] of PUBLIC_SPACES_PLAN.entries()) {
      const district = await service.createDistrict(user.countryId, { cityId: city.id,
        name: PUBLIC_SPACES_DISTRICTS[index]!, idempotencyKey: `public-district-${index}` });
      await service.activateDistrict(user.countryId, district.id, `public-district-${index}-active`);
      districtIds.push(district.id);
      for (const example of examples) {
        const number = tasks.length + 1;
        let task = await service.createTask(user.countryId, {
          cityId: city.id, districtId: district.id,
          title: `${String(number).padStart(2, "0")} · ${example.parkVariant ? TASK_PARK_LABELS[example.parkVariant] : "Городской дом"} · стадия ${example.stage}`,
          description: "Изолированный визуальный стенд. Реальное распределение слотов, без подмены координат и спрайтов.",
          estimate: 1, visualKind: example.parkVariant ? "PARK" : "BUILDING", parkVariant: example.parkVariant,
          idempotencyKey: `public-task-${number}`,
        });
        for (let stage = 2; stage <= example.stage; stage++) task = await service.updateTaskStatus(user.countryId, {
          taskId: task.id, status: stages[stage - 1]!, actor: "Public spaces QA",
          comment: "Штатный переход стадии визуального стенда.", idempotencyKey: `public-task-${number}-stage-${stage}`,
        });
        if (example.parkVariant) assert.equal(task.visualAssetKey, example.parkVariant);
        assert.equal(task.stage, example.stage);
        if (example.parkVariant === "urban-fountain" || example.parkVariant === "urban-monument") {
          assert.ok(new Set(task.footprint.map(cell => cell.x)).size <= 6, "Landmark must occupy a compact real slot");
          assert.ok(new Set(task.footprint.map(cell => cell.y)).size <= 6, "Landmark must occupy a compact real slot");
        }
        if (example.parkVariant === "urban-large") {
          assert.equal(new Set(task.footprint.map(cell => cell.x)).size, 17);
          assert.equal(new Set(task.footprint.map(cell => cell.y)).size, 17);
          assert.equal(task.footprint.length, 289);
        }
        tasks.push(task);
      }
    }
    const scene = await new AppService(db).getCityScene(user.countryId, city.id);
    const rendered = new Map([...scene.chunks.flatMap(chunk => chunk.tasks),
      ...scene.completedDistrictSnapshots.flatMap(snapshot => snapshot.tasks)].map(task => [task.id, task]));
    assert.equal(rendered.size, 30); assert.equal((await service.listTasks(user.countryId)).length, 30);
    assert.equal((await service.listCities(user.countryId)).length, 1);
    assert.equal((await service.listDistricts(user.countryId)).length, 3);
    for (const task of tasks) {
      assert.equal(rendered.get(task.id)?.visualAssetKey, task.visualAssetKey);
      assert.deepEqual(rendered.get(task.id)?.footprint, task.footprint);
      assert.equal(rendered.get(task.id)?.stage, task.stage);
    }
    return { schema: SCHEMA, seed: 424242, countryId: user.countryId, cityId: city.id,
      cityName: city.name, districtIds, taskCount: tasks.length, sceneRevision: scene.sceneRevision,
      bounds: scene.city.bounds, tasks: tasks.map(task => ({ id: task.id, number: task.taskNumber, title: task.title,
        variant: task.visualAssetKey, family: task.buildingType, stage: task.stage, origin: task.origin, footprintCells: task.footprint.length })) };
  });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} finally { await db.close(); }
