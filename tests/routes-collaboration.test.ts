import fastifyCookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { createTestDb, type Db } from "../src/server/db";
import { registerRoutes } from "../src/server/routes";

describe("country collaboration HTTP boundary", () => {
  let db: Db;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = await createTestDb();
    app = Fastify();
    await app.register(fastifyCookie);
    await registerRoutes(app, db, new AppService(db));
    await app.ready();
  });

  afterEach(async () => { await app.close(); await db.close(); });

  async function register(email: string, name: string): Promise<string> {
    const response = await app.inject({ method: "POST", url: "/api/auth/register", payload: {
      email, name, password: "password-123", countryName: `${name} country`, cityName: `${name} city`,
    } });
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
    expect(await db.prepare("SELECT country_id FROM mcp_tokens WHERE id = ?").get(keyId)).toBeDefined();

    const renamed = await app.inject({ method: "PATCH", url: "/api/account", headers: { cookie: memberCookie }, payload: { name: "Updated Member Name" } });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().user.name).toBe("Updated Member Name");
  });

  it("lets only the owner rename a country", async () => {
    const ownerCookie = await register("rename-owner@example.com", "Rename Owner");
    const memberCookie = await register("rename-member@example.com", "Rename Member");
    const created = await app.inject({ method: "POST", url: "/api/countries", headers: { cookie: ownerCookie }, payload: { name: "Old name" } });
    const countryId = created.json().id as string;
    await app.inject({ method: "POST", url: `/api/countries/${countryId}/members`, headers: { cookie: ownerCookie }, payload: { email: "rename-member@example.com" } });

    const forbidden = await app.inject({ method: "PATCH", url: `/api/countries/${countryId}`, headers: { cookie: memberCookie }, payload: { name: "Hacked name" } });
    expect(forbidden.statusCode).toBe(403);

    const renamed = await app.inject({ method: "PATCH", url: `/api/countries/${countryId}`, headers: { cookie: ownerCookie }, payload: { name: "New product name" } });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json()).toMatchObject({ id: countryId, name: "New product name" });
  });

  it("notifies the realtime boundary when country access is revoked", async () => {
    const revoked: Array<{ countryId: string; userId: string }> = [];
    await app.close();
    app = Fastify();
    await app.register(fastifyCookie);
    await registerRoutes(app, db, new AppService(db), {
                              onCountryAccessRevoked: (countryId, userId) => { revoked.push({ countryId, userId }); },
                            });
    await app.ready();

    const ownerCookie = await register("socket-owner@example.com", "Socket Owner");
    const memberCookie = await register("socket-member@example.com", "Socket Member");
    const memberId = (await app.inject({ method: "GET", url: "/api/bootstrap", headers: { cookie: memberCookie } })).json().user.id as string;
    const created = await app.inject({ method: "POST", url: "/api/countries", headers: { cookie: ownerCookie }, payload: { name: "Realtime country" } });
    const countryId = created.json().id as string;
    await app.inject({ method: "POST", url: `/api/countries/${countryId}/members`, headers: { cookie: ownerCookie }, payload: { email: "socket-member@example.com" } });

    const removed = await app.inject({ method: "DELETE", url: `/api/countries/${countryId}/members/${memberId}`, headers: { cookie: ownerCookie } });
    expect(removed.statusCode).toBe(200);
    expect(revoked).toEqual([{ countryId, userId: memberId }]);
  }, 15_000);

  it("enforces read-only viewer scopes at the token HTTP boundary", async () => {
    const ownerCookie = await register("viewer-owner@example.com", "Viewer Owner");
    const viewerCookie = await register("viewer-user@example.com", "Viewer User");
    const created = await app.inject({ method: "POST", url: "/api/countries", headers: { cookie: ownerCookie }, payload: { name: "Viewer country" } });
    const countryId = created.json().id as string;
    const invited = await app.inject({
      method: "POST", url: `/api/countries/${countryId}/members`, headers: { cookie: ownerCookie },
      payload: { email: "viewer-user@example.com", role: "VIEWER" },
    });
    expect(invited.json().role).toBe("VIEWER");
    await app.inject({ method: "POST", url: `/api/countries/${countryId}/select`, headers: { cookie: viewerCookie } });

    const readToken = await app.inject({
      method: "POST", url: "/api/tokens", headers: { cookie: viewerCookie },
      payload: { name: "Viewer read", scopes: ["country:read", "tasks:read"], expiresInDays: 30 },
    });
    expect(readToken.statusCode).toBe(200);
    expect(readToken.json()).toMatchObject({ scopes: ["country:read", "tasks:read"] });
    expect(readToken.json().expiresAt).toBeTruthy();

    const writeToken = await app.inject({
      method: "POST", url: "/api/tokens", headers: { cookie: viewerCookie },
      payload: { name: "Viewer write", scopes: ["country:read", "tasks:write"], expiresInDays: 30 },
    });
    expect(writeToken.statusCode).toBe(403);
  });
});
