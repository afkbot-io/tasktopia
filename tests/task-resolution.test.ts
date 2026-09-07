import fastifyCookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { createCountry, inviteCountryMember, registerUser } from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";
import { registerRoutes } from "../src/server/routes";
import type { TaskDto } from "../src/shared/contracts";

describe("canonical authorized task resolver", { timeout: 30_000 }, () => {
  let db: Db, app: FastifyInstance, service: AppService;
  let cookie: string, countryId: string, otherCountryId: string, privateCountryId: string;
  let first: TaskDto, other: TaskDto, privateTask: TaskDto;
  beforeAll(async () => {
    db = await createTestDb();
    service = new AppService(db);
    const owner = await registerUser(db, { email: "resolver@example.test", name: "Resolver", password: "password123" });
    countryId = owner.user.countryId;
    const otherOwner = await registerUser(db, { email: "resolver-other@example.test", name: "Other", password: "password123" });
    otherCountryId = otherOwner.user.countryId;
    await inviteCountryMember(db, otherCountryId, otherOwner.user.id, owner.user.email, "VIEWER");
    privateCountryId = await createCountry(db, otherOwner.user.id, "Private country");
    const task = async (scope: string, name: string) => {
      await db.prepare("UPDATE countries SET seed=424242 WHERE id=?").run(scope);
      const city = await service.createCity(scope, { name, idempotencyKey: "city" });
      const district = await service.createDistrict(scope, { cityId: city.id, name: "District", activate: true, idempotencyKey: "district" });
      return service.createTask(scope, { cityId: city.id, districtId: district.id, title: `${name} task`, estimate: 1, idempotencyKey: "task" });
    };
    first = await task(countryId, "Home");
    other = await task(otherCountryId, "Member");
    privateTask = await task(privateCountryId, "Private");
    app = Fastify();
    await app.register(fastifyCookie);
    await registerRoutes(app, db, service);
    await app.ready();
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: owner.user.email, password: "password123" } });
    const headers = login.headers["set-cookie"]!;
    cookie = (Array.isArray(headers) ? headers[0]! : headers).split(";")[0]!;
  });
  afterAll(async () => { await app?.close(); await db?.close(); });

  it("resolves a member-country UUID to current canonical task location without switching the active country", async () => {
    const response = await app.inject({ method: "GET", url: `/api/tasks/resolve?id=${other.id}`, headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ countryId: otherCountryId, id: other.id, taskNumber: other.taskNumber,
      cityId: other.cityId, districtId: other.districtId, origin: other.origin, title: other.title });
    expect(response.headers["cache-control"]).toBe("private, no-store");
    const active = await app.inject({ method: "GET", url: `/api/tasks/resolve?number=${first.taskNumber}`, headers: { cookie } });
    expect(active.json()).toMatchObject({ countryId, id: first.id });
  });

  it("scopes identical numbers explicitly and returns canonical metadata after a rename", async () => {
    expect(first.taskNumber).toBe(other.taskNumber);
    await service.renameTask(otherCountryId, { taskId: other.id, title: "Current title", idempotencyKey: "rename" });
    const response = await app.inject({ method: "GET", url: `/api/tasks/resolve?number=${other.taskNumber}&countryId=${otherCountryId}`, headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: other.id, countryId: otherCountryId, title: "Current title" });
  });

  it("does not disclose inaccessible IDs or explicit country-scoped numbers", async () => {
    for (const id of [privateTask.id, crypto.randomUUID()]) {
      const response = await app.inject({ method: "GET", url: `/api/tasks/resolve?id=${id}`, headers: { cookie } });
      expect(response.statusCode).toBe(404);
      expect(response.json()).not.toHaveProperty("title");
    }
    const forbidden = await app.inject({ method: "GET", url: `/api/tasks/resolve?number=1&countryId=${privateCountryId}`, headers: { cookie } });
    expect(forbidden.statusCode).toBe(403);
    const unknown = await app.inject({ method: "GET", url: "/api/tasks/resolve?number=999999", headers: { cookie } });
    expect(unknown.statusCode).toBe(404);
  });

  it("rejects unauthenticated, malformed and ambiguous input", async () => {
    expect((await app.inject({ method: "GET", url: `/api/tasks/resolve?id=${first.id}` })).statusCode).toBe(401);
    for (const query of ["", "?id=bad", "?number=0", "?number=-1", "?number=1.5", "?number=1&countryId=bad",
      `?id=${first.id}&number=1`, `?id=${first.id}&countryId=${countryId}`, "?number=1&unexpected=true"]) {
      expect((await app.inject({ method: "GET", url: `/api/tasks/resolve${query}`, headers: { cookie } })).statusCode).toBe(400);
    }
  });
});
