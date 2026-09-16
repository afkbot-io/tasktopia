import { afterEach, expect, it } from "vitest";
import { createTestDb, type Db } from "../src/server/db";
import { registerUser } from "../src/server/auth";
import { AppService } from "../src/server/app-service";

let db: Db | undefined;
afterEach(async () => { await db?.close(); });
it("stores PORT while a database constraint rejects concurrent second ports and unknown roles", async () => {
  db = await createTestDb();
  const { user } = await registerUser(db, { email: "port-store@example.test", name: "Port", password: "password123" });
  const service = new AppService(db);
  const city = await service.createCity(user.countryId, { name: "City", idempotencyKey: "city" });
  const district = await service.createDistrict(user.countryId, { cityId: city.id, name: "District", activate: false, idempotencyKey: "district" });
  const tasks = [];
  for (let i = 0; i < 2; i++) tasks.push(await service.createTask(user.countryId, { cityId: city.id, districtId: district.id, title: `Task ${i}`, estimate: 1, idempotencyKey: `task-${i}` }));
  await expect(service.createTask(user.countryId, { cityId: city.id, districtId: district.id,
    title: "Unverified seaport", estimate: 1, buildingHint: "compact-port-v1", idempotencyKey: "unverified-port",
  })).rejects.toThrow(/подтверждённый.*берег/);
  expect(await db.prepare("SELECT COUNT(*)::integer AS count FROM tasks_v3 WHERE city_id=?").get(city.id)).toEqual({ count: 2 });
  // These SQL writes exercise storage constraints, not permission to create a port.
  const results = await Promise.allSettled(tasks.map(task => db!.prepare("UPDATE tasks_v3 SET service_role='PORT' WHERE id=?").run(task.id)));
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  const rejected = results.find(result => result.status === "rejected") as PromiseRejectedResult;
  expect(String(rejected.reason)).toMatch(/one_port_per_city/);
  expect(await db.prepare("SELECT COUNT(*)::integer AS count FROM tasks_v3 WHERE city_id=? AND service_role='PORT'").get(city.id)).toEqual({ count: 1 });
  await expect(db.prepare("UPDATE tasks_v3 SET service_role='NOT_A_SERVICE' WHERE id=?").run(tasks[0]!.id)).rejects.toThrow(/service_role_check/);
});
