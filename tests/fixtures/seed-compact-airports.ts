import assert from "node:assert/strict";
import { AppService } from "../../src/server/app-service";
import { registerUser } from "../../src/server/auth";
import { createDb } from "../../src/server/db";

const schema = "compact_airports_20260906";
const url = new URL(process.env.E2E_DATABASE_URL ?? "invalid");
assert.ok(process.env.E2E_COMPACT_AIRPORTS === "true" && url.protocol === "postgres:" && url.hostname === "127.0.0.1"
  && url.port === "5432" && url.pathname === "/tasktopia_test" && url.searchParams.get("options") === `-csearch_path=${schema}`
  && [...url.searchParams.keys()].every(key => key === "options"), "Exact disposable local airport schema required");
const base = new URL(url); base.search = "";
const admin = await createDb(base.toString(), { migrate: false, maxConnections: 1 });
try {
  assert.equal(await admin.prepare("SELECT schema_name FROM information_schema.schemata WHERE schema_name=?").get(schema), undefined);
  await admin.exec(`CREATE SCHEMA ${schema}`);
} finally { await admin.close(); }
const db = await createDb(url.toString(), { maxConnections: 1 });
try {
  const result = await db.transaction(async () => {
    const { user } = await registerUser(db, { email: "demo@tasktopia.local", password: "tasktopia-demo", name: "Flight QA", countryName: "Воздушные маршруты · RC" });
    await db.prepare("UPDATE countries SET seed=424242 WHERE id=?").run(user.countryId);
    const service = new AppService(db); const airports = [];
    for (const name of ["Северный терминал", "Южный терминал"]) {
      const city = await service.createCity(user.countryId, { name, idempotencyKey: `${name}-city` });
      let districtId = "";
      for (let i = 0; i < 3; i++) {
        districtId = (await service.createDistrict(user.countryId, { cityId: city.id, name: `Спринт ${i + 1}`, idempotencyKey: `${name}-${i}` })).id;
        await service.createTask(user.countryId, { cityId: city.id, districtId, title: `Район ${i + 1}`, estimate: 1, idempotencyKey: `${name}-task-${i}` });
      }
      await service.activateDistrict(user.countryId, districtId, `${name}-activate`);
      let task = await service.createTask(user.countryId, { cityId: city.id, districtId, title: `${name}: аэропорт`, estimate: 1, idempotencyKey: `${name}-airport` });
      assert.equal(task.serviceRole, "AIRPORT");
      for (const status of ["STARTED", "IN_PROGRESS", "TESTING", "COMPLETED"] as const) task = await service.updateTaskStatus(user.countryId, {
        taskId: task.id, status, idempotencyKey: `${name}-${status}` });
      airports.push({ taskId: task.id, cityId: city.id, family: task.buildingType });
    }
    return { schema, countryId: user.countryId, airports };
  });
  process.stdout.write(JSON.stringify(result, null, 2));
} finally { await db.close(); }
