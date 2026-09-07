import { expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createTestDb } from "../src/server/db";
import { auditWorld } from "../src/server/world/world-audit";

it("audits suspended sprint work without resetting progress or allowing inactive stage changes", async () => {
  const db = await createTestDb();
  try {
    const { user } = await registerUser(db, { email: "sprint-audit@example.test", password: "local-audit-password", name: "Audit" });
    await db.prepare("UPDATE countries SET seed=424242 WHERE id=?").run(user.countryId);
    const service = new AppService(db);
    const city = await service.createCity(user.countryId, { name: "Sprint audit", idempotencyKey: "city" });
    const first = await service.createDistrict(user.countryId, { cityId: city.id, name: "First", activate: true, idempotencyKey: "first" });
    const task = await service.createTask(user.countryId, { cityId: city.id, districtId: first.id, title: "Keep my stage", estimate: 1, idempotencyKey: "task" });
    await service.updateTaskStatus(user.countryId, { taskId: task.id, status: "STARTED", idempotencyKey: "start" });
    const work = await service.updateTaskStatus(user.countryId, { taskId: task.id, status: "IN_PROGRESS", progress: 50, idempotencyKey: "work" });
    const second = await service.createDistrict(user.countryId, { cityId: city.id, name: "Second", idempotencyKey: "second" });
    await service.activateDistrict(user.countryId, second.id, "switch");
    expect((await service.listDistricts(user.countryId, city.id)).filter(d => d.status === "ACTIVE").map(d => d.id)).toEqual([second.id]);
    expect(await service.getTask(user.countryId, task.id)).toMatchObject({ status: work.status, progress: work.progress, origin: work.origin, buildingType: work.buildingType });
    await expect(service.updateTaskStatus(user.countryId, { taskId: task.id, status: "TESTING", idempotencyKey: "inactive-work" }))
      .rejects.toMatchObject({ code: "DISTRICT_NOT_ACTIVE" });
    expect((await auditWorld(db, service, user.countryId)).violations).toEqual([]);
    await service.activateDistrict(user.countryId, first.id, "resume");
    expect((await service.updateTaskStatus(user.countryId, { taskId: task.id, status: "TESTING", idempotencyKey: "resumed-work" })).stage).toBe(4);
    expect((await auditWorld(db, service, user.countryId)).violations).toEqual([]);
  } finally { await db.close(); }
});
