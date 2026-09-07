import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type Db } from "../src/server/db";
import { registerUser } from "../src/server/auth";
import { AppService } from "../src/server/app-service";

describe("checked civic service vocabulary", () => {
  let db: Db;
  beforeEach(async () => { db = await createTestDb(); });
  afterEach(async () => { await db.close(); });
  it("persists the new role without changing task identity and still rejects unknown roles", async () => {
    const { user } = await registerUser(db, { email: "civic@example.com", password: "safe-test-password", name: "Civic", countryName: "Civic test" });
    const service = new AppService(db);
    const city = await service.createCity(user.countryId, { name: "City", idempotencyKey: "city" });
    const district = await service.createDistrict(user.countryId, { cityId: city.id, name: "Sprint", activate: true, idempotencyKey: "sprint" });
    const task = await service.createTask(user.countryId, { cityId: city.id, districtId: district.id, title: "Admin", estimate: 1, idempotencyKey: "task" });
    await db.prepare("UPDATE tasks_v3 SET service_role=? WHERE id=?").run("CIVIC", task.id);
    expect(await db.prepare("SELECT id,task_number,title,service_role FROM tasks_v3 WHERE id=?").get(task.id))
      .toEqual({ id: task.id, task_number: task.taskNumber, title: "Admin", service_role: "CIVIC" });
    await expect(db.prepare("UPDATE tasks_v3 SET service_role=? WHERE id=?").run("NOT_A_SERVICE", task.id)).rejects.toThrow(/service_role_check/);
  });
});
