import fastifyCookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { createTestDb, type Db } from "../src/server/db";
import { registerRoutes } from "../src/server/routes";

describe("planet atlas HTTP boundary", () => {
  let db: Db;
  let app: FastifyInstance;
  let service: AppService;

  beforeEach(async () => {
    db = await createTestDb();
    app = Fastify();
    service = new AppService(db);
    await app.register(fastifyCookie);
    await registerRoutes(app, db, service);
    await app.ready();
  });

  afterEach(async () => { await app.close(); await db.close(); });

  it("returns only accessible countries with compact aggregate sizes", async () => {
    const register = await app.inject({ method: "POST", url: "/api/auth/register", payload: {
      email: "planet@example.com", name: "Planet Owner", password: "password-123", passwordConfirmation: "password-123",
      countryName: "Первая страна", cityName: "Первый город",
    } });
    const setCookie = register.headers["set-cookie"]!;
    const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(";")[0]!;
    const registered = (await app.inject({ method: "GET", url: "/api/bootstrap", headers: { cookie } })).json() as {
      country: { id: string };
      initialCity: { id: string };
    };
    const district = await service.createDistrict(registered.country.id, {
      cityId: registered.initialCity.id,
      name: "Контрактный район",
      activate: true,
      idempotencyKey: "planet-contract-district",
    });
    await service.createTask(registered.country.id, {
      cityId: registered.initialCity.id,
      districtId: district.id,
      title: "Незавершённое здание",
      estimate: 1,
      idempotencyKey: "planet-contract-open",
    });
    let completed = await service.createTask(registered.country.id, {
      cityId: registered.initialCity.id,
      districtId: district.id,
      title: "Завершённое здание",
      estimate: 1,
      idempotencyKey: "planet-contract-completed",
    });
    for (const [status, key] of [["STARTED", "started"], ["IN_PROGRESS", "in-progress"], ["TESTING", "testing"], ["COMPLETED", "completed"]] as const) {
      completed = await service.updateTaskStatus(registered.country.id, {
        taskId: completed.id,
        status,
        idempotencyKey: `planet-contract-${key}`,
      });
    }
    await app.inject({ method: "POST", url: "/api/countries", headers: { cookie }, payload: { name: "Вторая страна" } });
    await app.inject({ method: "POST", url: "/api/auth/register", payload: {
      email: "outsider-planet@example.com", name: "Outside Owner", password: "password-123", passwordConfirmation: "password-123",
      countryName: "Чужая страна", cityName: "Чужой город",
    } });

    const response = await app.inject({ method: "GET", url: "/api/planet-atlas", headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toContain("private");
    expect(response.json()).toMatchObject({ schemaVersion: 2 });
    expect(response.json().countries).toHaveLength(2);
    expect(response.json().countries.map((country: { name: string }) => country.name).sort()).toEqual(["Вторая страна", "Первая страна"]);
    expect(response.json().countries.find((country: { name: string }) => country.name === "Первая страна")).toMatchObject({
      cityCount: 1,
      buildingCount: 2,
      unfinishedBuildingCount: 1,
    });

    const renamedCountry = response.json().countries.find((country: { name: string }) => country.name === "Первая страна") as { id: string };
    const renamed = await app.inject({ method: "PATCH", url: `/api/countries/${renamedCountry.id}`, headers: { cookie }, payload: { name: "Первая республика" } });
    expect(renamed.statusCode).toBe(200);
    const revalidated = await app.inject({ method: "GET", url: "/api/planet-atlas", headers: { cookie, "if-none-match": response.headers.etag! } });
    expect(revalidated.statusCode).toBe(200);
    expect(revalidated.json().countries.map((country: { name: string }) => country.name)).toContain("Первая республика");
  }, 90_000);

  it("requires an authenticated account", async () => {
    expect((await app.inject({ method: "GET", url: "/api/planet-atlas" })).statusCode).toBe(401);
  });
});
