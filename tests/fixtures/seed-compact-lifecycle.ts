import assert from "node:assert/strict";
import { AppService } from "../../src/server/app-service";
import { registerUser } from "../../src/server/auth";
import { createDb } from "../../src/server/db";
import type { TaskStatus } from "../../src/shared/contracts";

const schema = process.env.E2E_LIFECYCLE_SCHEMA ?? "compact_lifecycle_20260906";
assert.ok(["compact_lifecycle_20260906", "compact_lifecycle_20260906_b"].includes(schema), "Only named disposable acceptance schemas are allowed");
const url = new URL(process.env.E2E_DATABASE_URL ?? "invalid");
assert.ok(process.env.E2E_PERMANENT_SITE_FIXTURE === "true" && url.protocol === "postgres:"
  && url.hostname === "127.0.0.1" && url.port === "5432" && url.pathname === "/tasktopia_test"
  && url.searchParams.get("options") === `-csearch_path=${schema}`
  && [...url.searchParams.keys()].every(key => key === "options"), "Exact disposable local lifecycle schema required");
const adminUrl = new URL(url); adminUrl.search = "";
const admin = await createDb(adminUrl.toString(), { migrate: false, maxConnections: 1 });
try {
  assert.equal(await admin.prepare("SELECT schema_name FROM information_schema.schemata WHERE schema_name=?").get(schema), undefined,
    "Never reset a previous mutable acceptance fixture");
  await admin.exec(`CREATE SCHEMA ${schema}`);
} finally { await admin.close(); }
const db = await createDb(url.toString(), { maxConnections: 1 });
try {
  const result = await db.transaction(async () => {
    const { user } = await registerUser(db, { email: "demo@tasktopia.local", password: "tasktopia-demo",
      name: "Lifecycle QA", countryName: "Компактная история · RC" });
    await db.prepare("UPDATE countries SET seed=424242 WHERE id=?").run(user.countryId);
    const service = new AppService(db);
    const city = await service.createCity(user.countryId, { name: "Город истории участков", idempotencyKey: "city" });
    const states: TaskStatus[] = ["PLANNING", "STARTED", "IN_PROGRESS", "TESTING", "COMPLETED"];
    for (let i = 0; i < 3; i++) {
      const district = await service.createDistrict(user.countryId, { cityId: city.id, name: `Спринт ${i + 1}`, idempotencyKey: `district-${i}` });
      await service.activateDistrict(user.countryId, district.id, `active-${i}`);
      for (let j = 0; j < 8; j++) {
        const task = await service.createTask(user.countryId, { cityId: city.id, districtId: district.id,
          title: `История ${i + 1}.${j + 1}`, estimate: 1, idempotencyKey: `task-${i}-${j}` });
        for (let stage = 2; stage <= 3 + j % 3; stage++) await service.updateTaskStatus(user.countryId, {
          taskId: task.id, status: states[stage - 1]!, idempotencyKey: `stage-${i}-${j}-${stage}` });
      }
    }
    return { schema, countryId: user.countryId, cityId: city.id, tasks: 24, districts: 3 };
  });
  process.stdout.write(JSON.stringify(result, null, 2));
} finally { await db.close(); }
