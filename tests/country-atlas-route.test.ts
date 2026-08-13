import fastifyCookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { createTestDb, type Db } from "../src/server/db";
import { registerRoutes } from "../src/server/routes";

describe("country atlas HTTP boundary", () => {
  let db: Db;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = await createTestDb();
    app = Fastify();
    await app.register(fastifyCookie);
    await registerRoutes(app, db, new AppService(db));
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await db.close();
  });

  it("serves an authenticated, world-versioned atlas with an ETag", async () => {
    expect((await app.inject({ method: "GET", url: "/api/country-atlas" })).statusCode).toBe(401);
    const registered = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "atlas-route@example.test",
        name: "Atlas Route",
        password: "safe-password-123",
        countryName: "Atlas Country",
        cityName: "Atlas City",
      },
    });
    const setCookie = registered.headers["set-cookie"]!;
    const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;
    const response = await app.inject({ method: "GET", url: "/api/country-atlas", headers: { cookie } });

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toContain("-atlas-2");
    expect(response.json()).toMatchObject({ schemaVersion: 2, cities: [{ name: "Atlas City" }] });
    expect((await app.inject({
      method: "GET",
      url: "/api/country-atlas",
      headers: { cookie, "if-none-match": response.headers.etag! },
    })).statusCode).toBe(304);
  }, 30_000);
});
