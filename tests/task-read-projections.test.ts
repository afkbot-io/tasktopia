import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyCookie from "@fastify/cookie";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/client";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";
import { registerRoutes } from "../src/server/routes";
import { createMcpServer } from "../src/server/mcp";
import type { TaskDto } from "../src/shared/contracts";
import { readTaskListPageRows } from "../src/server/task-list-read";

describe("bounded task read and MCP command projections", { timeout: 30_000 }, () => {
  let db: Db; let service: AppService; let countryId: string; let userId: string; let task: TaskDto;
  let app: FastifyInstance; let cookie: string; let client: Client;
  let mcp: Awaited<ReturnType<typeof createMcpServer>>;
  beforeEach(async () => {
    db = await createTestDb(); service = new AppService(db);
    const owner = await registerUser(db, { email: "paged-task@example.test", name: "Paged owner", password: "password123" });
    countryId = owner.user.countryId; userId = owner.user.id;
    await db.prepare("UPDATE countries SET seed=424242 WHERE id=?").run(countryId);
    const city = await service.createCity(countryId, { name: "Paged city", idempotencyKey: "paged-city" });
    const district = await service.createDistrict(countryId, { cityId: city.id, name: "Paged district", activate: true, idempotencyKey: "paged-district" });
    task = await service.createTask(countryId, { cityId: city.id, districtId: district.id, title: "Paged task", description: "Overview body", acceptanceCriteria: "Acceptance body", estimate: 1, idempotencyKey: "paged-task" });
    app = Fastify(); await app.register(fastifyCookie);
    await registerRoutes(app, db, service, { registrationEnabled: false });
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: owner.user.email, password: "password123" } });
    const cookies = login.headers["set-cookie"];
    cookie = String(Array.isArray(cookies) ? cookies[0] : cookies).split(";")[0]!;
    mcp = await createMcpServer(db, service, { userId, tokenId: crypto.randomUUID(), scopes: ["tasks:read", "tasks:write", "comments:write"] });
    client = new Client({ name: "bounded-projections", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcp.connect(serverTransport); await client.connect(clientTransport);
  });
  afterEach(async () => { await client?.close(); await mcp?.close(); await app?.close(); await db?.close(); });
  const get = (url: string) => app.inject({ method: "GET", url: /\/(card|collections|documents)(\/|\?|$)/.test(url) ? `${url}${url.includes("?") ? "&" : "?"}countryId=${countryId}` : url, headers: { cookie } });
  const seedComments = (count = 1000) => db.prepare(`INSERT INTO task_comments_v3(id,task_id,body,actor,created_at)
    SELECT gen_random_uuid()::text,?,repeat('x',2000),'Fixture',now() FROM generate_series(1,?::integer)`).run(task.id, count);

  it.each([0, 100, 1000])("keeps card and MCP receipts bounded with %i existing comments while full responses retain every comment", async (count) => {
    await seedComments(count);
    const cardResponse = await get(`/api/tasks/${task.id}/card`);
    const fullResponse = await get(`/api/tasks/${task.id}?countryId=${countryId}`);
    expect(cardResponse.statusCode).toBe(200); expect(fullResponse.statusCode).toBe(200);
    expect(cardResponse.json().counts.comments).toBe(count);
    expect(cardResponse.json()).not.toHaveProperty("comments");
    expect(fullResponse.json().comments).toHaveLength(count);
    const cardBytes = Buffer.byteLength(cardResponse.body), fullReadBytes = Buffer.byteLength(fullResponse.body);
    expect(cardBytes).toBeLessThan(25_000);
    expect(fullReadBytes).toBeGreaterThan(count * 2000);

    const compactRead = await client.callTool({ name: "task.get", arguments: { countryId, taskId: task.id, view: "compact" } });
    expect(compactRead.isError).not.toBe(true);
    expect(compactRead.structuredContent).toMatchObject({ result: { kind: "task.card", counts: { comments: count } } });
    const compactReadBytes = Buffer.byteLength(JSON.stringify(compactRead));
    expect(compactReadBytes).toBeLessThan(25_000);

    const command = { countryId, taskId: task.id, body: "Exactly one sizing comment", idempotencyKey: "sizing-one-comment" };
    const compactCommand = await client.callTool({ name: "task.add_comment", arguments: { ...command, resultMode: "compact" } });
    expect(compactCommand.isError).not.toBe(true);
    expect(compactCommand.structuredContent).toMatchObject({ result: { kind: "task.command-result", id: task.id } });
    const compactCommandBytes = Buffer.byteLength(JSON.stringify(compactCommand));
    expect(compactCommandBytes).toBeLessThan(4_000);
    const readReceipt = () => db.prepare("SELECT request_hash,response_json FROM idempotency WHERE country_id=? AND operation='task.comment.v3' AND idempotency_key=?")
      .get(countryId, command.idempotencyKey);
    const receipt = await readReceipt();
    expect(receipt?.response_json).toMatchObject({ receiptVersion: 2, entityKind: "task", entityId: task.id });
    const receiptBytes = Buffer.byteLength(JSON.stringify(receipt?.response_json));
    expect(receiptBytes).toBeLessThan(512);

    const fullRetry = await client.callTool({ name: "task.add_comment", arguments: { ...command, resultMode: "full" } });
    expect(fullRetry.isError).not.toBe(true);
    expect((fullRetry.structuredContent as { result: TaskDto }).result.comments).toHaveLength(count + 1);
    expect(await readReceipt()).toEqual(receipt);
    const stored = await db.prepare("SELECT COUNT(*)::integer AS count FROM task_comments_v3 WHERE task_id=?").get(task.id);
    expect(stored?.count).toBe(count + 1);
    const events = await db.prepare("SELECT COUNT(*)::integer AS count FROM task_events_v7 WHERE task_id=? AND event_type='COMMENT_ADDED'").get(task.id);
    expect(events?.count).toBe(1);
    console.info("TASK_READ_SIZING", JSON.stringify({ comments: count, commentBodyBytes: 2000, cardBytes, fullReadBytes,
      compactReadMcpBytes: compactReadBytes, compactCommandMcpBytes: compactCommandBytes, receiptBytes,
      fullRetryMcpBytes: Buffer.byteLength(JSON.stringify(fullRetry)), acceptedCommands: 1, storedComments: count + 1,
      storedCommentEvents: events?.count, sameReceiptAndRequestHashAfterProjectionRetry: true }));
  });

  it("treats a task-number search outside the integer range as an absent number in reader, HTTP and MCP", async () => {
    for (const q of ['2147483647', '2147483648', '9999999999', '#2147483647', '#2147483648', '#9999999999']) {
      expect(await readTaskListPageRows(db, countryId, { q }), q).toEqual({ rows: [], nextCursor: null });
      const http = await get(`/api/tasks/list-page?${new URLSearchParams({ countryId, q })}`);
      expect(http.statusCode, q).toBe(200); expect(http.json(), q).toMatchObject({ items: [], nextCursor: null });
      const mcp = await client.callTool({ name: 'task.list_page', arguments: { countryId, q } });
      expect(mcp.isError, q).not.toBe(true); expect(mcp.structuredContent, q).toMatchObject({ result: { items: [], nextCursor: null } });
    }
  });

  it("reads a bounded card with real counts and document metadata instead of the entire history", async () => {
    await seedComments();
    await service.upsertTaskDocument(countryId, { taskId: task.id, fileName: "architecture.md", content: "Detailed document ".repeat(2000), idempotencyKey: "long-document" });
    const response = await get(`/api/tasks/${task.id}/card`);
    expect(response.statusCode).toBe(200);
    const card = response.json();
    expect(card).toMatchObject({ kind: "task.card", version: 1, countryId, id: task.id, description: "Overview body", acceptanceCriteria: "Acceptance body",
      counts: { comments: 1000, documents: 4, filledDocuments: 1 } });
    expect(card).not.toHaveProperty("comments");
    expect(card).not.toHaveProperty("events");
    expect(card.documentMetadata.find((document: { fileName: string }) => document.fileName === "architecture.md")).toMatchObject({ isFilled: true, contentLength: 36_000 });
    expect(response.body.length).toBeLessThan(25_000);
  });

  it("serves stable comment pages while the legacy full task response remains complete", async () => {
    await seedComments();
    const first = await get(`/api/tasks/${task.id}/collections/comments?limit=50`);
    expect(first.statusCode).toBe(200);
    const page = first.json();
    expect(page).toMatchObject({ kind: "task.collection-page", version: 1, collection: "comments", taskId: task.id });
    expect(page.items).toHaveLength(50);
    const second = (await get(`/api/tasks/${task.id}/collections/comments?limit=50&cursor=${encodeURIComponent(page.nextCursor)}`)).json();
    expect(second.items).toHaveLength(50);
    expect(new Set([...page.items, ...second.items].map(item => item.id)).size).toBe(100);
    expect((await get(`/api/tasks/${task.id}`)).json().comments).toHaveLength(1000);
  });

  it("offers a typed compact MCP read and bounded command receipt without duplicating the command on a mode change", async () => {
    await seedComments();
    const compactRead = await client.callTool({ name: "task.get", arguments: { countryId, taskId: task.id, view: "compact" } });
    expect(compactRead.isError).not.toBe(true);
    expect(compactRead.structuredContent).toMatchObject({ result: { kind: "task.card", version: 1, id: task.id } });
    const command = { countryId, taskId: task.id, body: "One accepted comment", idempotencyKey: "compact-one-comment" };
    const compact = await client.callTool({ name: "task.add_comment", arguments: { ...command, resultMode: "compact" } });
    expect(compact.isError).not.toBe(true);
    expect(compact.structuredContent).toMatchObject({ result: { kind: "task.command-result", version: 1, id: task.id, taskNumber: task.taskNumber } });
    expect(JSON.stringify(compact).length).toBeLessThan(4_000);
    const receipt = await db.prepare("SELECT request_hash,response_json FROM idempotency WHERE country_id=? AND operation='task.comment.v3' AND idempotency_key=?")
      .get(countryId, command.idempotencyKey);
    expect(JSON.stringify(receipt?.response_json).length).toBeLessThan(512);
    expect(receipt?.response_json).toMatchObject({ receiptVersion: 2, entityKind: "task", entityId: task.id, id: task.id });
    const full = await client.callTool({ name: "task.add_comment", arguments: { ...command, resultMode: "full" } });
    expect(full.isError).not.toBe(true);
    expect((full.structuredContent as { result: TaskDto }).result.comments).toHaveLength(1001);
    const count = await db.prepare("SELECT COUNT(*)::integer AS count FROM task_comments_v3 WHERE task_id=? AND body=?").get(task.id, command.body);
    expect(count?.count).toBe(1);
    expect(await db.prepare("SELECT request_hash,response_json FROM idempotency WHERE country_id=? AND operation='task.comment.v3' AND idempotency_key=?")
      .get(countryId, command.idempotencyKey)).toEqual(receipt);
  });
  it("lists bounded task pages with combined filters and exact timestamp/id ordering", async () => {
    await service.createTask(countryId, { cityId: task.cityId, districtId: task.districtId, title: "Paged bug", workItemType: "BUG", estimate: 1, idempotencyKey: "paged-bug" });
    await service.createTask(countryId, { cityId: task.cityId, districtId: task.districtId, title: "Paged extra", estimate: 1, idempotencyKey: "paged-extra" });
    await db.prepare("UPDATE tasks_v3 SET updated_at=now() WHERE city_id=?").run(task.cityId);
    const first = await get(`/api/tasks/list-page?countryId=${countryId}&limit=1`);
    expect(first.statusCode).toBe(200);
    const page = first.json();
    expect(page).toMatchObject({ kind: "task.list-page", version: 1, countryId });
    expect(page.items).toHaveLength(1);
    const next = (await get(`/api/tasks/list-page?countryId=${countryId}&limit=1&cursor=${encodeURIComponent(page.nextCursor)}`)).json();
    expect(next.items).toHaveLength(1);
    expect(next.items[0].id).not.toBe(page.items[0].id);
    expect(next.items[0]).not.toHaveProperty("comments");
    const filter = await client.callTool({ name: "task.list_page", arguments: { countryId, q: "Paged", cityId: task.cityId, workItemType: "BUG", status: "PLANNING" } });
    expect(filter.isError).not.toBe(true);
    expect((filter.structuredContent as { result: { items: unknown[] } }).result.items).toHaveLength(1);
  });

  it("offers authorized collection/document MCP reads and rejects cross-context cursors", async () => {
    await service.upsertTaskDocument(countryId, { taskId: task.id, fileName: "notes.md", title: "Notes", content: "Actual content", idempotencyKey: "doc-notes" });
    const card = (await get(`/api/tasks/${task.id}/card`)).json();
    const doc = card.documentMetadata.find((item: { fileName: string }) => item.fileName === "notes.md");
    expect(doc).not.toHaveProperty("content");
    expect((await get(`/api/tasks/${task.id}/documents/${doc.id}`)).json()).toMatchObject({ id: doc.id, taskId: task.id, content: "Actual content" });
    const result = await client.callTool({ name: "task.collection_list", arguments: { countryId, taskId: task.id, collection: "documents", limit: 2 } });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ result: { kind: "task.collection-page", collection: "documents" } });
    const cursor = (result.structuredContent as { result: { nextCursor: string } }).result.nextCursor;
    const mismatch = await get(`/api/tasks/${task.id}/collections/checklist?cursor=${encodeURIComponent(cursor)}`);
    expect(mismatch.statusCode).toBe(400);
    const malformed = Buffer.from(JSON.stringify({ version: 1, countryId, taskId: task.id, collection: "events", order: "desc", key: "0", id: "1" })).toString("base64url");
    expect((await get(`/api/tasks/${task.id}/collections/events?cursor=${malformed}`)).statusCode).toBe(400);
    const actual = await client.callTool({ name: "task.document_get", arguments: { countryId, taskId: task.id, documentId: doc.id } });
    expect(actual.structuredContent).toMatchObject({ result: { content: "Actual content" } });
  });

  it("compact comment and progress do not aggregate any full child collection", async () => {
    await seedComments();
    const queries: string[] = [];
    const prepare = db.prepare.bind(db);
    const spy = vi.spyOn(db, "prepare").mockImplementation(query => { queries.push(query); return prepare(query); });
    try {
      await service.addTaskComment(countryId, { taskId: task.id, body: "Small comment", idempotencyKey: "cheap-comment" }, "compact");
      expect(queries.filter(query => query.includes("SELECT t.id,t.task_number") && query.includes("AS accounts"))).toHaveLength(1);
      expect(queries.some(query => query.includes("to_jsonb(t)"))).toBe(false);
      expect(queries.some(query => /jsonb_agg/.test(query) && /task_comments_v3|task_events_v7|task_documents_v1/.test(query))).toBe(false);
      queries.length = 0;
      const progress = await service.updateTaskStatus(countryId, { taskId: task.id, status: "STARTED", actorUserId: userId, idempotencyKey: "cheap-start" }, "compact");
      expect(progress).toMatchObject({ kind: "task.command-result", status: "STARTED" });
      expect(queries.some(query => /jsonb_agg/.test(query) && /task_comments_v3|task_events_v7|task_documents_v1/.test(query))).toBe(false);
    } finally { spy.mockRestore(); }
    expect((await service.getTask(countryId, task.id)).assignee?.id).toBe(userId);
  });

  it("checks explicit country membership on every bounded read and denies revoked or foreign documents", async () => {
    const notes = await service.upsertTaskDocument(countryId, { taskId: task.id, fileName: "private.md", title: "Private", content: "Private body", idempotencyKey: "private-doc" });
    const viewer = (await registerUser(db, { email: "read-viewer@example.test", name: "Read viewer", password: "password123" })).user;
    await db.prepare("INSERT INTO country_members(country_id,user_id,role,created_at) VALUES(?,?,'VIEWER',now())").run(countryId, viewer.id);
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: viewer.email, password: "password123" } });
    const viewerCookie = String(login.headers["set-cookie"]).split(";")[0]!;
    const read = (path: string) => app.inject({ method: "GET", url: `${path}?countryId=${countryId}`, headers: { cookie: viewerCookie } });
    expect((await read(`/api/tasks/${task.id}/card`)).statusCode).toBe(200);
    expect((await read(`/api/tasks/${task.id}/documents/${notes.id}`)).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/tasks/${task.id}/card?countryId=${viewer.countryId}`, headers: { cookie } })).statusCode).toBe(403);
    await db.prepare("DELETE FROM country_members WHERE country_id=? AND user_id=?").run(countryId, viewer.id);
    expect((await read(`/api/tasks/${task.id}/card`)).statusCode).toBe(403);
    expect((await read(`/api/tasks/${task.id}/documents/${notes.id}`)).statusCode).toBe(403);
    await service.deleteTaskDocument(countryId, { taskId: task.id, documentId: notes.id, idempotencyKey: "delete-private-doc" });
    expect((await get(`/api/tasks/${task.id}/documents/${notes.id}`)).statusCode).toBe(404);
    const denied = await client.callTool({ name: "task.collection_list", arguments: { countryId: viewer.countryId, taskId: task.id, collection: "events" } });
    expect(denied.isError).toBe(true);
    expect((await app.inject({ method: "GET", url: `/api/tasks/${task.id}/card`, headers: { cookie } })).statusCode).toBe(400);
  });

  it("keeps compact completion gates and existing assignee identity", async () => {
    const checklist = await service.replaceTaskChecklist(countryId, { taskId: task.id, items: [{ title: "Required check" }], idempotencyKey: "required-check" });
    for (const status of ["STARTED", "IN_PROGRESS", "TESTING"] as const) await service.updateTaskStatus(countryId, { taskId: task.id, status, actorUserId: userId, idempotencyKey: `gate-${status}` }, "compact");
    const complete = { taskId: task.id, status: "COMPLETED" as const, actorUserId: userId, idempotencyKey: "gate-complete" };
    await expect(service.updateTaskStatus(countryId, complete, "compact")).rejects.toMatchObject({ code: "CHECKLIST_INCOMPLETE" });
    expect((await service.getTask(countryId, task.id)).status).toBe("TESTING");
    await service.updateTaskChecklistItem(countryId, { taskId: task.id, itemId: checklist[0]!.id, done: true, idempotencyKey: "check-done" });
    const defect = await service.createTaskDefect(countryId, { taskId: task.id, title: "Blocking defect", description: "Broken", reproductionSteps: "Open", actualResult: "Broken", expectedResult: "Works", idempotencyKey: "blocking-defect" });
    await expect(service.updateTaskStatus(countryId, complete, "compact")).rejects.toMatchObject({ code: "OPEN_DEFECTS" });
    await service.updateTaskDefect(countryId, { defectId: defect.id, status: "FIXED", idempotencyKey: "defect-fixed" });
    expect(await service.updateTaskStatus(countryId, complete, "compact")).toMatchObject({ kind: "task.command-result", status: "COMPLETED", progress: 100 });
    expect((await service.getTask(countryId, task.id)).assignee?.id).toBe(userId);
  });

  it("bounds document previews and pages all advertised child collections without materializing document content", async () => {
    await db.prepare(`INSERT INTO task_documents_v1(task_id,file_name,title,content,position)
      SELECT ?, 'extra-'||n||'.md','Extra '||n,repeat('body',1000),n+3 FROM generate_series(1,60) n`).run(task.id);
    await db.prepare(`INSERT INTO task_checklist_items_v1(id,task_id,title,done,position,created_at,updated_at)
      SELECT gen_random_uuid()::text,?,'Check '||n,false,n,now(),now() FROM generate_series(1,60) n`).run(task.id);
    const card = await service.getTaskCard(countryId, task.id);
    expect(card.documentMetadata).toHaveLength(50);
    expect(card.counts).toMatchObject({ documents: 64, filledDocuments: 60, checklistTotal: 60 });
    expect(card.documentsNextCursor).not.toBeNull();
    const next = await service.getTaskCollection(countryId, task.id, "documents", { cursor: card.documentsNextCursor! });
    expect(next.items).toHaveLength(14);
    expect(next.nextCursor).toBeNull();
    expect(new Set([...card.documentMetadata, ...next.items].map(item => item.id)).size).toBe(64);
    expect(next.items[0]).not.toHaveProperty("content");
    const links = Array.from({ length: 60 }, (_, index) => ({ url: `https://example.test/review/${index}`, title: `MR ${index}`, actor: "Fixture", addedAt: "2026-10-16T00:00:00.123456Z" }));
    await db.prepare("UPDATE tasks_v3 SET merge_requests_json=?::jsonb WHERE id=?").run(JSON.stringify(links), task.id);
    for (const collection of ["comments", "events", "defects", "attachments", "documents", "checklist", "dependencies", "mergeRequests"] as const) {
      const page = await client.callTool({ name: "task.collection_list", arguments: { countryId, taskId: task.id, collection, limit: 2 } });
      expect(page.isError, collection).not.toBe(true);
      expect(page.structuredContent).toMatchObject({ result: { kind: "task.collection-page", collection } });
    }
    const mr1 = await service.getTaskCollection(countryId, task.id, "mergeRequests", { limit: 2 });
    const mr2 = await service.getTaskCollection(countryId, task.id, "mergeRequests", { limit: 2, cursor: mr1.nextCursor! });
    expect(new Set([...mr1.items, ...mr2.items].map(item => item.url)).size).toBe(4);
    expect((await get(`/api/tasks/${task.id}/collections/comments?limit=101`)).statusCode).toBe(400);
  });

  it("retains current hydration for legacy spatial full receipts and historical results for nonspatial receipts", async () => {
    const input = { taskId: task.id, body: "Legacy comment", idempotencyKey: "legacy-full-comment" };
    const original = await service.addTaskComment(countryId, input);
    await db.prepare("UPDATE idempotency SET response_json=?::jsonb WHERE country_id=? AND operation='task.comment.v3' AND idempotency_key=?")
      .run(JSON.stringify(original), countryId, input.idempotencyKey);
    const legacy = await db.prepare("SELECT request_hash,response_json FROM idempotency WHERE country_id=? AND idempotency_key=?").get(countryId, input.idempotencyKey);
    await service.renameTask(countryId, { taskId: task.id, title: "Current title", idempotencyKey: "rename-after-receipt" });
    expect(await service.addTaskComment(countryId, input, "compact")).toMatchObject({ kind: "task.command-result", title: "Current title" });
    expect(await db.prepare("SELECT request_hash,response_json FROM idempotency WHERE country_id=? AND idempotency_key=?").get(countryId, input.idempotencyKey)).toEqual(legacy);
    const docInput = { taskId: task.id, fileName: "architecture.md", content: "Historical content", idempotencyKey: "historical-doc" };
    const historic = await service.upsertTaskDocument(countryId, docInput);
    await service.upsertTaskDocument(countryId, { ...docInput, content: "Current content", idempotencyKey: "current-doc" });
    expect(await service.upsertTaskDocument(countryId, docInput)).toEqual(historic);
  });

});
