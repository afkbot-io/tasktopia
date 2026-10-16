import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";
import { registerRoutes } from "../src/server/routes";
import type { TaskDto } from "../src/shared/contracts";

describe("durable city album", () => {
  let db: Db; let service: AppService; let app: FastifyInstance; let session: string; let countryId: string; let cityId: string; let task: TaskDto;
  beforeEach(async () => {
    db = await createTestDb(); service = new AppService(db);
    const owner = (await registerUser(db, { email: "album@example.test", name: "Album owner", password: "password123" })).user;
    countryId = owner.countryId;
    await db.prepare("UPDATE countries SET seed=424242 WHERE id=?").run(countryId);
    cityId = (await service.createCity(countryId, { name: "Album city", idempotencyKey: "album-city" })).id;
    const district = await service.createDistrict(countryId, { cityId, name: "Album district", activate: true, idempotencyKey: "album-district" });
    task = await service.createTask(countryId, { cityId, districtId: district.id, title: "Album task", estimate: 1, idempotencyKey: "album-task" });
    app = Fastify(); await app.register(cookie); await registerRoutes(app, db, service);
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: owner.email, password: "password123" } });
    session = String(login.headers["set-cookie"]).split(";")[0]!;
  });
  afterEach(async () => { await app?.close(); await db?.close(); });
  const get = (query = "") => app.inject({ url: `/api/countries/${countryId}/cities/${cityId}/album${query}`, headers: { cookie: session } });

  it("returns real durable before/after facts for selected milestones without scene payloads", async () => {
    const response = await get();
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    const page = response.json();
    expect(page).toMatchObject({ kind: "city.album-page", version: 1, countryId, cityId });
    const created = page.items.find((item: { type: string }) => item.type === "task.created");
    expect(created).toMatchObject({ source: "event-with-development", task: { id: task.id, taskNumber: task.taskNumber },
      before: { tasks: 0, completedTasks: 0 }, after: { tasks: 1, buildings: 1, occupiedBlocks: 1 } });
    expect(response.body).not.toContain("chunks"); expect(response.body).not.toContain("terrain");
    const event = (await service.listEvents(countryId)).find(item => item.type === "task.created")!;
    expect(event.payload.development).toMatchObject({ version: 1, cityId, before: { tasks: 0 }, after: { tasks: 1 } });
    expect(created.eventId).toBe(event.id);
  });

  it("pages exact timestamp ties, preserves honest legacy null facts and excludes comments", async () => {
    await db.prepare("UPDATE events SET created_at=date_trunc('second',now()) WHERE country_id=?").run(countryId);
    await db.prepare("UPDATE events SET payload_json=payload_json-'development' WHERE country_id=?").run(countryId);
    const original = (await get("?limit=1")).json();
    expect(original.items).toHaveLength(1); expect(original.items[0]).toMatchObject({ source: "legacy-event", before: null, after: null });
    const next = (await get(`?limit=1&cursor=${encodeURIComponent(original.nextCursor)}`)).json();
    expect(next.items).toHaveLength(1); expect(next.items[0].eventId).not.toBe(original.items[0].eventId);
    const count = (await get()).json().items.length;
    await service.addTaskComment(countryId, { taskId: task.id, body: "Not a milestone", idempotencyKey: "album-comment" }, "compact");
    expect((await get()).json().items).toHaveLength(count);
    const comments = (await service.listEvents(countryId)).filter(event => event.type === "task.comment_added");
    expect(comments.every(event => event.payload.development === undefined)).toBe(true);
  });
  it("records actual completion/deletion facts once and respects foreign/revoked/anonymous access", async () => {
    for (const status of ["STARTED", "IN_PROGRESS", "TESTING", "COMPLETED"] as const) await service.updateTaskStatus(countryId, { taskId: task.id, status, idempotencyKey: `album-${status}` }, "compact");
    const completed = (await get()).json().items.find((item: { type: string }) => item.type === "task.status_changed");
    expect(completed).toMatchObject({ before: { completedTasks: 0 }, after: { completedTasks: 1 } });
    const input = { taskId: task.id, confirmTitle: task.title, idempotencyKey: "album-delete" };
    await service.deleteTask(countryId,input);
    const deleted = (await get()).json().items.find((item: { type: string }) => item.type === "task.deleted");
    expect(deleted).toMatchObject({ task: { id: task.id, exists: false }, before: { tasks: 1 }, after: { tasks: 0 } });
    const count = (await get()).json().items.length;
    await service.deleteTask(countryId,input);
    expect((await get()).json().items).toHaveLength(count);
    expect((await app.inject({ url: `/api/countries/${countryId}/cities/${cityId}/album` })).statusCode).toBe(401);
    expect((await app.inject({ url: `/api/countries/${crypto.randomUUID()}/cities/${cityId}/album`, headers: { cookie: session } })).statusCode).toBe(403);
    expect((await app.inject({ url: `/api/countries/${countryId}/cities/${crypto.randomUUID()}/album`, headers: { cookie: session } })).statusCode).toBe(404);
    expect((await get("?limit=51")).statusCode).toBe(400);
    expect((await get("?cursor=broken")).statusCode).toBe(400);
    await db.prepare("DELETE FROM country_members WHERE country_id=?").run(countryId);
    expect((await get()).statusCode).toBe(401);
  });

});
