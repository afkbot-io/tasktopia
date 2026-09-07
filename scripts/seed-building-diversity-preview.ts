import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { createDb } from "../src/server/db";
import { registerUser } from "../src/server/auth";
import { AppService } from "../src/server/app-service";
import { auditWorld } from "../src/server/world/world-audit";
import type { TaskStatus } from "../src/shared/contracts";

// Public domain operations in a new, isolated LOCAL schema only. No scene mocks
// or edits to durable slot assignments; fixtures exercise actual construction.
const databaseUrl = process.env.TEST_DATABASE_URL ?? "postgres://tasktopia:tasktopia@127.0.0.1:5432/tasktopia_test";
const url = new URL(databaseUrl);
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && url.pathname === "/tasktopia_test");
const schema = `building_diversity_${randomUUID().replaceAll("-", "")}`;
const admin = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
try { await admin.unsafe(`CREATE SCHEMA "${schema}"`); } finally { await admin.end(); }
console.error(`Preview schema: ${schema}`);
const db = await createDb(databaseUrl, { schema });
try {
  const { user } = await registerUser(db, { email: "demo@tasktopia.local", password: "tasktopia-demo", name: "Building art QA" });
  await db.prepare("UPDATE countries SET seed = ? WHERE id = ?").run(424242, user.countryId);
  const service = new AppService(db);
  const city = await service.createCity(user.countryId, { name: "Новые дома — все стадии", idempotencyKey: "art-city" });
  const families = ["compact-blue-bay-v1", "compact-copper-court-v1"];
  const statuses: TaskStatus[] = ["STARTED", "IN_PROGRESS", "TESTING", "COMPLETED"];
  const tasks = [];
  for (const family of families) {
    const district = await service.createDistrict(user.countryId, { cityId: city.id, name: family,
      archetype: "NEW_BUILD", capacitySp: 120, activate: false, idempotencyKey: `district-${family}` });
    await service.activateDistrict(user.countryId, district.id, `activate-${family}`);
    for (let stage = 1; stage <= 5; stage++) {
      const create = () => service.createTask(user.countryId, { cityId: city.id, districtId: district.id,
        title: `${family} — стадия ${stage}`, estimate: 1, visualKind: "BUILDING", buildingHint: family,
        idempotencyKey: `${family}-${stage}` });
      let task;
      for (let attempt = 0; attempt < 8; attempt++) {
        try { task = await create(); break; }
        catch (error) {
          if (!(error instanceof Error) || !("code" in error) || error.code !== "INFRASTRUCTURE_RESERVATION_CONFLICT") throw error;
          // Honor reserved shop/service sites with a real next task; never
          // clear reservation data just to fit a screenshot fixture.
          await service.createTask(user.countryId, { cityId: city.id, districtId: district.id,
            title: `Инфраструктура ${family}/${stage}/${attempt}`, estimate: 1,
            idempotencyKey: `service-${family}-${stage}-${attempt}` });
        }
      }
      assert.ok(task, "Could not reach a compatible unreserved art parcel");
      for (let step = 0; step < stage - 1; step++) task = await service.updateTaskStatus(user.countryId, {
        taskId: task.id, status: statuses[step]!, idempotencyKey: `${family}-${stage}-${step}` });
      assert.equal(task.buildingType, family); assert.equal(task.stage, stage);
      tasks.push({ id: task.id, stage, family });
    }
  }
  const audit = await auditWorld(db, service, user.countryId);
  assert.deepEqual(audit.violations, []);
  console.log(JSON.stringify({ schema, countryId: user.countryId, cityId: city.id, tasks, audit }, null, 2));
} finally { await db.close(); }
