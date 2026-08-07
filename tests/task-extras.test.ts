import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppService, DomainError } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";

describe("task extras: numbers, MR links, attachments, search", () => {
  let db: Db;
  let service: AppService;
  let countryId: string;
  let cityId: string;
  let districtId: string;
  let uploadDir: string;

  const makeTask = async (title: string, index: number) => await service.createTask(countryId, {
    cityId, districtId, title, estimate: 1, idempotencyKey: `task-${index}`,
  });

  beforeEach(async () => {
    db = await createTestDb();
    uploadDir = await mkdtemp(join(tmpdir(), "tasktopia-uploads-"));
    countryId = (await registerUser(db, { email: "extras@example.com", name: "Extras", password: "password123" })).user.countryId;
    service = new AppService(db, undefined, uploadDir);
    const city = await service.createCity(countryId, { name: "Extras City", idempotencyKey: "city" });
    cityId = city.id;
    const district = await service.createDistrict(countryId, { cityId, name: "Sprint", activate: true, idempotencyKey: "district" });
    districtId = district.id;
  });

  afterEach(async () => {
    await db.close();
    await rm(uploadDir, { recursive: true, force: true });
  });

  it("assigns sequential per-country task numbers and keeps them through regeneration", async () => {
    const first = await makeTask("Первая задача", 1);
    const second = await makeTask("Вторая задача", 2);
    expect(first.taskNumber).toBe(1);
    expect(second.taskNumber).toBe(2);
    await service.regenerateCountry(countryId, { confirmName: "Extras: страна", idempotencyKey: "regenerate" });
    const after = await service.getTask(countryId, second.id);
    expect(after.taskNumber).toBe(2);
  });

  it("finds tasks by number and by title substring", async () => {
    await makeTask("Починить авторизацию", 1);
    await makeTask("Обновить лендинг", 2);
    const byNumber = await service.searchTasks(countryId, "2");
    expect(byNumber).toHaveLength(1);
    expect(byNumber[0]!.title).toBe("Обновить лендинг");
    expect(byNumber[0]!.cityName).toBe("Extras City");
    const byTitle = await service.searchTasks(countryId, "авториз");
    expect(byTitle).toHaveLength(1);
    expect(byTitle[0]!.taskNumber).toBe(1);
    expect(await service.searchTasks(countryId, "   ")).toEqual([]);
    // SQL wildcards in the query stay literal characters, not pattern magic.
    expect(await service.searchTasks(countryId, "%")).toEqual([]);
  });

  it("adds, lists and removes merge request links with a chronicle", async () => {
    const task = await makeTask("Задача со ссылками", 1);
    const url = "https://gitlab.example.com/repo/-/merge_requests/7";
    const withLink = await service.addTaskLink(countryId, {
      taskId: task.id, url, title: "MR-7: фикс", actor: "Extras", idempotencyKey: "link-add",
    });
    expect(withLink.mergeRequests).toHaveLength(1);
    expect(withLink.mergeRequests[0]).toMatchObject({ url, title: "MR-7: фикс", actor: "Extras" });
    await expect(service.addTaskLink(countryId, { taskId: task.id, url, idempotencyKey: "link-add-duplicate" }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    await expect(service.addTaskLink(countryId, { taskId: task.id, url: "javascript:alert(1)", idempotencyKey: "link-add-evil" }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    const without = await service.removeTaskLink(countryId, { taskId: task.id, url, actor: "Extras", idempotencyKey: "link-remove" });
    expect(without.mergeRequests).toHaveLength(0);
    const events = (await service.getTask(countryId, task.id)).events!.map((event) => event.type);
    expect(events).toContain("LINK_ADDED");
    expect(events).toContain("LINK_REMOVED");
  });

  it("stores attachment bytes on disk, lists metadata and deletes cleanly", async () => {
    const task = await makeTask("Задача с файлами", 1);
    const content = Buffer.from("%PDF-1.4 fake report bytes", "utf8");
    const attachment = await service.addTaskAttachment(countryId, {
      taskId: task.id, fileName: "отчёт ..\\prod.pdf", mimeType: "application/pdf", content,
      actor: "Extras", idempotencyKey: "attachment-add",
    });
    // Path traversal in the original name is stripped down to a safe basename.
    expect(attachment.fileName).toBe("prod.pdf");
    const { absolutePath } = await service.getTaskAttachment(countryId, attachment.id);
    expect(absolutePath.startsWith(uploadDir)).toBe(true);
    expect(await readFile(absolutePath)).toEqual(content);
    const detailed = await service.getTask(countryId, task.id);
    expect(detailed.attachments).toHaveLength(1);
    expect(detailed.attachments![0]).toMatchObject({ fileName: attachment.fileName, sizeBytes: content.length, actor: "Extras" });
    expect((await service.getTask(countryId, task.id)).events!.map((event) => event.type)).toContain("ATTACHMENT_ADDED");

    await service.deleteTaskAttachment(countryId, { attachmentId: attachment.id, idempotencyKey: "attachment-delete" });
    expect((await service.getTask(countryId, task.id)).attachments).toHaveLength(0);
    await expect(stat(absolutePath)).rejects.toThrow();
    await expect(service.getTaskAttachment(countryId, attachment.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects oversized and empty uploads", async () => {
    const task = await makeTask("Лимиты вложений", 1);
    await expect(service.addTaskAttachment(countryId, {
      taskId: task.id, fileName: "empty.bin", content: Buffer.alloc(0), idempotencyKey: "attachment-empty",
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(service.addTaskAttachment(countryId, {
      taskId: task.id, fileName: "huge.bin", content: Buffer.alloc(11 * 1024 * 1024, 1), idempotencyKey: "attachment-huge",
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("does not leak attachments across countries", async () => {
    const task = await makeTask("Чужой файл", 1);
    const attachment = await service.addTaskAttachment(countryId, {
      taskId: task.id, fileName: "note.txt", content: Buffer.from("secret"), idempotencyKey: "attachment-owner",
    });
    const other = await registerUser(db, { email: "other@example.com", name: "Other", password: "password123" });
    await expect(service.getTaskAttachment(other.user.countryId, attachment.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(new DomainError("X", "y")).toBeInstanceOf(Error);
  });
});
