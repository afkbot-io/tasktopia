import fastifyCookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppService } from "../src/server/app-service";
import { createTestDb, type Db } from "../src/server/db";
import { registerRoutes } from "../src/server/routes";
import { cityDetailFocusBounds } from "../src/shared/city-camera";

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
    expect(response.headers.etag).toMatch(/^"[a-f0-9]{64}-city-scene-2"$/);
    const scene = response.json();
    expect(scene).toMatchObject({
      schemaVersion: 2,
      sceneRevision: expect.stringMatching(/^[a-f0-9]{64}$/),
      city: { id: cityId, bounds: bootstrap.initialCity.bounds },
      lod: "DETAIL",
      completedDistrictSnapshots: [],
    });
    expect(scene.chunks.length).toBeGreaterThan(0);
    expect(scene.chunks.every((chunk: { payloadVersion: number; lod: string }) => chunk.payloadVersion === 2 && chunk.lod === "DETAIL")).toBe(true);
    expect(batch).toHaveBeenCalledTimes(1);
    const bounds = cityDetailFocusBounds(bootstrap.initialCity.center, bootstrap.initialCity.bounds);
    const expectedChunks = (Math.floor(bounds.maxX / 64) - Math.floor(bounds.minX / 64) + 1)
      * (Math.floor(bounds.maxY / 64) - Math.floor(bounds.minY / 64) + 1);
    expect(scene.chunks).toHaveLength(expectedChunks);
    expect(scene.chunks.length).toBeLessThanOrEqual(12);
    const legacy = await app.inject({
      method: "GET",
      url: `/api/cities/${cityId}/scene`,
      headers: { cookie, accept: "application/vnd.tasktopia.city-scene+json; version=1" },
    });
    expect(legacy.statusCode).toBe(200);
    expect(legacy.headers.etag).toMatch(/^"[a-f0-9]{64}-city-scene-1"$/);
    expect(legacy.json()).toMatchObject({ schemaVersion: 1, city: { id: cityId } });
    expect((await app.inject({
      method: "GET",
      url: `/api/cities/${cityId}/scene`,
      headers: { cookie, "if-none-match": response.headers.etag! },
    })).statusCode).toBe(304);
  }, 30_000);

  it("does not expose a city outside the authenticated country", async () => {
    const registered = await app.inject({
      method: "POST", url: "/api/auth/register",
      payload: { email: "scene-scope@example.test", name: "Scope", password: "safe-password-123", passwordConfirmation: "safe-password-123", countryName: "Scope Country", cityName: "Scope City" },
    });
    const setCookie = registered.headers["set-cookie"]!;
    const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;
    expect((await app.inject({ method: "GET", url: `/api/cities/${crypto.randomUUID()}/scene`, headers: { cookie } })).statusCode).toBe(404);
  }, 30_000);
});
