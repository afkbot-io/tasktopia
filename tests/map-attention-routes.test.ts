import fastifyCookie from "@fastify/cookie";
import Fastify from "fastify";
import { expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { createTestDb } from "../src/server/db";
import { registerRoutes } from "../src/server/routes";
it("requires explicit country and membership; returns private bounded metadata", async () => {
  const db = await createTestDb();
  const app = Fastify();
  try {
    await app.register(fastifyCookie);
    await registerRoutes(app, db, new AppService(db));
    const registered = await app.inject({ method: "POST", url: "/api/auth/register", payload: {
      email: "attention@example.com", name: "Attention", password: "password-123", passwordConfirmation: "password-123", countryName: "Attention country", cityName: "Attention city",
    } });
    expect(registered.statusCode).toBe(200);
    const raw = registered.headers["set-cookie"]!;
    const cookie = (Array.isArray(raw) ? raw[0]! : raw).split(";")[0]!;
    const bootstrap = (await app.inject({ url: "/api/bootstrap", headers: { cookie } })).json();
    const url = `/api/map-attention?countryId=${bootstrap.country.id}&cityId=${bootstrap.initialCity.id}`;
    const result = await app.inject({ url, headers: { cookie } });
    expect(result.statusCode).toBe(200);
    expect(result.headers["cache-control"]).toBe("private, no-store");
    const developmentUrl = `/api/city-development?countryId=${bootstrap.country.id}&cityId=${bootstrap.initialCity.id}`;
    const development = await app.inject({ url: developmentUrl, headers: { cookie } });
    expect(development.statusCode).toBe(200);
    expect(development.headers["cache-control"]).toBe("private, no-store");
    expect(development.json().landmarks).toHaveLength(20);
    expect((await app.inject({ url: developmentUrl })).statusCode).toBe(401);
    expect((await app.inject({ url: developmentUrl.replace(bootstrap.country.id, crypto.randomUUID()), headers: { cookie } })).statusCode).toBe(403);

    expect(result.json()).toMatchObject({ tasks: [], next: null });
    const service = new AppService(db);
    await service.createDistrict(bootstrap.country.id, { cityId: bootstrap.initialCity.id, name: "Attention district", activate: true, idempotencyKey: "attention-district" });
    const task = await service.createTask(bootstrap.country.id, { cityId: bootstrap.initialCity.id, title: "Private attention", estimate: 1, idempotencyKey: "attention-create" });
    const atlasResponse = await app.inject({url:"/api/planet-atlas",headers:{cookie}});
    expect(atlasResponse.statusCode).toBe(200);
    const atlasCity = atlasResponse.json().countries.find((c: {id:string})=>c.id===bootstrap.country.id).cities.find((c: {id:string})=>c.id===bootstrap.initialCity.id);
    const overview = await service.getCountryOverview(bootstrap.user.id, bootstrap.country.id);
    const countryCity = overview.cities.find(c=>c.id===bootstrap.initialCity.id)!;
    expect(atlasCity.miniature.map((b: {id:string;family:string})=>[b.id,b.family])).toEqual(countryCity.miniature.blocks.map(b=>[b.id,b.family]));
    expect(atlasCity.miniature.length).toBeGreaterThan(0);
    expect(atlasCity.miniature.length).toBeLessThanOrEqual(12);
    expect((await app.inject({url:"/api/planet-atlas"})).statusCode).toBe(401);

    const before = (await app.inject({ url, headers: { cookie } })).json();
    expect(before.tasks).toEqual([{ id: task.id, mine: false, status: "PLANNING", dueAt: null, hasDefects: false }]);
    await service.assignTask(bootstrap.country.id, { taskId: task.id, assigneeUserId: bootstrap.user.id, idempotencyKey: "attention-assign" });
    const assigned = (await app.inject({ url, headers: { cookie } })).json();
    expect(assigned.tasks[0].mine).toBe(true);
    expect(assigned.revision).toBeGreaterThan(before.revision);
    expect((await app.inject({ url: `${url}&revision=${before.revision}`, headers: { cookie } })).statusCode).toBe(409);
    await service.assignTask(bootstrap.country.id, { taskId: task.id, assigneeUserId: null, idempotencyKey: "attention-unassign" });
    expect((await app.inject({ url, headers: { cookie } })).json().tasks[0].mine).toBe(false);

    const memberRegistration = await app.inject({ method: "POST", url: "/api/auth/register", payload: {
      email: "attention-member@example.com", name: "Member", password: "password-123", passwordConfirmation: "password-123", countryName: "Member country", cityName: "Member city",
    } });
    expect(memberRegistration.statusCode).toBe(200);
    const memberRaw = memberRegistration.headers["set-cookie"]!;
    const memberCookie = (Array.isArray(memberRaw) ? memberRaw[0]! : memberRaw).split(";")[0]!;
    const memberBootstrap = (await app.inject({ url: "/api/bootstrap", headers: { cookie: memberCookie } })).json();
    expect((await app.inject({ url, headers: { cookie: memberCookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/api/countries/${bootstrap.country.id}/members`, headers: { cookie }, payload: { email: "attention-member@example.com" } })).statusCode).toBe(200);
    await service.assignTask(bootstrap.country.id, { taskId: task.id, assigneeUserId: memberBootstrap.user.id, idempotencyKey: "attention-member-assign" });
    expect((await app.inject({ url, headers: { cookie: memberCookie } })).json().tasks[0].mine).toBe(true);
    expect((await app.inject({ url, headers: { cookie } })).json().tasks[0].mine).toBe(false);
    // Synthetic metadata-only rows exercise the actual SQL page boundary;
    // no world-generation workload is needed to verify this read contract.
    await db.prepare(`INSERT INTO tasks_v3 SELECT (jsonb_populate_record(NULL::tasks_v3,
      to_jsonb(t) || jsonb_build_object('id', gen_random_uuid()::text, 'task_number', t.task_number + n))).*
      FROM tasks_v3 t CROSS JOIN generate_series(1,250) n WHERE t.id=?`).run(task.id);
    const first = (await app.inject({ url, headers: { cookie } })).json();
    expect(first.tasks).toHaveLength(250);
    expect(first.next).toBe(first.tasks.at(-1).id);
    const second = (await app.inject({ url: `${url}&after=${first.next}&revision=${first.revision}`, headers: { cookie } })).json();
    expect(second.tasks).toHaveLength(1);
    expect(second.next).toBeNull();
    expect(new Set([...first.tasks, ...second.tasks].map(t => t.id)).size).toBe(251);
    await db.prepare("DELETE FROM country_members WHERE country_id=? AND user_id=?").run(bootstrap.country.id, memberBootstrap.user.id);
    expect((await app.inject({ url: `${url}&after=${first.next}&revision=${first.revision}`, headers: { cookie: memberCookie } })).statusCode).toBe(403);
    expect((await app.inject({ url: `${url}&limit=1000&after=${first.next}&revision=${first.revision}`, headers: { cookie: memberCookie } })).statusCode).toBe(403);
    expect((await app.inject({ url })).statusCode).toBe(401);
    expect((await app.inject({ url: `/api/map-attention?cityId=${bootstrap.initialCity.id}`, headers: { cookie } })).statusCode).toBe(400);
    expect((await app.inject({ url: url.replace(bootstrap.country.id, crypto.randomUUID()), headers: { cookie } })).statusCode).toBe(403);
  } finally { await app.close(); await db.close(); }
}, 60_000);

it("accepts up to 1000 private metadata records while preserving the default and keyset snapshot", async () => {
  const db = await createTestDb(); const app = Fastify();
  try {
    await app.register(fastifyCookie);
    const service = new AppService(db);
    await registerRoutes(app, db, service);
    const registered = await app.inject({ method: "POST", url: "/api/auth/register", payload: {
      email: "attention-pages@example.com", name: "Attention pages", password: "password-123", passwordConfirmation: "password-123", countryName: "Page country", cityName: "Page city",
    } });
    expect(registered.statusCode).toBe(200);
    const raw = registered.headers["set-cookie"]!;
    const cookie = (Array.isArray(raw) ? raw[0]! : raw).split(";")[0]!;
    const bootstrap = (await app.inject({ url: "/api/bootstrap", headers: { cookie } })).json();
    await service.createDistrict(bootstrap.country.id, { cityId: bootstrap.initialCity.id, name: "Page district", activate: true, idempotencyKey: "attention-pages-district" });
    const task = await service.createTask(bootstrap.country.id, { cityId: bootstrap.initialCity.id, title: "Private title must not leave metadata", estimate: 1, idempotencyKey: "attention-pages-task" });
    await service.assignTask(bootstrap.country.id, { taskId: task.id, assigneeUserId: bootstrap.user.id, idempotencyKey: "attention-pages-assigned" });
    // Only metadata rows: pagination does not need a generated 1001-task world.
    await db.prepare(`INSERT INTO tasks_v3 SELECT (jsonb_populate_record(NULL::tasks_v3,
      to_jsonb(t) || jsonb_build_object('id', gen_random_uuid()::text, 'task_number', t.task_number + n))).*
      FROM tasks_v3 t CROSS JOIN generate_series(1,1000) n WHERE t.id=?`).run(task.id);
    const url = `/api/map-attention?countryId=${bootstrap.country.id}&cityId=${bootstrap.initialCity.id}`;
    expect((await app.inject({ url, headers: { cookie } })).json().tasks).toHaveLength(250);
    const response = await app.inject({ url: `${url}&limit=1000`, headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    const first = response.json();
    expect(Object.keys(first).sort()).toEqual(["next", "revision", "tasks"]);
    expect(first.tasks).toHaveLength(1000);
    expect(first.next).toBe(first.tasks.at(-1).id);
    for (const row of first.tasks) {
      expect(Object.keys(row).sort()).toEqual(["dueAt", "hasDefects", "id", "mine", "status"]);
      expect(row.mine).toBe(true);
    }
    const nextResponse = await app.inject({ url: `${url}&limit=1000&after=${first.next}&revision=${first.revision}`, headers: { cookie } });
    expect(nextResponse.statusCode).toBe(200);
    const next = nextResponse.json();
    expect(next.revision).toBe(first.revision);
    expect(next.tasks).toHaveLength(1);
    expect(next.next).toBeNull();
    const ids = [...first.tasks, ...next.tasks].map((row: { id: string }) => row.id);
    expect(new Set(ids).size).toBe(1001);
    expect(ids).toEqual([...ids].sort());
    expect((await app.inject({ url: `${url}&limit=1`, headers: { cookie } })).json().tasks).toHaveLength(1);
    for (const invalid of ["0", "1001", "1.5", "-1"])
      expect((await app.inject({ url: `${url}&limit=${invalid}`, headers: { cookie } })).statusCode).toBe(400);
    expect((await app.inject({ url: `${url}&limit=1000` })).statusCode).toBe(401);
    expect((await app.inject({ url: `${url}&limit=1000&revision=${first.revision + 1}`, headers: { cookie } })).statusCode).toBe(409);
    expect((await app.inject({ url: `${url.replace(bootstrap.country.id, crypto.randomUUID())}&limit=1000`, headers: { cookie } })).statusCode).toBe(403);
  } finally { await app.close(); await db.close(); }
}, 60_000);
