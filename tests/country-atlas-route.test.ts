import fastifyCookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { createTestDb, type Db } from "../src/server/db";
import { registerRoutes } from "../src/server/routes";

describe("country atlas HTTP boundary", () => {
  let db: Db;
  let app: FastifyInstance;
  let service: AppService;

  beforeEach(async () => {
    db = await createTestDb();
    app = Fastify();
    await app.register(fastifyCookie);
    service = new AppService(db);
    await registerRoutes(app, db, service);
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
        passwordConfirmation: "safe-password-123",
        countryName: "Atlas Country",
        cityName: "Atlas City",
      },
    });
    const setCookie = registered.headers["set-cookie"]!;
    const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;
    const response = await app.inject({ method: "GET", url: "/api/country-atlas", headers: { cookie } });

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toContain("-atlas-5");
    expect(response.headers["cache-control"]).toBe("private, max-age=30, stale-while-revalidate=300");
    expect(response.json()).toMatchObject({ schemaVersion: 5, cities: [{ name: "Atlas City" }] });
    expect((await app.inject({
      method: "GET",
      url: "/api/country-atlas",
      headers: { cookie, "if-none-match": response.headers.etag! },
    })).statusCode).toBe(304);
  }, 90_000);

  it("serves a compact country overview without city cell geometry", async () => {
    const registered = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "country-overview@example.test",
        name: "Country Overview",
        password: "safe-password-123",
        passwordConfirmation: "safe-password-123",
        countryName: "Overview Country",
        cityName: "Overview City",
      },
    });
    const setCookie = registered.headers["set-cookie"]!;
    const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;
    const countryId = (await app.inject({ method: "GET", url: "/api/bootstrap", headers: { cookie } })).json().country.id as string;

    const response = await app.inject({ method: "GET", url: `/api/countries/${countryId}/overview`, headers: { cookie } });

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toMatch(/^"[a-f0-9]{64}-country-overview-3"$/);
    expect(response.headers["cache-control"]).toBe("private, max-age=60, stale-while-revalidate=600");
    expect(response.json()).toMatchObject({
      schemaVersion: 3,
      countryId: expect.any(String),
      revision: expect.stringMatching(/^[a-f0-9]{64}$/),
      geography: {
        columns: 36,
        rows: 22,
        cellSize: 4,
        topology: "SQUARE_4",
        terrainCodes: expect.any(String),
      },
      cities: [{
        name: "Overview City",
        sourceCenter: expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
        atlasCenter: expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
        districts: [],
        miniature: {
          columns: expect.any(Number),
          rows: expect.any(Number),
          districtCodes: expect.any(String),
          airportCell: expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
        },
      }],
      connections: [],
    });
    expect(response.json().geography.terrainCodes).toHaveLength(36 * 22);
    expect(JSON.stringify(response.json())).not.toMatch(/atlasMask|cutoutMask|displayCells|buildings|roads|surfaces|features|footprint/);
    expect(Buffer.byteLength(response.body)).toBeLessThan(24_000);
    expect((await app.inject({
      method: "GET",
      url: `/api/countries/${countryId}/overview`,
      headers: { cookie, "if-none-match": response.headers.etag! },
    })).statusCode).toBe(304);
  }, 30_000);

  it("opens an explicitly scoped city even if another country became active", async () => {
    const registered = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "country-scene-scope@example.test",
        name: "Country Scene Scope",
        password: "safe-password-123",
        passwordConfirmation: "safe-password-123",
        countryName: "First Country",
        cityName: "First City",
      },
    });
    const setCookie = registered.headers["set-cookie"]!;
    const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;
    const body = (await app.inject({ method: "GET", url: "/api/bootstrap", headers: { cookie } })).json();
    const firstCountryId = body.country.id as string;
    const firstCityId = body.initialCity.id as string;
    const secondCountry = await app.inject({ method: "POST", url: "/api/countries", headers: { cookie }, payload: { name: "Second Country" } });
    expect(secondCountry.statusCode).toBe(200);

    const response = await app.inject({
      method: "GET",
      url: `/api/countries/${firstCountryId}/cities/${firstCityId}/scene`,
      headers: { cookie, accept: "application/vnd.tasktopia.city-scene+json; version=2" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-country-id"]).toBe(firstCountryId);
    expect(response.json()).toMatchObject({ city: { id: firstCityId, name: "First City" } });
  }, 90_000);
});
