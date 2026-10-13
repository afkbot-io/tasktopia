/** Isolated LOCAL load fixture. Geometry is authored by AppService. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import postgres from "postgres";
import { createDb, transaction } from "../src/server/db";
import { registerUser } from "../src/server/auth";
import { AppService } from "../src/server/app-service";
import { synchronizeCityBlocks } from "../src/server/world/active-block-layout";
import { auditWorld } from "../src/server/world/world-audit";

const count = Number(process.env.AUDIT_TASKS ?? 300);
assert.ok([200, 300, 1000].includes(count));
const url = process.env.TEST_DATABASE_URL ?? "postgres://tasktopia:tasktopia@127.0.0.1:55432/tasktopia_test";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(url).hostname));
assert.equal(new URL(url).pathname, "/tasktopia_test");
const schema = `city_loading_${randomUUID().replaceAll("-", "")}`;
const admin = postgres(url, { max: 1, onnotice: () => undefined });
try { await admin.unsafe(`CREATE SCHEMA "${schema}"`); } finally { await admin.end(); }
console.log(JSON.stringify({ schema, count }));
const db = await createDb(url, { schema });
try {
  const { user } = await registerUser(db, { email: "demo@tasktopia.local", password: "tasktopia-demo", name: "Local load QA" });
  await db.prepare("UPDATE countries SET seed=? WHERE id=?").run(424242, user.countryId);
  const service = new AppService(db);
  const city = await service.createCity(user.countryId, { name: `Загрузка ${count}`, morphology: "DENSE_CORE", idempotencyKey: "load-city" });
  for (let i = 0; i < count; i += 25) {
    const district = await service.createDistrict(user.countryId, { cityId: city.id, name: `Район ${i / 25 + 1}`, archetype: "NEW_BUILD", activate: false, idempotencyKey: `load-district-${i}` });
    for (let j = i; j < Math.min(i + 25, count); j++) await service.createTask(user.countryId, { cityId: city.id, districtId: district.id,
      title: `Нагрузка ${j + 1}`, estimate: 1, idempotencyKey: `load-task-${j}` });
    console.log(JSON.stringify({ schema, created: Math.min(i + 25, count) }));
  }
  // Existing performance-fixture pattern: bulk statuses only in this isolated
  // schema, then rebuild through the real compiler. No hand-authored geometry.
  const tasks = await service.listTasks(user.countryId);
  await transaction(db, async () => {
    for (let i = 0; i < tasks.length; i++) {
      const status = i < tasks.length * .8 ? "COMPLETED" : i < tasks.length * .95 ? "IN_PROGRESS" : "PLANNING";
      await db.prepare("UPDATE tasks_v3 SET status=?,progress=? WHERE id=?").run(status, status === "COMPLETED" ? 100 : status === "IN_PROGRESS" ? 50 : 0, tasks[i]!.id);
    }
    await synchronizeCityBlocks(db, user.countryId, city.id);
    await db.prepare("UPDATE countries SET world_version=world_version+1 WHERE id=?").run(user.countryId);
  });
  await service.activateDistrict(user.countryId, tasks[Math.ceil(tasks.length * .8)]!.districtId, "load-active");
  const audit = await auditWorld(db, service, user.countryId);
  assert.deepEqual(audit.violations, []);
  const scene = await service.getCityScene(user.countryId, city.id);
  await mkdir("tmp/city-art-load", { recursive: true });
  await writeFile(`tmp/city-art-load/fixture-${count}.json`, JSON.stringify({ schema, count, countryId: user.countryId, cityId: city.id, chunks: scene.chunks.length, audit }, null, 2));
} finally { await db.close(); }
