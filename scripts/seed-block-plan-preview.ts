import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { createDb } from "../src/server/db";
import { registerUser } from "../src/server/auth";
import { AppService } from "../src/server/app-service";
import { readActiveBlockLayout } from "../src/server/world/active-block-layout";
import { auditWorld } from "../src/server/world/world-audit";
import type { TaskStatus } from "../src/shared/contracts";

// Always create a new local test schema. Never wipe or reuse an existing world.
const databaseUrl = process.env.TEST_DATABASE_URL ?? "postgres://tasktopia:tasktopia@127.0.0.1:5432/tasktopia_test";
const url = new URL(databaseUrl);
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && url.pathname === "/tasktopia_test",
  "Block preview is restricted to a local tasktopia_test database");
const schema = `block_plan_preview_${randomUUID().replaceAll("-", "")}`;
const admin = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
try { await admin.unsafe(`CREATE SCHEMA "${schema}"`); } finally { await admin.end(); }
console.error(`Preview schema: ${schema}`);
const db = await createDb(databaseUrl, { schema });
try {
  const { user } = await registerUser(db, { email: "demo@tasktopia.local", password: "tasktopia-demo", name: "Кварталы v3" });
  await db.prepare("UPDATE countries SET seed = ? WHERE id = ?").run(424242, user.countryId);
  const service = new AppService(db);
  const city = await service.createCity(user.countryId, { name: "Разнообразные кварталы", idempotencyKey: "preview-city" });
  let parks = 0;
  const stages: TaskStatus[] = ["STARTED", "IN_PROGRESS", "TESTING", "COMPLETED"];
  for (let d = 0; d < 3; d++) {
    const district = await service.createDistrict(user.countryId, { cityId: city.id, name: `Спринт ${d + 1}`,
      archetype: "NEW_BUILD", capacitySp: 120, activate: false, idempotencyKey: `preview-district-${d}` });
    await service.activateDistrict(user.countryId, district.id, `preview-activate-${d}`);
    for (let i = 0; i < 32; i++) {
      const key = `preview-${d}-${i}`;
      const task = await service.createTask(user.countryId, { cityId: city.id, districtId: district.id,
        title: `Участок ${d * 32 + i + 1}`, estimate: 1, idempotencyKey: key });
      const steps = task.visualKind === "PARK" ? (parks++ % 3) * 2 : i % 5;
      for (let step = 0; step < steps; step++) {
        await service.updateTaskStatus(user.countryId, { taskId: task.id, status: stages[step]!,
          idempotencyKey: `${key}-stage-${step}` });
      }
    }
  }
  const layout = (await readActiveBlockLayout(db, city.id))!;
  assert.equal(layout.placements.length, 96);
  assert.ok(layout.blocks.every(b => b.templateVersion === 3 && b.parameters.sitePlan));
  const audit = await auditWorld(db, service, user.countryId);
  assert.deepEqual(audit.violations, []);
  console.log(JSON.stringify({ schema, countryId: user.countryId, cityId: city.id, blocks: layout.blocks.length, parks,
    templateVersion: 3, tasks: 96, audit }, null, 2));
} finally { await db.close(); }
