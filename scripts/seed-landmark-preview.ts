import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { createDb } from "../src/server/db";
import { registerUser } from "../src/server/auth";
import { AppService } from "../src/server/app-service";
import { auditWorld } from "../src/server/world/world-audit";

const databaseUrl = process.env.TEST_DATABASE_URL ?? "postgres://tasktopia:tasktopia@127.0.0.1:55432/tasktopia_test";
const url = new URL(databaseUrl);
assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && url.pathname === "/tasktopia_test");
const schema = `landmark_preview_${randomUUID().replaceAll("-", "")}`;
const admin = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
try { await admin.unsafe(`CREATE SCHEMA "${schema}"`); } finally { await admin.end(); }
const db = await createDb(databaseUrl, { schema });
try {
  const { user } = await registerUser(db, { email: "demo@tasktopia.local", password: "tasktopia-demo", name: "Проверка новых зданий" });
  await db.prepare("UPDATE countries SET seed = ? WHERE id = ?").run(424242, user.countryId);
  const service = new AppService(db);
  const city = await service.createCity(user.countryId, { name: "Торговый центр — стадии", idempotencyKey: "mall-city" });
  const district = await service.createDistrict(user.countryId, { cityId: city.id, name: "Проверка масштаба",
    archetype: "NEW_BUILD", capacitySp: 120, activate: false, idempotencyKey: "mall-district" });
  await service.activateDistrict(user.countryId, district.id, "mall-activate");
  const task = await service.createTask(user.countryId, { cityId: city.id, districtId: district.id,
    title: "Торговый центр «Атриум»", estimate: 3, visualKind: "BUILDING",
    buildingHint: "compact-city-mall-v1", idempotencyKey: "mall-task" });
  await assert.rejects(service.createTask(user.countryId, { cityId: city.id, districtId: district.id,
    title: "Недопустимый второй торговый центр", estimate: 3, visualKind: "BUILDING",
    buildingHint: "compact-city-mall-v1", idempotencyKey: "mall-duplicate" }),
  { code: "INVALID_INPUT" });
  for (let i = 0; i < 6; i++) {
    const home = await service.createTask(user.countryId, { cityId: city.id, districtId: district.id,
      title: `Жилой сосед ${i + 1}`, estimate: 1, visualKind: "BUILDING", idempotencyKey: `home-${i}` });
    for (const status of ["STARTED", "IN_PROGRESS", "TESTING", "COMPLETED"] as const) {
      await service.updateTaskStatus(user.countryId, { taskId: home.id, status, idempotencyKey: `home-${i}-${status}` });
    }
  }
  const audit = await auditWorld(db, service, user.countryId);
  assert.deepEqual(audit.violations, []);
  console.log(JSON.stringify({ schema, countryId: user.countryId, cityId: city.id, taskId: task.id, audit }));
} finally { await db.close(); }
