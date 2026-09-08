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
    expect(response.json()).toMatchObject({ schemaVersion: 4 });
    expect(response.json().countries).toHaveLength(2);
    expect(response.json().countries.map((country: { name: string }) => country.name).sort()).toEqual(["Вторая страна", "Первая страна"]);
    expect(response.json().countries.find((country: { name: string }) => country.name === "Первая страна")).toMatchObject({
      cityCount: 1,
      buildingCount: 2,
      unfinishedBuildingCount: 1,
    });

    // A real active placement supplies a station only once construction is complete.
    const placement = await db.prepare("SELECT p.block_id,p.slot_key FROM task_placements_v1 p JOIN city_layouts_v1 l ON l.id=p.layout_id WHERE p.task_id=? AND l.status='ACTIVE'").get<{block_id:string;slot_key:string}>(completed.id);
    expect(placement).toBeTruthy();
    await db.prepare("UPDATE city_blocks_v1 SET parameters_json=jsonb_set(parameters_json, '{slotRoles}', COALESCE(parameters_json->'slotRoles','{}'::jsonb) || jsonb_build_object(?::text,'RAILWAY'::text),true) WHERE id=?").run(placement!.slot_key,placement!.block_id);
    await db.prepare("UPDATE task_placements_v1 SET construction_stage=4 WHERE task_id=?").run(completed.id);
    const unfinishedStation = (await app.inject({method:"GET",url:"/api/planet-atlas",headers:{cookie}})).json();
    expect(unfinishedStation.countries.flatMap((c:{cities:Array<{stations:unknown[]}>})=>c.cities.flatMap(city=>city.stations))).toEqual([]);
    await db.prepare("UPDATE task_placements_v1 SET construction_stage=5 WHERE task_id=?").run(completed.id);
    const stationResponse = await app.inject({method:"GET",url:"/api/planet-atlas",headers:{cookie}});
    expect(stationResponse.statusCode).toBe(200);
    expect(stationResponse.json().countries.flatMap((c:{cities:Array<{stations:unknown[]}>})=>c.cities.flatMap(city=>city.stations))).toEqual([expect.objectContaining({taskId:completed.id,center:{x:expect.any(Number),y:expect.any(Number)}})]);
    expect(stationResponse.json().revision).not.toBe(unfinishedStation.revision);

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
