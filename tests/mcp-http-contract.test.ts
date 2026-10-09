import { Client, StreamableHTTPClientTransport, type Tool } from "@modelcontextprotocol/client";
import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppService } from "../src/server/app-service";
import { createCountry, createMcpToken, inviteCountryMember, registerUser, setActiveCountry } from "../src/server/auth";
import { config } from "../src/server/config";
import { createTestDb, type Db } from "../src/server/db";
import { registerMcpHttp } from "../src/server/mcp-http";
import { serializeRequest } from "../src/server/request-logging";
import { enqueueWorldGenerationJob, PostgresWorldGenerationDispatcher, processNextWorldGenerationJob } from "../src/server/world-generation-jobs";
import { MCP_SCOPES, type CityDto, type DistrictDto, type TaskDto } from "../src/shared/contracts";

const expectedNames = [
  "country.get", "country.list", "country.update_profile", "world_generation.get",
  "city.list", "city.get", "city.create", "city.update", "city.rename", "city.delete",
  "district.list", "district.create", "district.update", "district.rename", "district.activate", "district.complete", "district.delete",
  "task.list", "task.get", "task.create", "task.transfer", "task.update_fields", "task.defect_create", "task.defect_update", "task.rename", "task.delete",
  "task.set_status", "task.report_progress", "task.add_comment", "task.assign", "task.activity", "task.dependency_add", "task.dependency_remove",
  "task.document_list", "task.document_upsert", "task.document_delete", "task.checklist_replace", "task.checklist_item_update",
  "task.link_add", "task.link_remove", "task.attachment_add", "task.attachment_list",
  "archive.get", "archive.record_list", "archive.record_create", "archive.record_update", "archive.record_delete",
] as const;
const result = <T>(value: Awaited<ReturnType<Client["callTool"]>>): T => {
  expect(value.isError, JSON.stringify(value.content)).not.toBe(true);
  expect(value.structuredContent).toHaveProperty("result");
  const data = (value.structuredContent as { result: T }).result;
  expect(JSON.parse((value.content[0] as { text: string }).text)).toEqual(data);
  return data;
};
const errorCode = (value: Awaited<ReturnType<Client["callTool"]>>) => {
  expect(value.isError).toBe(true);
  return JSON.parse((value.content[0] as { text: string }).text).code as string;
};

describe("real MCP HTTP catalog, authorization and lifecycle", { timeout: 60_000 }, () => {
  let db: Db, app: FastifyInstance, service: AppService, base: string, uploads: string;
  let countryId: string, userId: string, foreignCountryId: string, viewerId: string;
  let ownerToken: string, readToken: string, viewerToken: string, taskOnlyToken: string;
  let home: TaskDto, foreign: TaskDto, jobId: string, tools: Tool[], client: Client;
  const clients: Client[] = [];
  const connect = async (token = ownerToken, modern = true) => {
    const instance = new Client({ name: "tasktopia-http-contract", version: "1.0.0" }, modern ? { versionNegotiation: { mode: "auto" } } : undefined);
    await instance.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }));
    clients.push(instance);
    return instance;
  };
  const call = (name: string, args: Record<string, unknown> = {}, caller = client) => caller.callTool({ name, arguments: { countryId, ...args } });
  const version = async () => (await service.getCountry(countryId)).worldVersion;
  const snapshot = async () => ({ version: await version(), events: await service.listEvents(countryId), task: await service.getTask(countryId, home.id) });
  const minimal = (tool: Tool): Record<string, unknown> => {
    const values: Record<string, unknown> = {
      countryId, cityId: home.cityId, districtId: home.districtId, taskId: home.id,
      recordId: crypto.randomUUID(), defectId: crypto.randomUUID(), documentId: crypto.randomUUID(), itemId: crypto.randomUUID(),
      targetDistrictId: home.districtId, dependsOnTaskId: home.id, jobId,
      name: "Проверка MCP", title: "Проверка MCP", confirmName: "Проверка MCP", confirmTitle: home.title,
      description: "Контракт", body: "Комментарий", content: "# Проверка", fileName: "contract.md",
      contentBase64: Buffer.from("proof").toString("base64"), kind: "PROJECT", estimate: 1, status: "STARTED", progress: 0,
      comment: "Проверка", assigneeEmail: null, url: "https://example.test/review/1", items: [{ title: "Проверить" }],
      reproductionSteps: "Открыть", actualResult: "Ошибка", expectedResult: "Успех", idempotencyKey: `denied-${tool.name}`,
    };
    const args = Object.fromEntries((tool.inputSchema.required ?? []).map(key => [key, values[key]]));
    if (tool.name === "task.checklist_item_update") args.done = true;
    if (tool.name === "task.defect_update") args.status = "IN_PROGRESS";
    return args;
  };

  beforeAll(async () => {
    db = await createTestDb(); uploads = await mkdtemp(join(tmpdir(), "tasktopia-mcp-contract-"));
    service = new AppService(db, undefined, uploads);
    const owner = await registerUser(db, { email: "mcp-http-owner@example.test", name: "Владелец MCP", password: "password123" });
    const outsider = await registerUser(db, { email: "mcp-http-outsider@example.test", name: "Чужой MCP", password: "password123" });
    const viewer = await registerUser(db, { email: "mcp-http-viewer@example.test", name: "Наблюдатель MCP", password: "password123" });
    const reader = await registerUser(db, { email: "mcp-http-reader@example.test", name: "Читатель MCP", password: "password123" });
    const taskReader = await registerUser(db, { email: "mcp-http-task-reader@example.test", name: "Читатель задач MCP", password: "password123" });
    countryId = owner.user.countryId; userId = owner.user.id; foreignCountryId = outsider.user.countryId; viewerId = viewer.user.id;
    for (const person of [viewer, reader, taskReader]) await inviteCountryMember(db, countryId, userId, person.user.email, "VIEWER");
    for (const scope of [countryId, foreignCountryId]) await db.prepare("UPDATE countries SET seed=424242 WHERE id=?").run(scope);
    const seed = async (scope: string) => {
      const city = await service.createCity(scope, { name: "Базовый город", idempotencyKey: "base-city" });
      const district = await service.createDistrict(scope, { cityId: city.id, name: "Базовый район", activate: true, idempotencyKey: "base-district" });
      return service.createTask(scope, { cityId: city.id, districtId: district.id, title: "Базовая задача", estimate: 1, idempotencyKey: "base-task" });
    };
    home = await seed(countryId); foreign = await seed(foreignCountryId);
    jobId = (await enqueueWorldGenerationJob(db, countryId, "city.create", "contract-job", { name: "Ожидающий город", idempotencyKey: "contract-job" })).id;
    ownerToken = (await createMcpToken(db, countryId, "Owner", userId)).token;
    readToken = (await createMcpToken(db, reader.user.countryId, "Read", reader.user.id, { scopes: ["country:read"] })).token;
    taskOnlyToken = (await createMcpToken(db, taskReader.user.countryId, "Tasks", taskReader.user.id, { scopes: ["tasks:read"] })).token;
    // A token retaining its home-country write scopes still cannot write in a
    // different country where its current membership is VIEWER.
    viewerToken = (await createMcpToken(db, viewer.user.countryId, "Viewer home", viewerId)).token;
    app = Fastify({ bodyLimit: 20_000_000 });
    registerMcpHttp(app, db, service, "http://localhost:3000");
    base = await app.listen({ host: "127.0.0.1", port: 0 });
    client = await connect(); tools = (await client.listTools()).tools;
  }, 60_000);
  afterAll(async () => {
    for (const instance of clients) await instance.close().catch(() => undefined);
    await app?.close(); await db?.close(); if (uploads) await rm(uploads, { recursive: true, force: true });
  });

  it("negotiates modern and legacy contracts with truthful capabilities and explicit schemas", async () => {
    expect(client.getProtocolEra()).toBe("modern");
    expect(client.getServerCapabilities()).toHaveProperty("tools");
    expect(client.getServerCapabilities()).toHaveProperty("resources");
    expect(client.getServerCapabilities()).not.toHaveProperty("prompts");
    expect(tools.map(tool => tool.name).sort()).toEqual([...expectedNames].sort());
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object");
      if (tool.name !== "country.list") expect(tool.inputSchema.required, tool.name).toContain("countryId");
      if (!tool.annotations?.readOnlyHint) {
        expect(tool.inputSchema.required, tool.name).toContain("idempotencyKey");
        expect(tool.annotations?.idempotentHint, tool.name).toBe(true);
      }
    }
    expect(client.getInstructions()).toContain("available for another task");
    expect(client.getInstructions()).toContain("Deleting a task leaves permanent ruins");
    const legacy = await connect(ownerToken, false);
    expect(legacy.getProtocolEra()).toBe("legacy");
    expect((await legacy.listTools()).tools.map(tool => tool.name).sort()).toEqual([...expectedNames].sort());
    expect(result<{ country: { id: string } }>(await call("country.get", {}, legacy)).country.id).toBe(countryId);
    const templates = await client.listResourceTemplates(), resources = await client.listResources();
    expect(templates.resourceTemplates.map(template => template.uriTemplate)).toEqual(["tasktopia://countries/{countryId}"]);
    expect(resources.resources.map(resource => resource.uri)).toEqual(["tasktopia://catalog/buildings"]);
    expect((await legacy.readResource({ uri: `tasktopia://countries/${countryId}` })).contents).toHaveLength(1);
    expect((await client.readResource({ uri: "tasktopia://catalog/buildings" })).contents).toHaveLength(1);
  });

  it("executes every advertised tool through HTTP, reads real state and retries every write without new events", async () => {
    const used = new Set<string>();
    const checked = async <T>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
      used.add(name); const response = await call(name, args), data = result<T>(response);
      if (tools.find(tool => tool.name === name)?.annotations?.idempotentHint) {
        const before = await version(), events = await service.listEvents(countryId);
        const replay = await call(name, args);
        expect(replay.structuredContent, name).toEqual(response.structuredContent);
        expect(await version(), name).toBe(before); expect(await service.listEvents(countryId), name).toEqual(events);
      }
      return data;
    };
    await checked("country.list"); await checked("country.get");
    await checked("country.update_profile", { goal: "Проверить MCP", idempotencyKey: "all-profile" });
    expect(await checked("world_generation.get", { jobId })).toMatchObject({ status: "PENDING" });
    await checked("archive.get");
    const record = await checked<{ id: string }>("archive.record_create", { kind: "CONVENTION", title: "Контракт", body: "Правило", idempotencyKey: "all-record" });
    await checked("archive.record_list");
    await checked("archive.record_update", { recordId: record.id, sourceUrl: null, body: "Новое правило", idempotencyKey: "all-record-update" });
    await checked("archive.record_delete", { recordId: record.id, confirmTitle: "Контракт", idempotencyKey: "all-record-delete" });
    const city = await checked<CityDto>("city.create", { name: "Контрактный город", idempotencyKey: "all-city" });
    await checked("city.list"); await checked("city.get", { cityId: city.id });
    await checked("city.update", { cityId: city.id, goal: "Проверить", deadline: null, idempotencyKey: "all-city-update" });
    await checked("city.rename", { cityId: city.id, name: "Обновлённый город", idempotencyKey: "all-city-rename" });
    const district = await checked<DistrictDto>("district.create", { cityId: city.id, name: "Контрактный район", activate: true, idempotencyKey: "all-district" });
    await checked("district.list", { cityId: city.id });
    await checked("district.update", { districtId: district.id, goal: "Проверить", deadline: null, idempotencyKey: "all-district-update" });
    await checked("district.rename", { districtId: district.id, name: "Обновлённый район", idempotencyKey: "all-district-rename" });
    const target = await checked<DistrictDto>("district.create", { cityId: city.id, name: "Следующий район", idempotencyKey: "all-target" });
    const task = await checked<TaskDto>("task.create", { cityId: city.id, districtId: district.id, title: "Проверяемая задача", estimate: 1, idempotencyKey: "all-task" });
    const dependency = await checked<TaskDto>("task.create", { cityId: city.id, districtId: district.id, title: "Зависимая задача", estimate: 2, idempotencyKey: "all-dependency" });
    const taskId = task.id;
    await checked("task.list", { districtId: district.id }); await checked("task.get", { taskId });
    await checked("task.rename", { taskId, title: "Обновлённая задача", idempotencyKey: "all-rename" });
    await checked("task.update_fields", { taskId, description: "Новый текст", workItemType: "BUG", dueAt: null, idempotencyKey: "all-fields" });
    await checked("task.add_comment", { taskId, body: "Проверка завершена", idempotencyKey: "all-comment" });
    await checked("task.dependency_add", { taskId, dependsOnTaskId: dependency.id, idempotencyKey: "all-dep-add" });
    await checked("task.dependency_remove", { taskId, dependsOnTaskId: dependency.id, idempotencyKey: "all-dep-remove" });
    await checked("task.document_upsert", { taskId, fileName: "architecture.md", content: "# Архитектура", idempotencyKey: "all-standard-doc" });
    const document = await checked<{ id: string }>("task.document_upsert", { taskId, fileName: "qa.md", title: "Проверка", content: "# Проверка", idempotencyKey: "all-extra-doc" });
    await checked("task.document_list", { taskId });
    await checked("task.document_delete", { taskId, documentId: document.id, idempotencyKey: "all-doc-delete" });
    const checklist = await checked<Array<{ id: string }>>("task.checklist_replace", { taskId, items: [{ title: "Проверить MCP" }], idempotencyKey: "all-checklist" });
    await checked("task.checklist_item_update", { taskId, itemId: checklist[0]!.id, done: true, idempotencyKey: "all-checklist-done" });
    await checked("task.link_add", { taskId, url: "https://example.test/review/1", idempotencyKey: "all-link" });
    await checked("task.link_remove", { taskId, url: "https://example.test/review/1", idempotencyKey: "all-link-remove" });
    const attachment = await checked<{ id: string }>("task.attachment_add", { taskId, fileName: "proof.txt", contentBase64: Buffer.from("Доказательство").toString("base64"), idempotencyKey: "all-attachment" });
    await checked("task.attachment_list", { taskId });
    const attachmentPath = (await service.getTaskAttachment(countryId, attachment.id)).absolutePath;
    expect(await readFile(attachmentPath, "utf8")).toBe("Доказательство");
    const defect = await checked<{ id: string }>("task.defect_create", { taskId, title: "Дефект", reproductionSteps: "Открыть", actualResult: "Ошибка", expectedResult: "Успех", idempotencyKey: "all-defect" });
    for (const status of ["IN_PROGRESS", "VERIFYING", "FIXED"]) await checked("task.defect_update", { defectId: defect.id, status, idempotencyKey: `all-defect-${status}` });
    const started = await checked<TaskDto>("task.report_progress", { taskId, status: "STARTED", progress: 10, comment: "Начал", idempotencyKey: "all-start" });
    expect(started.assignee?.id).toBe(userId);
    await checked("task.assign", { taskId, assigneeEmail: "mcp-http-viewer@example.test", assigneeRole: "qa", idempotencyKey: "all-assign" });
    for (const status of ["IN_PROGRESS", "TESTING", "COMPLETED"]) await checked("task.set_status", { taskId, status, idempotencyKey: `all-status-${status}` });
    expect((await service.getTask(countryId, taskId)).assignee?.id).toBe(viewerId);
    const activity = await checked<{ events: Array<{ actorUserId?: string }> }>("task.activity", { taskId });
    expect(activity.events.some(event => event.actorUserId === userId)).toBe(true);
    await checked("district.activate", { districtId: target.id, idempotencyKey: "all-activate" });
    const moved = await checked<TaskDto>("task.transfer", { taskId, targetDistrictId: target.id, idempotencyKey: "all-transfer" });
    expect(moved).toMatchObject({ id: taskId, taskNumber: task.taskNumber, status: "COMPLETED", districtId: target.id });
    await checked("district.complete", { districtId: target.id, idempotencyKey: "all-complete" });
    await checked("task.delete", { taskId, confirmTitle: "Обновлённая задача", idempotencyKey: "all-delete-task" });
    await expect.poll(async () => stat(attachmentPath).then(() => true, () => false)).toBe(false);
    await checked("district.delete", { districtId: district.id, confirmName: "Обновлённый район", idempotencyKey: "all-delete-district" });
    await checked("city.delete", { cityId: city.id, confirmName: "Обновлённый город", idempotencyKey: "all-delete-city" });
    expect([...used].sort()).toEqual([...expectedNames].sort());
    expect((await service.listTasks(countryId)).map(task => task.id)).toEqual([home.id]);
  });

  it("rejects absent/null/malformed country for every scoped tool without changing state", async () => {
    const before = await snapshot();
    for (const tool of tools.filter(tool => tool.name !== "country.list")) for (const invalid of [undefined, null, "invalid-uuid"]) {
      const args = minimal(tool); if (invalid === undefined) delete args.countryId; else args.countryId = invalid;
      const rejected = await client.callTool({ name: tool.name, arguments: args });
      expect(rejected.isError, `${tool.name}/${String(invalid)}`).toBe(true);
    }
    expect(await snapshot()).toEqual(before);
  });

  it("pins the explicit country independently of the UI selection", async () => {
    const selected = await createCountry(db, userId, "Другая выбранная страна");
    expect(await setActiveCountry(db, userId, selected)).toBe("OWNER");
    const before = await snapshot();
    expect(result<{ country: { id: string } }>(await call("country.get")).country.id).toBe(countryId);
    expect(result<TaskDto>(await call("task.get", { taskId: home.id })).id).toBe(home.id);
    expect(errorCode(await call("task.get", { countryId: selected, taskId: home.id }))).toBe("NOT_FOUND");
    expect(await db.prepare("SELECT active_country_id FROM users WHERE id=?").get(userId)).toEqual({ active_country_id: selected });
    expect(await snapshot()).toEqual(before);
    await setActiveCountry(db, userId, countryId);
  });

  it("checks each of the six scopes independently across its complete tool group", async () => {
    const tester = await registerUser(db, { email: "mcp-http-scopes@example.test", name: "Scopes", password: "password123" });
    await inviteCountryMember(db, countryId, userId, tester.user.email, "MEMBER");
    const required = (name: string): string[] => {
      if (name === "city.get") return ["country:read", "tasks:read"];
      if (name === "task.add_comment") return ["comments:write"];
      if (name === "archive.record_list") return ["tasks:read"];
      if (name === "country.update_profile" || name.startsWith("city.") && !["city.list", "city.get"].includes(name)) return ["cities:write"];
      if (name.startsWith("district.") && name !== "district.list") return ["districts:write"];
      if (name.startsWith("archive.record_")) return ["cities:write"];
      if (name.startsWith("task.")) return [tools.find(tool => tool.name === name)!.annotations?.readOnlyHint ? "tasks:read" : "tasks:write"];
      return ["country:read"];
    };
    const before = await snapshot();
    for (const scope of MCP_SCOPES) {
      const token = await createMcpToken(db, tester.user.countryId, `Without ${scope}`, tester.user.id, { scopes: MCP_SCOPES.filter(value => value !== scope) });
      const restricted = await connect(token.token);
      for (const tool of tools.filter(tool => required(tool.name).includes(scope))) {
        expect(errorCode(await restricted.callTool({ name: tool.name, arguments: minimal(tool) })), `${scope}/${tool.name}`).toBe("FORBIDDEN_SCOPE");
      }
      const control = scope === "country:read" ? "task.list" : "country.get";
      result(await call(control, {}, restricted));
    }
    expect(await snapshot()).toEqual(before);
  });

  it("enforces every write scope and live target-country role before domain mutations", async () => {
    const reader = await connect(readToken), viewer = await connect(viewerToken), before = await snapshot();
    for (const tool of tools.filter(tool => !tool.annotations?.readOnlyHint)) for (const caller of [reader, viewer]) {
      expect(errorCode(await caller.callTool({ name: tool.name, arguments: minimal(tool) })), tool.name).toBe("FORBIDDEN_SCOPE");
    }
    expect(await snapshot()).toEqual(before);
    const taskOnly = await connect(taskOnlyToken);
    expect(result(await call("task.list", {}, taskOnly))).toEqual(await service.listTasks(countryId));
    expect(errorCode(await call("city.get", { cityId: home.cityId }, reader))).toBe("FORBIDDEN_SCOPE");
    await expect(taskOnly.readResource({ uri: `tasktopia://countries/${countryId}` })).rejects.toThrow();
    await expect(taskOnly.readResource({ uri: "tasktopia://catalog/buildings" })).rejects.toThrow();
    await db.prepare("DELETE FROM country_members WHERE country_id=? AND user_id=?").run(countryId, viewerId);
    expect(errorCode(await call("country.get", {}, viewer))).toBe("COUNTRY_ACCESS_DENIED");
  });

  it("hides inaccessible countries and foreign task identities from every scoped tool", async () => {
    const before = await snapshot();
    for (const tool of tools.filter(tool => tool.name !== "country.list")) {
      const rejected = await client.callTool({ name: tool.name, arguments: { ...minimal(tool), countryId: foreignCountryId } });
      expect(errorCode(rejected), tool.name).toBe("COUNTRY_ACCESS_DENIED");
      expect(JSON.stringify(rejected.content)).not.toContain(foreign.title);
    }
    for (const name of ["task.get", "task.activity", "task.document_list", "task.attachment_list", "task.rename", "task.delete"]) {
      const args = minimal(tools.find(tool => tool.name === name)!); args.taskId = foreign.id;
      expect(errorCode(await client.callTool({ name, arguments: args })), name).toBe("NOT_FOUND");
    }
    await expect(client.readResource({ uri: `tasktopia://countries/${foreignCountryId}` })).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
  });

  it("conflicts on changed attachment bytes of equal size", async () => {
    const args = { taskId: home.id, fileName: "bytes.bin", contentBase64: Buffer.from("AAAA").toString("base64"), idempotencyKey: "attachment-digest" };
    const first = result<{ id: string }>(await call("task.attachment_add", args)), before = await snapshot();
    expect(errorCode(await call("task.attachment_add", { ...args, contentBase64: Buffer.from("BBBB").toString("base64") }))).toBe("CONFLICT");
    expect(await snapshot()).toEqual(before);
    expect(await readFile((await service.getTaskAttachment(countryId, first.id)).absolutePath, "utf8")).toBe("AAAA");
    expect((await readdir(join(uploads, countryId, home.id))).length).toBe(1);
  });

  it("rejects corrupt base64 before writing an attachment", async () => {
    const before = await snapshot();
    for (const contentBase64 of ["!!!QUFBQQ==", "QUFBQQ==??", "QQ", "data:text/plain;base64,QUFBQQ=="]) {
      const args = { taskId: home.id, fileName: "corrupt.bin" };
      const response = await call("task.attachment_add", { ...args, contentBase64, idempotencyKey: `malformed-${contentBase64.length}` });
      expect(response.isError, contentBase64).toBe(true);
    }
    expect(await snapshot()).toEqual(before);
  });

  it("rejects an attachment over the decoded byte budget without files or events", async () => {
    const before = await snapshot(), files = await readdir(join(uploads, countryId, home.id));
    const response = await call("task.attachment_add", {
      taskId: home.id, fileName: "too-big.bin", contentBase64: Buffer.alloc(config.maxAttachmentBytes + 1).toString("base64"), idempotencyKey: "attachment-too-big",
    });
    expect(response.isError).toBe(true);
    expect(await snapshot()).toEqual(before);
    expect(await readdir(join(uploads, countryId, home.id))).toEqual(files);
  });

  it("serializes concurrent identical writes and rejects a competing changed payload", async () => {
    const peer = await connect(), before = await snapshot();
    const args = { taskId: home.id, body: "Один конкурентный комментарий", idempotencyKey: "concurrent-comment" };
    const responses = await Promise.all([client, peer, client, peer].map(caller => call("task.add_comment", args, caller)));
    const receipt = result(responses[0]!);
    for (const response of responses) expect(result(response)).toEqual(receipt);
    expect(await version()).toBe(before.version + 1);
    expect((await service.listEvents(countryId)).length).toBe(before.events.length + 1);
    const committed = await snapshot();
    await peer.close(); const reconnected = await connect();
    expect(result(await call("task.add_comment", args, reconnected))).toEqual(receipt);
    expect(await snapshot()).toEqual(committed);
    const competing = await Promise.all(["Первый", "Второй"].map((body, index) => call("task.add_comment", { ...args, body, idempotencyKey: "concurrent-conflict" }, index ? reconnected : client)));
    expect(competing.filter(response => response.isError)).toHaveLength(1);
    expect(errorCode(competing.find(response => response.isError)!)).toBe("CONFLICT");
    expect(await version()).toBe(committed.version + 1);
    expect((await service.listEvents(countryId)).length).toBe(committed.events.length + 1);
  });

  it("rejects malformed HTTP envelopes and removed tools without domain effects", async () => {
    const before = await snapshot();
    expect((await fetch(`${base}/mcp`, { method: "POST", headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" }, body: "{" })).status).toBe(400);
    expect((await fetch(`${base}/mcp`, { method: "POST", headers: { authorization: `Bearer ${ownerToken}`, "content-type": "text/xml" }, body: "<rpc/>" })).status).toBe(415);
    for (const name of ["country.get_current", "country.select", "unknown.tool"]) {
      await expect(call(name)).rejects.toThrow();
    }
    await expect(client.readResource({ uri: "tasktopia://unknown" })).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
  });

  it("does not change state on invalid transitions, forged identity, confirmations or conflicting retry", async () => {
    const before = await snapshot();
    for (const [name, args, code] of [
      ["task.set_status", { taskId: home.id, status: "COMPLETED", idempotencyKey: "invalid-skip" }, "INVALID_TRANSITION"],
      ["task.delete", { taskId: home.id, confirmTitle: "Неверное имя", idempotencyKey: "invalid-confirm" }, "CONFIRMATION_MISMATCH"],
      ["task.assign", { taskId: home.id, assigneeEmail: "outsider@example.test", idempotencyKey: "invalid-member" }, "ASSIGNEE_NOT_MEMBER"],
      ["task.document_upsert", { taskId: home.id, fileName: "../../secret.md", content: "secret", idempotencyKey: "invalid-path" }, undefined],
      ["task.create", { cityId: home.cityId, title: "Подмена", estimate: 1, actorUserId: viewerId, idempotencyKey: "invalid-actor" }, undefined],
    ] as const) {
      const rejected = await call(name, args); expect(rejected.isError).toBe(true); if (code) expect(errorCode(rejected)).toBe(code);
    }
    expect(await snapshot()).toEqual(before);
    result(await call("task.add_comment", { taskId: home.id, body: "Первый", idempotencyKey: "same-key" }));
    const after = await snapshot();
    expect(errorCode(await call("task.add_comment", { taskId: home.id, body: "Другой", idempotencyKey: "same-key" }))).toBe("CONFLICT");
    expect(await snapshot()).toEqual(after);
  });

  it("rejects invalid credentials/origin and stale tokens on the next request of an existing client", async () => {
    for (const method of ["GET", "POST", "DELETE"]) {
      const rejected = await fetch(`${base}/mcp`, { method, headers: { authorization: `Bearer ${ownerToken}`, origin: "https://attacker.example", ...(method === "POST" ? { "content-type": "application/json" } : {}) }, body: method === "POST" ? "{}" : undefined });
      expect(rejected.status).toBe(403);
      const absent = await fetch(`${base}/mcp`, { method });
      expect(absent.status).toBe(401); expect(absent.headers.get("www-authenticate")).toContain("Bearer");
    }
    for (const headers of [{ authorization: ownerToken }, { "x-api-key": ownerToken }, { cookie: `tasktopia_session=${ownerToken}` }] as Record<string, string>[]) {
      expect((await fetch(`${base}/mcp`, { headers })).status).toBe(401);
    }
    expect((await fetch(`${base}/mcp?token=${ownerToken}`)).status).toBe(401);
    const expired = await registerUser(db, { email: "mcp-http-expired@example.test", name: "Истёкший", password: "password123" });
    const token = await createMcpToken(db, expired.user.countryId, "Expired", expired.user.id);
    const stale = await connect(token.token);
    await db.prepare("UPDATE mcp_tokens SET expires_at=now()-interval '1 minute' WHERE id=?").run(token.id);
    await expect(call("country.list", {}, stale)).rejects.toThrow();
    const corrupt = await createMcpToken(db, expired.user.countryId, "Corrupt scopes", expired.user.id);
    const corruptClient = await connect(corrupt.token);
    await db.prepare("UPDATE mcp_tokens SET scopes_json=? WHERE id=?").run(JSON.stringify(["country:read", "not-a-scope"]), corrupt.id);
    await expect(call("country.list", {}, corruptClient)).rejects.toThrow();
    const rotated = await createMcpToken(db, countryId, "Rotated owner", userId);
    await expect(call("country.get")).rejects.toThrow();
    expect(result<{ country: { id: string } }>(await call("country.get", {}, await connect(rotated.token))).country.id).toBe(countryId);
    ownerToken = rotated.token; client = await connect();
  });

  it("recovers after client timeout/disconnect and does not expose internal errors", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const original = service.listCities.bind(service);
    const slow = vi.spyOn(service, "listCities").mockImplementationOnce(async scope => { await gate; return original(scope); });
    try {
      await expect(client.callTool({ name: "city.list", arguments: { countryId } }, { timeout: 40 })).rejects.toThrow();
    } finally { release(); slow.mockRestore(); }
    await client.close(); client = await connect();
    expect(result(await call("city.list"))).toEqual(await service.listCities(countryId));
    const broken = vi.spyOn(service, "listCities").mockRejectedValueOnce(new Error("private database connection secret"));
    try {
      const denied = await call("city.list"); expect(errorCode(denied)).toBe("INTERNAL_ERROR");
      expect(JSON.stringify(denied)).not.toContain("private database connection secret");
    } finally { broken.mockRestore(); }
    expect(MCP_SCOPES).toHaveLength(6);
  });
});

it("accepts HTTP generation jobs, polls persisted worker results and replays without new jobs", async () => {
  const db = await createTestDb(), app = Fastify();
  const client = new Client({ name: "http-generation", version: "1.0.0" }, { versionNegotiation: { mode: "auto" } });
  try {
    const owner = await registerUser(db, { email: "mcp-http-generation@example.test", name: "Generation", password: "password123" });
    const countryId = owner.user.countryId;
    await db.prepare("UPDATE countries SET seed=424242 WHERE id=?").run(countryId);
    const worker = new AppService(db), dispatched = new AppService(db, undefined, "data/uploads", new PostgresWorldGenerationDispatcher(db, 0, 1));
    const token = (await createMcpToken(db, countryId, "Generation", owner.user.id)).token;
    registerMcpHttp(app, db, dispatched, "http://localhost:3000");
    const base = await app.listen({ host: "127.0.0.1", port: 0 });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
    const execute = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
      const request = { name, arguments: { countryId, ...args } };
      const accepted = result<{ status: string; job: { id: string; status: string } }>(await client.callTool(request));
      expect(accepted).toMatchObject({ status: "accepted", job: { status: "PENDING" } });
      expect(result(await client.callTool(request))).toEqual(accepted);
      const poll = { name: "world_generation.get", arguments: { countryId, jobId: accepted.job.id } };
      expect(result(await client.callTool(poll))).toMatchObject({ status: "PENDING" });
      expect(await processNextWorldGenerationJob(db, worker, "http-worker")).toBe(true);
      const completed = result<{ status: string; result: T }>(await client.callTool(poll));
      expect(completed.status).toBe("COMPLETED");
      const version = (await worker.getCountry(countryId)).worldVersion;
      // task.create adds the canonical URL and current district workload;
      // polling returns the rehydrated entity DTO without that MCP envelope.
      expect(result(await client.callTool(request))).toMatchObject(completed.result as object);
      expect((await worker.getCountry(countryId)).worldVersion).toBe(version);
      return completed.result;
    };
    const city = await execute<CityDto>("city.create", { name: "Фоновый город", idempotencyKey: "http-job-city" });
    const district = await execute<DistrictDto>("district.create", { cityId: city.id, name: "Фоновый район", activate: true, idempotencyKey: "http-job-district" });
    const task = await execute<TaskDto>("task.create", { cityId: city.id, districtId: district.id, title: "Фоновая задача", estimate: 1, idempotencyKey: "http-job-task" });
    expect(result<TaskDto>(await client.callTool({ name: "task.get", arguments: { countryId, taskId: task.id } })).id).toBe(task.id);
    expect(await db.prepare("SELECT COUNT(*)::integer AS count FROM world_generation_jobs_v1 WHERE country_id=?").get(countryId)).toEqual({ count: 3 });
  } finally { await client.close(); await app.close(); await db.close(); }
}, 30_000);

it("enforces the actual MCP route rate budget before authentication", async () => {
  const db = await createTestDb(), app = Fastify();
  try {
    await app.register(rateLimit, { max: 5000, timeWindow: "1 minute" });
    registerMcpHttp(app, db, new AppService(db), "http://localhost:3000");
    for (let i = 0; i < 90; i++) expect((await app.inject({ method: "GET", url: "/mcp" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/mcp" })).statusCode).toBe(429);
  } finally { await app.close(); await db.close(); }
}, 20_000);

it("redacts MCP query credentials in actual Fastify request logs", async () => {
  let output = "";
  const stream = new Writable({ write(chunk, _encoding, done) { output += String(chunk); done(); } });
  const app = Fastify({ logger: { level: "info", stream, serializers: { req: serializeRequest } } });
  try {
    app.get("/mcp", (_request, reply) => reply.code(401).send({ error: "UNAUTHENTICATED" }));
    for (const query of ["token=ttp_mcp_query_secret", "%74oken=ttp_mcp_encoded_secret", "access_token=ttp_mcp_access_secret&debug=true"]) {
      expect((await app.inject({ url: `/mcp?${query}` })).statusCode).toBe(401);
    }
    expect(output).not.toMatch(/ttp_mcp_(query|encoded|access)_secret/);
    expect(output).toContain("/mcp?[REDACTED]");
    expect(serializeRequest({ method: "GET", url: "/api/cities?countryId=public-id" }).url).toBe("/api/cities?countryId=public-id");
  } finally { await app.close(); }
});
