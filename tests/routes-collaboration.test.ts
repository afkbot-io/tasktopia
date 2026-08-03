import fastifyCookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { createDb, type Db } from "../src/server/db";
import { registerRoutes } from "../src/server/routes";

describe("country collaboration HTTP boundary", () => {
  let db: Db;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = createDb(":memory:");
    app = Fastify();
    await app.register(fastifyCookie);
    registerRoutes(app, db, new AppService(db));
    await app.ready();
  });

  afterEach(async () => { await app.close(); db.close(); });

  async function register(email: string, name: string): Promise<string> {
    const response = await app.inject({ method: "POST", url: "/api/auth/register", payload: { email, name, password: "password-123" } });
    expect(response.statusCode).toBe(200);
    const setCookie = response.headers["set-cookie"]!;
    return (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;
  }

  it("lets an owner invite a registered person while denying member deletion", async () => {
    const ownerCookie = await register("route-owner@example.com", "Route Owner");
    const memberCookie = await register("route-member@example.com", "Route Member");
    const created = await app.inject({ method: "POST", url: "/api/countries", headers: { cookie: ownerCookie }, payload: { name: "Shared route country" } });
    expect(created.statusCode).toBe(200);
    const countryId = created.json().id as string;

    const missing = await app.inject({ method: "POST", url: `/api/countries/${countryId}/members`, headers: { cookie: ownerCookie }, payload: { email: "not-registered@example.com" } });
    expect(missing.statusCode).toBe(404);
    const invited = await app.inject({ method: "POST", url: `/api/countries/${countryId}/members`, headers: { cookie: ownerCookie }, payload: { email: "route-member@example.com" } });
    expect(invited.statusCode).toBe(200);
    expect(invited.json().role).toBe("MEMBER");

    const selected = await app.inject({ method: "POST", url: `/api/countries/${countryId}/select`, headers: { cookie: memberCookie } });
    expect(selected.statusCode).toBe(200);
    expect(selected.json()).toMatchObject({ country: { id: countryId }, countryRole: "MEMBER" });
    const forbiddenDelete = await app.inject({ method: "DELETE", url: `/api/countries/${countryId}`, headers: { cookie: memberCookie } });
    expect(forbiddenDelete.statusCode).toBe(403);

    const personalKey = await app.inject({ method: "POST", url: "/api/tokens", headers: { cookie: ownerCookie }, payload: { name: "Route personal key" } });
    expect(personalKey.statusCode).toBe(200);
    const keyId = personalKey.json().id as string;
    const deleted = await app.inject({ method: "DELETE", url: `/api/countries/${countryId}`, headers: { cookie: ownerCookie } });
    expect(deleted.statusCode).toBe(200);
    expect(db.prepare("SELECT country_id FROM mcp_tokens WHERE id = ?").get(keyId)).toBeDefined();

    const renamed = await app.inject({ method: "PATCH", url: "/api/account", headers: { cookie: memberCookie }, payload: { name: "Updated Member Name" } });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().user.name).toBe("Updated Member Name");
  });
});
