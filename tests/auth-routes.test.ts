import fastifyCookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";
import { registerRoutes } from "../src/server/routes";
import { APP_VERSION } from "../src/server/version";
import type { SurfaceCellDto } from "../src/shared/contracts";

describe("authentication HTTP boundary", () => {
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

  it("reports the package version from the health endpoint", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok", version: APP_VERSION });
  });

  it("does not expose framework parser errors for an empty JSON request", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { "content-type": "application/json" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "REQUEST_FAILED",
      message: "Некорректный запрос. Проверьте введённые данные",
    });
    expect(response.body).not.toContain("Body cannot be empty");
  });

  it("registers, restores the country session, logs out, and logs in again", async () => {
    const registered = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "mayor@example.test", name: "Test Mayor", password: "safe-password-123", passwordConfirmation: "safe-password-123", countryName: "Mayor Project", cityName: "Mayor City" },
    });
    expect(registered.statusCode).toBe(200);
    const setCookie = registered.headers["set-cookie"]!;
    expect(String(setCookie)).toContain("HttpOnly");
    expect(String(setCookie)).toContain("SameSite=Strict");
    const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;

    const bootstrap = await app.inject({ method: "GET", url: "/api/bootstrap", headers: { cookie } });
    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.json()).toMatchObject({ user: { email: "mayor@example.test" }, countryRole: "OWNER" });
    expect(bootstrap.json()).not.toHaveProperty("districts");
    expect(bootstrap.json()).not.toHaveProperty("tasks");
    expect(bootstrap.json().stats).toEqual({ cities: 1, districts: 0, tasks: 0, activeDistricts: 0, unfinishedBuildings: 0 });

    const countryId = bootstrap.json().country.id as string;
    const city = await service.createCity(countryId, { name: "Scoped City", idempotencyKey: "http-city" });
    const district = await service.createDistrict(countryId, { cityId: city.id, name: "Scoped District", activate: true, idempotencyKey: "http-district" });
    const task = await service.createTask(countryId, { cityId: city.id, districtId: district.id, title: "Scoped task", estimate: 1, idempotencyKey: "http-task" });

    const populatedBootstrap = (await app.inject({ method: "GET", url: "/api/bootstrap", headers: { cookie } })).json();
    expect(populatedBootstrap.stats).toEqual({ cities: 2, districts: 1, tasks: 1, activeDistricts: 1, unfinishedBuildings: 1 });
    expect(JSON.stringify(populatedBootstrap)).not.toContain("footprint");
    const planCities = await app.inject({ method: "GET", url: "/api/plan/cities", headers: { cookie } });
    expect(planCities.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: city.id, districtCount: 1, taskCount: 1 }),
    ]));
    const planDistricts = await app.inject({ method: "GET", url: `/api/plan/cities/${city.id}/districts`, headers: { cookie } });
    expect(planDistricts.json()).toMatchObject([{ id: district.id, taskCount: 1 }]);
    expect(JSON.stringify(planDistricts.json())).not.toContain("cells");
    const planTasks = await app.inject({ method: "GET", url: `/api/plan/districts/${district.id}/tasks`, headers: { cookie } });
    expect(planTasks.json()).toMatchObject([{ title: "Scoped task", stage: 1, activeDefectCount: 0 }]);
    expect(JSON.stringify(planTasks.json())).not.toContain("footprint");
    expect((await app.inject({ method: "GET", url: `/api/plan/cities/${crypto.randomUUID()}/districts`, headers: { cookie } })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/api/plan/districts/${crypto.randomUUID()}/tasks`, headers: { cookie } })).statusCode).toBe(404);

    const secondCity = await service.createCity(countryId, { name: "Second scoped city", idempotencyKey: "http-city-two" });
    const firstPage = await app.inject({ method: "GET", url: "/api/plan/cities-page?limit=2", headers: { cookie } });
    expect(firstPage.statusCode).toBe(200);
    expect(firstPage.json().items).toHaveLength(2);
    expect(firstPage.json().nextCursor).toBeTruthy();
    const secondPage = await app.inject({ method: "GET", url: `/api/plan/cities-page?limit=2&cursor=${encodeURIComponent(firstPage.json().nextCursor)}`, headers: { cookie } });
    expect(secondPage.json().items).toHaveLength(1);
    expect(new Set([...firstPage.json().items, ...secondPage.json().items].map((item: { id: string }) => item.id)))
      .toEqual(new Set([bootstrap.json().initialCity.id, city.id, secondCity.id]));
    expect((await app.inject({ method: "GET", url: "/api/plan/cities-page?cursor=tampered", headers: { cookie } })).statusCode).toBe(400);

    const taskChunk = await service.chunkForCell(task.origin);
    const compactHeaders = { cookie, accept: "application/vnd.tasktopia.chunk-payload+json; version=2" };
    const overviewResponse = await app.inject({ method: "GET", url: `/api/chunks/${taskChunk.chunkX}/${taskChunk.chunkY}?lod=overview`, headers: compactHeaders });
    const overviewChunk = overviewResponse.json();
    expect(overviewResponse.headers.etag).toContain(countryId);
    expect(overviewResponse.headers["cache-control"]).toBe("private, no-cache, must-revalidate");
    expect(overviewResponse.headers["x-world-version"]).toBe(String(overviewChunk.publishedVersion));
    const detailChunk = (await app.inject({ method: "GET", url: `/api/chunks/${taskChunk.chunkX}/${taskChunk.chunkY}?lod=detail`, headers: compactHeaders })).json();
    expect(overviewChunk.tasks).toMatchObject([{ id: task.id }]);
    expect(overviewChunk).toMatchObject({ payloadVersion: 1, generatorVersion: "square-v7", lod: "OVERVIEW" });
    expect(overviewChunk.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(overviewChunk).not.toHaveProperty("terrain");
    expect(overviewChunk).not.toHaveProperty("decorations");
    // V10: the overview pedestrian layer contains SIDEWALK cells along every
    // street plus PATH cells where a lot needed an extra footpath.
    expect(overviewChunk.surfaces.length).toBeLessThan(400);
    expect(overviewChunk.surfaces.every((surface: SurfaceCellDto) => surface.kind === "PATH" || surface.kind === "SIDEWALK")).toBe(true);
    expect(overviewChunk.worldFeatures).toEqual([]);
    expect(detailChunk).toMatchObject({ payloadVersion: 1, generatorVersion: "square-v7", lod: "DETAIL" });
    expect(detailChunk).not.toHaveProperty("terrain");
    expect(detailChunk).not.toHaveProperty("decorations");
    // A task footprint may legally straddle a chunk whose access surface is in
    // the adjacent chunk. The detail contract guarantees the collection, not
    // that every task-containing chunk has a surface cell of its own.
    expect(detailChunk.surfaces).toEqual(expect.any(Array));
    const legacyResponse = await app.inject({
      method: "GET", url: `/api/chunks/${taskChunk.chunkX}/${taskChunk.chunkY}?lod=overview`, headers: { cookie },
    });
    expect(legacyResponse.json()).toMatchObject({ chunkX: taskChunk.chunkX, chunkY: taskChunk.chunkY, terrain: expect.any(Array), decorations: expect.any(Array) });
    expect(legacyResponse.json()).not.toHaveProperty("payloadVersion");
    expect(legacyResponse.headers.etag).not.toBe(overviewResponse.headers.etag);
    expect(legacyResponse.headers.vary).toBe("Accept");
    const revalidated = await app.inject({
      method: "GET",
      url: `/api/chunks/${taskChunk.chunkX}/${taskChunk.chunkY}?lod=overview`,
      headers: { ...compactHeaders, "if-none-match": overviewResponse.headers.etag! },
    });
    expect(revalidated.statusCode).toBe(304);
    expect(revalidated.headers["x-world-version"]).toBe(String(overviewChunk.publishedVersion));
    const persisted = await db.prepare(`SELECT content_hash FROM world_chunk_payloads_v1
      WHERE country_id = ? AND chunk_x = ? AND chunk_y = ? AND lod = 'OVERVIEW'`)
      .get(countryId, taskChunk.chunkX, taskChunk.chunkY);
    expect(persisted?.content_hash).toBe(overviewChunk.contentHash);
    const afterRestart = await new AppService(db).getChunkPayload(countryId, taskChunk.chunkX, taskChunk.chunkY, "OVERVIEW");
    expect(afterRestart.contentHash).toBe(overviewChunk.contentHash);
    await service.addTaskComment(countryId, {
      taskId: task.id,
      body: "Metadata-only update must preserve published geometry",
      idempotencyKey: "chunk-etag-comment",
    });
    const afterComment = await new AppService(db).getChunkPayload(countryId, taskChunk.chunkX, taskChunk.chunkY, "OVERVIEW");
    expect(afterComment.contentHash).toBe(overviewChunk.contentHash);
    expect(afterComment.publishedVersion).toBeGreaterThan(overviewChunk.publishedVersion);
    const revalidatedAfterComment = await app.inject({
      method: "GET",
      url: `/api/chunks/${taskChunk.chunkX}/${taskChunk.chunkY}?lod=overview`,
      headers: { ...compactHeaders, "if-none-match": overviewResponse.headers.etag! },
    });
    expect(revalidatedAfterComment.statusCode).toBe(304);
    expect(revalidatedAfterComment.headers["x-world-version"]).toBe(String(afterComment.publishedVersion));
    await db.prepare(`DELETE FROM world_chunk_payloads_v1
      WHERE country_id = ? AND chunk_x = ? AND chunk_y = ? AND lod = 'OVERVIEW'`)
      .run(countryId, taskChunk.chunkX, taskChunk.chunkY);
    const rebuiltAfterComment = await new AppService(db).getChunkPayload(countryId, taskChunk.chunkX, taskChunk.chunkY, "OVERVIEW");
    expect(rebuiltAfterComment.publishedVersion).toBeGreaterThan(overviewChunk.publishedVersion);
    expect(rebuiltAfterComment.contentHash).toBe(overviewChunk.contentHash);

    const loggedOut = await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie } });
    expect(loggedOut.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/bootstrap", headers: { cookie } })).statusCode).toBe(401);

    const loggedIn = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "MAYOR@example.test", password: "safe-password-123" },
    });
    expect(loggedIn.statusCode).toBe(200);
    expect(loggedIn.headers["set-cookie"]).toBeDefined();
  }, 30_000);

  it("creates the named country and first city during onboarding", async () => {
    const registered = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "founder@example.test",
        name: "Product Founder",
        password: "safe-password-123",
        passwordConfirmation: "safe-password-123",
        countryName: "Платформа",
        cityName: "Мобильное приложение",
      },
    });
    expect(registered.statusCode).toBe(200);
    const setCookie = registered.headers["set-cookie"]!;
    const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;

    const bootstrap = (await app.inject({ method: "GET", url: "/api/bootstrap", headers: { cookie } })).json();
    expect(bootstrap).toMatchObject({
      country: { name: "Платформа" },
      archive: { name: "Государственный архив", stage: 1, recordCount: 0 },
      initialCity: { name: "Мобильное приложение" },
      stats: { cities: 1, districts: 0, tasks: 0, activeDistricts: 0, unfinishedBuildings: 0 },
    });

    const createdRecord = await app.inject({
      method: "POST", url: "/api/archive/records", headers: { cookie },
      payload: { kind: "REPOSITORY", title: "Репозиторий", sourceUrl: "https://github.com/example/project", tags: ["git"], idempotencyKey: "archive-http-create" },
    });
    expect(createdRecord.statusCode).toBe(200);
    expect(createdRecord.json()).toMatchObject({ kind: "REPOSITORY", tags: ["git"] });
    const records = await app.inject({ method: "GET", url: "/api/archive/records", headers: { cookie } });
    expect(records.json()).toMatchObject([{ title: "Репозиторий" }]);
  }, 15_000);

  it("exposes exact-confirmed city, district and task deletion to an authenticated editor", async () => {
    const registered = await app.inject({
      method: "POST", url: "/api/auth/register",
      payload: { email: "delete-http@example.test", name: "Delete Mayor", password: "safe-password-123", passwordConfirmation: "safe-password-123", countryName: "Deletion Land", cityName: "Permanent City" },
    });
    const setCookie = registered.headers["set-cookie"]!;
    const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;
    const bootstrap = (await app.inject({ method: "GET", url: "/api/bootstrap", headers: { cookie } })).json();
    const countryId = bootstrap.country.id as string;
    const city = await service.createCity(countryId, { name: "Disposable City", idempotencyKey: "http-delete-city-create" });
    const district = await service.createDistrict(countryId, { cityId: city.id, name: "Disposable District", activate: true, idempotencyKey: "http-delete-district-create" });
    const task = await service.createTask(countryId, { cityId: city.id, districtId: district.id, title: "Disposable Task", estimate: 1, idempotencyKey: "http-delete-task-create" });
    const wrong = await app.inject({ method: "DELETE", url: `/api/tasks/${task.id}`, headers: { cookie }, payload: { confirmTitle: "wrong", idempotencyKey: "http-delete-task-wrong" } });
    expect(wrong.statusCode).toBe(400);
    expect((await app.inject({ method: "DELETE", url: `/api/tasks/${task.id}`, headers: { cookie }, payload: { confirmTitle: task.title, idempotencyKey: "http-delete-task" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "DELETE", url: `/api/districts/${district.id}`, headers: { cookie }, payload: { confirmName: district.name, idempotencyKey: "http-delete-district" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "DELETE", url: `/api/cities/${city.id}`, headers: { cookie }, payload: { confirmName: city.name, idempotencyKey: "http-delete-city" } })).statusCode).toBe(200);
    const regenerated = await app.inject({ method: "POST", url: `/api/countries/${countryId}/regenerate`, headers: { cookie }, payload: { confirmName: "Deletion Land", idempotencyKey: "http-regenerate-country" } });
    expect(regenerated.statusCode).toBe(200);
    expect(regenerated.json()).toMatchObject({ regenerated: true, cities: 1, districts: 0, tasks: 0 });
  }, 60_000);

  it("requires the first country and city at the public registration boundary", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "empty-world@example.test", name: "Empty World", password: "safe-password-123", passwordConfirmation: "safe-password-123" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "INVALID_INPUT", message: "Введите название первой страны" });
  });

  it("keeps login available while public registration is disabled", async () => {
    await app.close();
    await registerUser(db, {
      email: "private-user@example.test",
      name: "Private User",
      password: "safe-password-123",
    });
    app = Fastify();
    await app.register(fastifyCookie);
    await registerRoutes(app, db, service, { registrationEnabled: false });
    await app.ready();

    const authConfig = await app.inject({ method: "GET", url: "/api/auth/config" });
    expect(authConfig.statusCode).toBe(200);
    expect(authConfig.json()).toEqual({ registrationEnabled: false });
    expect(authConfig.headers["cache-control"]).toBe("no-store");

    const registration = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "outsider@example.test",
        name: "Outsider",
        password: "safe-password-123",
        passwordConfirmation: "safe-password-123",
        countryName: "Outsider Country",
        cityName: "Outsider City",
      },
    });
    expect(registration.statusCode).toBe(403);
    expect(registration.json()).toEqual({
      error: "REGISTRATION_DISABLED",
      message: "Публичная регистрация отключена администратором",
    });

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "private-user@example.test", password: "safe-password-123" },
    });
    expect(login.statusCode).toBe(200);
    expect(login.headers["set-cookie"]).toBeDefined();
  });

  it("rolls back the whole onboarding when first-city generation fails", async () => {
    vi.spyOn(service, "createCity").mockRejectedValueOnce(new Error("world generation failed"));
    const response = await app.inject({
      method: "POST", url: "/api/auth/register",
      payload: {
        email: "rollback@example.test", name: "Rollback Founder", password: "safe-password-123", passwordConfirmation: "safe-password-123",
        countryName: "Rollback Product", cityName: "Rollback Epic",
      },
    });
    expect(response.statusCode).toBe(500);
    expect(await db.prepare("SELECT 1 FROM users WHERE email = ?").get("rollback@example.test")).toBeUndefined();
    expect(await db.prepare("SELECT 1 FROM countries WHERE name = ?").get("Rollback Product")).toBeUndefined();
  });

  it("returns a clear conflict instead of Bad Request or 500 for an existing email", async () => {
    const payload = { email: "duplicate@example.test", name: "First Mayor", password: "safe-password-123", passwordConfirmation: "safe-password-123", countryName: "Duplicate Project", cityName: "Duplicate City" };
    expect((await app.inject({ method: "POST", url: "/api/auth/register", payload })).statusCode).toBe(200);

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { ...payload, name: "Second Mayor" },
    });

    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toEqual({
      error: "CONFLICT",
      message: "Аккаунт с таким email уже существует",
    });
  });

  it("returns understandable validation and credential errors", async () => {
    const malformed = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "not-an-email", name: "X", password: "short", passwordConfirmation: "short", countryName: "Invalid Project", cityName: "Invalid City" },
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toMatchObject({ error: "INVALID_INPUT", message: "Введите корректный email" });

    const invalidLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "nobody@example.test", password: "safe-password-123" },
    });
    expect(invalidLogin.statusCode).toBe(401);
    expect(invalidLogin.json()).toMatchObject({ error: "UNAUTHENTICATED", message: "Неверный email или пароль" });
  });

  it("requires matching password confirmation for public registration", async () => {
    const missing = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "missing-confirmation@example.test",
        name: "Missing Confirmation",
        password: "safe-password-123",
        countryName: "Missing Confirmation Country",
        cityName: "Missing Confirmation City",
      },
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toMatchObject({
      error: "INVALID_INPUT",
      message: "Повторите пароль",
    });

    const mismatched = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "mismatched-password@example.test",
        name: "Mismatched Password",
        password: "safe-password-123",
        passwordConfirmation: "different-password-456",
        countryName: "Mismatched Password Country",
        cityName: "Mismatched Password City",
      },
    });
    expect(mismatched.statusCode).toBe(400);
    expect(mismatched.json()).toMatchObject({
      error: "INVALID_INPUT",
      message: "Пароли не совпадают",
    });
  });

  it("does not trust a client-supplied forwarded host for CSRF checks", async () => {
    const rejected = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      headers: { origin: "https://attacker.example", "x-forwarded-host": "attacker.example" },
      payload: { email: "csrf@example.test", name: "CSRF Test", password: "safe-password-123", passwordConfirmation: "safe-password-123", countryName: "CSRF Project", cityName: "CSRF City" },
    });
    expect(rejected.statusCode).toBe(403);
    expect(rejected.json()).toMatchObject({ error: "INVALID_ORIGIN" });

    const accepted = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      headers: { origin: "http://localhost:5173" },
      payload: { email: "trusted@example.test", name: "Trusted Test", password: "safe-password-123", passwordConfirmation: "safe-password-123", countryName: "Trusted Project", cityName: "Trusted City" },
    });
    expect(accepted.statusCode).toBe(200);
  });

  it("notifies the realtime boundary when a session is revoked", async () => {
    const revokedUsers: string[] = [];
    await app.close();
    app = Fastify();
    await app.register(fastifyCookie);
    await registerRoutes(app, db, service, {
                              onUserSessionRevoked: (userId) => { revokedUsers.push(userId); },
                            });
    await app.ready();
    const registered = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email: "socket-logout@example.test", name: "Socket Logout", password: "safe-password-123", passwordConfirmation: "safe-password-123", countryName: "Socket Project", cityName: "Socket City" },
    });
    const cookieHeader = registered.headers["set-cookie"]!;
    const cookie = (Array.isArray(cookieHeader) ? cookieHeader[0]! : cookieHeader).split(";")[0]!;
    const userId = registered.json().user.id as string;

    expect((await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie } })).statusCode).toBe(200);
    expect(revokedUsers).toEqual([userId]);
  });
});
