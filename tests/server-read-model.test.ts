import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";
import type { TaskDto } from "../src/shared/contracts";

describe("bounded server task and spatial reads", { timeout: 30_000 }, () => {
  let db: Db, counted: Db, service: AppService, userId: string, countryId: string, task: TaskDto, otherCityId: string;
  const queries: Array<{ query: string; parameters: unknown[] }> = [];
  beforeAll(async () => {
    db = await createTestDb();
    const owner = await registerUser(db, { email: "read-model@example.test", name: "Read model", password: "password123" });
    countryId = owner.user.countryId;
    userId = owner.user.id;
    await db.prepare("UPDATE countries SET seed=424242 WHERE id=?").run(countryId);
    const writer = new AppService(db);
    const city = await writer.createCity(countryId, { name: "Read city", idempotencyKey: "city" });
    const district = await writer.createDistrict(countryId, { cityId: city.id, name: "District", activate: true, idempotencyKey: "district" });
    task = await writer.createTask(countryId, { cityId: city.id, districtId: district.id, title: "Hydrated task", estimate: 1,
      creatorUserId: owner.user.id, assigneeUserId: owner.user.id, forUserId: owner.user.id, idempotencyKey: "task" });
    otherCityId = (await writer.createCity(countryId, { name: "Unrelated city", idempotencyKey: "other-city" })).id;
    counted = {
      prepare(query) {
        const statement = db.prepare(query);
        const record = (parameters: unknown[]) => queries.push({ query, parameters });
        return {
          all: async (...parameters) => { record(parameters); return statement.all(...parameters); },
          get: async (...parameters) => { record(parameters); return statement.get(...parameters); },
          run: async (...parameters) => { record(parameters); return statement.run(...parameters); },
        };
      },
      exec: query => db.exec(query), transaction: callback => db.transaction(callback), close: async () => undefined,
    };
    service = new AppService(counted);
  });
  afterAll(async () => { await db?.close(); });

  it("hydrates every task section with one snapshot query plus the bounded layout read", async () => {
    queries.length = 0;
    const result = await service.getTask(countryId, task.id);
    expect(result).toMatchObject({ id: task.id, origin: task.origin, comments: [], dependencies: [], defects: [], attachments: [], checklist: [],
      creator: { email: "read-model@example.test" }, assignee: { email: "read-model@example.test" }, forUser: { email: "read-model@example.test" } });
    expect(result.documents).toHaveLength(4);
    expect(result.events).toHaveLength(1);
    expect(queries.length).toBeLessThanOrEqual(3);
  });

  it("does not read unrelated city layouts while projecting one cold viewport", async () => {
    queries.length = 0;
    const chunk = service.chunkForCell(task.origin);
    const payload = await service.getViewportPayloads(countryId, chunk.chunkX, chunk.chunkY, chunk.chunkX, chunk.chunkY);
    expect(payload.flatMap(value => value.tasks).map(value => value.id)).toContain(task.id);
    const layouts = queries.filter(value => /FROM city_layouts_v1/.test(value.query));
    expect(layouts.some(value => value.parameters.flat(Infinity).includes(otherCityId))).toBe(false);
  });

  it("does not regenerate city geometry when progress stays inside the same construction stage", async () => {
    await service.updateTaskStatus(countryId, { taskId: task.id, status: "STARTED", idempotencyKey: "start" });
    await service.updateTaskStatus(countryId, { taskId: task.id, status: "IN_PROGRESS", progress: 40, idempotencyKey: "progress" });
    const before = await db.prepare("SELECT revision,checksum FROM city_layouts_v1 WHERE city_id=? AND status='ACTIVE'").get(task.cityId);
    queries.length = 0;
    const result = await service.updateTaskStatus(countryId, { taskId: task.id, status: "IN_PROGRESS", progress: 55, idempotencyKey: "progress-only" });
    expect(result).toMatchObject({ stage: 3, progress: 55, origin: task.origin });
    expect(await db.prepare("SELECT revision,checksum FROM city_layouts_v1 WHERE city_id=? AND status='ACTIVE'").get(task.cityId)).toEqual(before);
    expect(queries.some(value => /UPDATE (?:cities_v3|districts_v3|city_layouts_v1|road_networks_v1)/.test(value.query))).toBe(false);
  });

  it("reads cold COUNTRY city layouts in one snapshot instead of a SQL pair per city", async () => {
    queries.length = 0;
    const overview = await new AppService(counted).getCountryOverview(userId,countryId);
    expect(overview.cities.map(city => city.id)).toEqual(expect.arrayContaining([task.cityId,otherCityId]));
    expect(queries.filter(value => value.query.includes("AS placements"))).toHaveLength(1);
    expect(queries.filter(value => value.query.includes("SELECT revision FROM city_layouts_v1"))).toHaveLength(0);
  });
});
