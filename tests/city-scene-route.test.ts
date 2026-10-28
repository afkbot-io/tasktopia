import fastifyCookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppService } from "../src/server/app-service";
import { createTestDb, type Db } from "../src/server/db";
import { registerRoutes } from "../src/server/routes";
import { CITY_SCENE_MAX_CHUNKS } from "../src/shared/city-capacity";
import { CITY_SCENE_COMPACT_ACCEPT, decodeCitySceneWire } from "../src/shared/city-scene-wire";

describe("whole-city scene HTTP boundary", () => {
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

  it("returns every city chunk atomically through one service call", async () => {
    const registered = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "city-scene@example.test",
        name: "City Scene",
        password: "safe-password-123",
        passwordConfirmation: "safe-password-123",
        countryName: "Scene Country",
        cityName: "Scene City",
      },
    });
    const setCookie = registered.headers["set-cookie"]!;
    const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;
    const bootstrap = (await app.inject({ method: "GET", url: "/api/bootstrap", headers: { cookie } })).json();
    const cityId = bootstrap.initialCity.id as string;
    const batch = vi.spyOn(service, "getViewportPayloads");

    const response = await app.inject({ method: "GET", url: `/api/cities/${cityId}/scene`, headers: { cookie } });

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toMatch(/^"[a-f0-9]{64}-city-scene-5"$/);
    const scene = response.json();
    expect(scene).toMatchObject({
      schemaVersion: 5,
      sceneRevision: expect.stringMatching(/^[a-f0-9]{64}$/),
      city: { id: cityId, bounds: bootstrap.initialCity.bounds },
      lod: "DETAIL",
      completedDistrictSnapshots: [],
      airportConnections: [],
      intercityRoads: [],
      roadContext: {schemaVersion:1,nodes:[],segments:expect.any(Array)},
    });
    expect(scene.chunks.length).toBeGreaterThan(0);
    expect(scene.chunks.every((chunk: { payloadVersion: number; lod: string }) => chunk.payloadVersion === 2 && chunk.lod === "DETAIL")).toBe(true);
    expect(batch).not.toHaveBeenCalled(); // Country chunks are not city-scoped.
    const bounds = bootstrap.initialCity.bounds;
    const expectedChunks = (Math.floor(bounds.maxX / 64) - Math.floor(bounds.minX / 64) + 1)
      * (Math.floor(bounds.maxY / 64) - Math.floor(bounds.minY / 64) + 1);
    expect(scene.chunks).toHaveLength(expectedChunks);
    expect(scene.chunks.length).toBeLessThanOrEqual(CITY_SCENE_MAX_CHUNKS);
    const packed = await app.inject({ method: "GET", url: `/api/cities/${cityId}/scene`, headers: { cookie, accept: CITY_SCENE_COMPACT_ACCEPT } });
    expect(packed.statusCode).toBe(200);
    expect(packed.headers.vary).toBe("Accept");
    expect(packed.headers["content-type"]).toContain("application/vnd.tasktopia.city-scene+json");
    expect(packed.headers.etag).toMatch(/-city-scene-5-compact1"$/);
    expect(decodeCitySceneWire(packed.json())).toEqual(scene);
    // An ETag from one negotiated representation cannot validate the other.
    expect((await app.inject({ method: "GET", url: `/api/cities/${cityId}/scene`,
      headers: { cookie, accept: CITY_SCENE_COMPACT_ACCEPT, "if-none-match": response.headers.etag! } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/cities/${cityId}/scene`,
      headers: { cookie, accept: CITY_SCENE_COMPACT_ACCEPT, "if-none-match": packed.headers.etag! } })).statusCode).toBe(304);
    const legacy = await app.inject({
      method: "GET",
      url: `/api/cities/${cityId}/scene`,
      headers: { cookie, accept: "application/vnd.tasktopia.city-scene+json; version=1" },
    });
    expect(legacy.statusCode).toBe(200);
    expect(legacy.headers.etag).toMatch(/^"[a-f0-9]{64}-city-scene-5"$/);
    expect(legacy.json()).toMatchObject({ schemaVersion: 5, city: { id: cityId } });
    expect((await app.inject({
      method: "GET",
      url: `/api/cities/${cityId}/scene`,
      headers: { cookie, "if-none-match": response.headers.etag! },
    })).statusCode).toBe(304);

    // This isolates the reader contract from allocation: even a sparse city's
    // full envelope can exceed the former16x16-page guard. Native10k packing
    // is separately exercised by the scale fixture, without fabricated lots.
    const minX = Math.floor(bounds.minX / 64) * 64, minY = Math.floor(bounds.minY / 64) * 64;
    await db.prepare("UPDATE cities_v3 SET bounds_json=?::jsonb WHERE id=?").run(
      JSON.stringify({ minX, minY, maxX: minX + 17 * 64 - 1, maxY: minY + 17 * 64 - 1 }), cityId);
    await db.prepare("UPDATE countries SET world_version=world_version+1 WHERE id=?").run(bootstrap.country.id);
    const expanded = await app.inject({ method: "GET", url: `/api/cities/${cityId}/scene`, headers: { cookie } });
    expect(expanded.statusCode).toBe(200);
    expect(expanded.json().chunks).toHaveLength(289);
    expect(new Set(expanded.json().chunks.map((chunk: { chunkX: number; chunkY: number }) => `${chunk.chunkX},${chunk.chunkY}`)).size).toBe(289);
    expect(batch).not.toHaveBeenCalled();
  }, 90_000);

  it("does not expose a city outside the authenticated country", async () => {
    const registered = await app.inject({
      method: "POST", url: "/api/auth/register",
      payload: { email: "scene-scope@example.test", name: "Scope", password: "safe-password-123", passwordConfirmation: "safe-password-123", countryName: "Scope Country", cityName: "Scope City" },
    });
    const setCookie = registered.headers["set-cookie"]!;
    const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;
    expect((await app.inject({ method: "GET", url: `/api/cities/${crypto.randomUUID()}/scene`, headers: { cookie } })).statusCode).toBe(404);
    const other = await app.inject({
      method: "POST", url: "/api/auth/register",
      payload: { email: "scene-private@example.test", name: "Private", password: "safe-password-123", passwordConfirmation: "safe-password-123", countryName: "Private Country", cityName: "Private City" },
    });
    const otherCookieHeader = other.headers["set-cookie"]!;
    const otherCookie = (Array.isArray(otherCookieHeader) ? otherCookieHeader[0]! : otherCookieHeader).split(";")[0]!;
    const privateBootstrap = (await app.inject({ method: "GET", url: "/api/bootstrap", headers: { cookie: otherCookie } })).json();
    const rejected = await app.inject({
      method: "GET",
      url: `/api/countries/${privateBootstrap.country.id}/cities/${privateBootstrap.initialCity.id}/scene`,
      headers: { cookie },
    });
    expect(rejected.statusCode).toBe(403);
    expect(rejected.json()).not.toHaveProperty("airportConnections");
    expect(rejected.json()).not.toHaveProperty("roadContext");
  }, 30_000);
});
