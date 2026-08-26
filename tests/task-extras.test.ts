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
    // Attachment/link/search contracts must not depend on a cryptographically
    // random world seed. Use the same reviewed city-generation fixture on
    // every platform so a terrain outlier cannot mask the API behavior under
    // test with an unrelated placement failure.
    await db.prepare("UPDATE countries SET seed = ? WHERE id = ?").run(424_242, countryId);
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
  }, 15_000);

  it("finds tasks by number and by title substring", async () => {
    await makeTask("Починить авторизацию", 1);
    await makeTask("Обновить лендинг", 2);
    const byNumber = await service.searchTasks(countryId, "2");
    const currentCity = (await service.listCities(countryId))[0]!;
    expect(byNumber).toHaveLength(1);
    expect(byNumber[0]!.title).toBe("Обновить лендинг");
    expect(byNumber[0]!.cityName).toBe("Extras City");
    expect(byNumber[0]!.cityCenter).toEqual(currentCity.center);
    expect(byNumber[0]!.cityBounds).toEqual(currentCity.bounds);
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

  it("keeps four standard Markdown documents and supports extra agent documents", async () => {
    const task = await service.createTask(countryId, {
      cityId, districtId, title: "Задача с документами", estimate: 1,
      systemAnalysis: "# Исходный анализ\n\nКонтекст из старого контракта.",
      idempotencyKey: "task-documents",
    });

    expect(task.documents?.map((document) => document.fileName)).toEqual([
      "system-analysis.md", "architecture.md", "design-system.md", "implementation-plan.md",
    ]);
    expect(task.documents?.[0]).toMatchObject({ title: "Системный анализ", content: expect.stringContaining("Исходный анализ"), isDefault: true });

    const architecture = await service.upsertTaskDocument(countryId, {
      taskId: task.id, fileName: "architecture.md", content: "# Решение\n\nPostgreSQL остаётся source of truth.",
      actor: "Extras", idempotencyKey: "document-architecture",
    });
    expect(architecture).toMatchObject({ fileName: "architecture.md", isDefault: true, actor: "Extras" });

    const rollout = await service.upsertTaskDocument(countryId, {
      taskId: task.id, fileName: "rollout.md", title: "План выкладки", content: "- [ ] canary\n- [ ] production",
      actor: "Extras", idempotencyKey: "document-rollout",
    });
    expect(rollout).toMatchObject({ fileName: "rollout.md", isDefault: false });
    expect((await service.getTask(countryId, task.id)).documents).toHaveLength(5);

    await expect(service.upsertTaskDocument(countryId, {
      taskId: task.id, fileName: "diagram.pdf", title: "Схема", content: "binary",
      idempotencyKey: "document-invalid",
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    for (const fileName of ["trailing-.md", "double--dash.md"]) {
      await expect(service.upsertTaskDocument(countryId, {
        taskId: task.id, fileName, title: "Некорректное имя", content: "text",
        idempotencyKey: `document-invalid-${fileName}`,
      })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    await expect(service.deleteTaskDocument(countryId, {
      taskId: task.id, documentId: architecture.id, idempotencyKey: "document-default-delete",
    })).rejects.toMatchObject({ code: "DEFAULT_DOCUMENT" });

    await service.deleteTaskDocument(countryId, {
      taskId: task.id, documentId: rollout.id, actor: "Extras", idempotencyKey: "document-rollout-delete",
    });
    const detailed = await service.getTask(countryId, task.id);
    expect(detailed.documents).toHaveLength(4);
    expect(detailed.events?.map((event) => event.type)).toEqual(expect.arrayContaining(["DOCUMENT_UPDATED", "DOCUMENT_DELETED"]));
  });

  it("replaces an agent checklist and updates individual progress", async () => {
    const task = await makeTask("Задача с чек-листом", 20);
    const checklist = await service.replaceTaskChecklist(countryId, {
      taskId: task.id,
      items: [
        { title: "Добавить миграцию" },
        { title: "Покрыть сервис тестом", done: true },
        { title: "Проверить MCP-контракт" },
      ],
      actor: "Extras", idempotencyKey: "checklist-replace",
    });
    expect(checklist).toHaveLength(3);
    expect(checklist.map((item) => [item.title, item.done, item.position])).toEqual([
      ["Добавить миграцию", false, 0], ["Покрыть сервис тестом", true, 1], ["Проверить MCP-контракт", false, 2],
    ]);

    const completed = await service.updateTaskChecklistItem(countryId, {
      taskId: task.id, itemId: checklist[0]!.id, done: true, actor: "Extras", idempotencyKey: "checklist-done",
    });
    expect(completed).toMatchObject({ title: "Добавить миграцию", done: true });
    expect((await service.getTask(countryId, task.id)).checklist?.filter((item) => item.done)).toHaveLength(2);
    expect((await service.getTask(countryId, task.id)).events?.map((event) => event.type))
      .toEqual(expect.arrayContaining(["CHECKLIST_REPLACED", "CHECKLIST_ITEM_UPDATED"]));
    const auditEvents = (await service.getTask(countryId, task.id)).events!;
    expect(auditEvents.find((event) => event.type === "CHECKLIST_REPLACED")?.details).toMatchObject({
      before: [],
      after: expect.arrayContaining([expect.objectContaining({ title: "Добавить миграцию", done: false })]),
    });
    expect(auditEvents.find((event) => event.type === "CHECKLIST_ITEM_UPDATED")?.details).toMatchObject({
      before: { title: "Добавить миграцию", done: false },
      after: { title: "Добавить миграцию", done: true },
    });

    await service.updateTaskStatus(countryId, { taskId: task.id, status: "STARTED", idempotencyKey: "checklist-start" });
    await service.updateTaskStatus(countryId, { taskId: task.id, status: "IN_PROGRESS", idempotencyKey: "checklist-progress" });
    await service.updateTaskStatus(countryId, { taskId: task.id, status: "TESTING", idempotencyKey: "checklist-testing" });
    await expect(service.updateTaskStatus(countryId, { taskId: task.id, status: "COMPLETED", idempotencyKey: "checklist-complete-blocked" }))
      .rejects.toMatchObject({ code: "CHECKLIST_INCOMPLETE" });
    for (const item of checklist.filter((candidate) => !candidate.done && candidate.id !== checklist[0]!.id)) {
      await service.updateTaskChecklistItem(countryId, {
        taskId: task.id, itemId: item.id, done: true, idempotencyKey: `checklist-complete-${item.position}`,
      });
    }
    await expect(service.updateTaskStatus(countryId, { taskId: task.id, status: "COMPLETED", idempotencyKey: "checklist-completed" }))
      .resolves.toMatchObject({ status: "COMPLETED" });

    await expect(service.replaceTaskChecklist(countryId, {
      taskId: task.id, items: [{ title: "Одинаковый шаг" }, { title: "Одинаковый шаг" }], idempotencyKey: "checklist-duplicates",
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await service.replaceTaskChecklist(countryId, {
      taskId: task.id, items: [], idempotencyKey: "checklist-clear",
    })).toEqual([]);
  });
});
