import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { createTestDb, type Db } from "../src/server/db";
import { registerUser } from "../src/server/auth";
import type { TaskDto } from "../src/shared/contracts";

describe("bounded task scalar audit changes", () => {
  let db: Db; let service: AppService; let countryId: string; let userId: string; let task: TaskDto;
  beforeEach(async () => {
    db = await createTestDb(); service = new AppService(db);
    const owner = (await registerUser(db, { email: "audit-scalars@example.test", name: "Audit owner", password: "password123" })).user;
    countryId = owner.countryId; userId = owner.id;
    await db.prepare("UPDATE countries SET seed=424242 WHERE id=?").run(countryId);
    const city = await service.createCity(countryId, { name: "Audit city", idempotencyKey: "audit-city" });
    const district = await service.createDistrict(countryId, { cityId: city.id, name: "Audit district", activate: true, idempotencyKey: "audit-district" });
    task = await service.createTask(countryId, { cityId: city.id, districtId: district.id, title: "Original title", estimate: 1, creatorUserId: userId, idempotencyKey: "audit-task" });
  });
  afterEach(async () => { await db?.close(); });

  it("records actual before/after scalars without copying Markdown or large bodies", async () => {
    await service.updateTaskFields(countryId, { taskId: task.id, title: "Revised title", priority: "HIGH", estimate: 2, workItemType: "BUG",
      dueAt: "2026-11-01T12:00:00.000Z", description: "PRIVATE_LONG_BODY".repeat(300), architecture: "PRIVATE_MARKDOWN".repeat(800),
      actorUserId: userId, idempotencyKey: "scalar-fields" });
    const event = (await service.getTask(countryId, task.id)).events!.findLast(item => item.type === "FIELDS_UPDATED")!;
    expect(event.details.changes).toEqual(expect.arrayContaining([
      { field: "title", before: "Original title", after: "Revised title" },
      { field: "priority", before: "NORMAL", after: "HIGH" }, { field: "estimate", before: 1, after: 2 },
      { field: "workItemType", before: "TASK", after: "BUG" }, { field: "dueAt", before: null, after: "2026-11-01T12:00:00.000Z" },
    ]));
    expect(event.details.changedFields).toContain("architecture");
    expect(JSON.stringify(event.details)).not.toContain("PRIVATE_");
    expect(JSON.stringify(event.details).length).toBeLessThan(2000);
    const before = await service.listEvents(countryId);
    await service.updateTaskFields(countryId, { taskId: task.id, title: "Revised title", priority: "HIGH", estimate: 2, workItemType: "BUG",
      dueAt: "2026-11-01T12:00:00.000Z", description: "PRIVATE_LONG_BODY".repeat(300), architecture: "PRIVATE_MARKDOWN".repeat(800),
      actorUserId: userId, idempotencyKey: "scalar-fields" });
    expect(await service.listEvents(countryId)).toEqual(before);
  });

  it("retains legacy status/title metadata and captures verified autoassign plus progress", async () => {
    await service.renameTask(countryId, { taskId: task.id, title: "Renamed title", idempotencyKey: "audit-rename" });
    await service.updateTaskStatus(countryId, { taskId: task.id, status: "STARTED", actorUserId: userId, idempotencyKey: "audit-start" }, "compact");
    const events = (await service.getTask(countryId, task.id)).events!;
    expect(events.find(item => item.type === "TITLE_CHANGED")!.details).toMatchObject({ from: "Original title", to: "Renamed title",
      changes: [{ field: "title", before: "Original title", after: "Renamed title" }] });
    expect(events.findLast(item => item.type === "STATUS_CHANGED")!.details).toMatchObject({ from: "PLANNING", to: "STARTED",
      changes: expect.arrayContaining([{ field: "status", before: "PLANNING", after: "STARTED" }, expect.objectContaining({ field: "assignee", before: null, after: userId, afterLabel: "Audit owner" })]) });
    await service.updateTaskStatus(countryId, { taskId: task.id, status: "IN_PROGRESS", progress: 55, actorUserId: userId, idempotencyKey: "audit-progress" }, "compact");
    const progress = (await service.getTask(countryId, task.id)).events!.findLast(item => item.type === "STATUS_CHANGED")!;
    expect(progress.details.changes).toContainEqual({ field: "progress", before: 0, after: 55 });
    await service.assignTask(countryId, { taskId: task.id, assigneeUserId: null, actorUserId: userId, idempotencyKey: "audit-unassign" });
    expect((await service.getTask(countryId, task.id)).events!.findLast(item => item.type === "ASSIGNEE_CHANGED")!.details.changes)
      .toMatchObject([{ field: "assignee", before: userId, after: null, beforeLabel: "Audit owner", afterLabel: null }]);
  });
});
