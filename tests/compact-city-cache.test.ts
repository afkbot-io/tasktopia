import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";
import type { RealtimeEvent } from "../src/shared/contracts";

describe("compact layout replica cache", { timeout: 30_000 }, () => {
  let db: Db;
  let countryId: string;

  beforeEach(async () => {
    db = await createTestDb();
    countryId = (await registerUser(db, { email: "compact-cache@example.com", name: "Cache review", password: "password123" })).user.countryId;
    await db.prepare("UPDATE countries SET seed=424242 WHERE id=?").run(countryId);
  });

  afterEach(async () => { await db?.close(); });

  it("rebuilds a published chunk without block plaques instead of reusing the previous renderer contract", async () => {
    const writer = new AppService(db);
    const city = await writer.createCity(countryId, { name: "Plaque cache", idempotencyKey: "plaque-city" });
    const district = await writer.createDistrict(countryId, { cityId: city.id, name: "Plaque district", activate: true, idempotencyKey: "plaque-district" });
    await writer.createTask(countryId, { cityId: city.id, districtId: district.id, title: "Plaque task", estimate: 1, idempotencyKey: "plaque-task" });
    const plaque = (await writer.listDistricts(countryId, city.id))[0]!.blockPlaques![0]!;
    const { chunkX, chunkY } = writer.chunkForCell(plaque.origin);
    const before = await writer.getChunkPayload(countryId, chunkX, chunkY);
    expect(before.blockPlaques).toContainEqual(plaque);
    const old = { ...before }; delete old.blockPlaques;
    await db.prepare("UPDATE world_chunk_payloads_v1 SET payload_json=?::jsonb WHERE country_id=? AND chunk_x=? AND chunk_y=?")
      .run(JSON.stringify(old), countryId, chunkX, chunkY);
    const next = await new AppService(db).getChunkPayload(countryId, chunkX, chunkY);
    expect(next.blockPlaques).toContainEqual(plaque);
  });

  it("serves a newly allocated task before its realtime event reaches a warm reader", async () => {
    const events: RealtimeEvent[] = [];
    const writer = new AppService(db, (event) => events.push(event));
    const reader = new AppService(db);
    const city = await writer.createCity(countryId, { name: "Replica cache city", idempotencyKey: "city" });
    const district = await writer.createDistrict(countryId, { cityId: city.id, name: "Replica cache district", activate: true, idempotencyKey: "district" });
    const first = await writer.createTask(countryId, { cityId: city.id, districtId: district.id, title: "First building", estimate: 1, idempotencyKey: "first" });
    const coordinate = writer.chunkForCell(first.origin);
    const before = await reader.getChunkPayload(countryId, coordinate.chunkX, coordinate.chunkY);
    expect(before.tasks.map((task) => task.id)).toContain(first.id);

    const second = await writer.createTask(countryId, { cityId: city.id, districtId: district.id, title: "Second building", estimate: 1, idempotencyKey: "second" });
    const delayedEvent = events.findLast((event) => event.type === "task.created")!;
    expect(delayedEvent.payload.taskId).toBe(second.id);
    const secondCoordinate = writer.chunkForCell(second.origin);
    // Deliberately learn the committed world version through HTTP/chunk read
    // before accepting the corresponding event from the durable event stream.
    const after = await reader.getChunkPayload(countryId, secondCoordinate.chunkX, secondCoordinate.chunkY);
    expect(after.publishedVersion).toBeGreaterThan(before.publishedVersion);
    expect(after.tasks.find((task) => task.id === second.id)).toMatchObject({ origin: second.origin, stage: 1 });

    reader.acceptExternalEvent(delayedEvent);
    expect((await reader.getTask(countryId, second.id)).origin).toEqual(second.origin);
    const settled = await reader.getChunkPayload(countryId, secondCoordinate.chunkX, secondCoordinate.chunkY);
    expect(settled.tasks.find((task) => task.id === second.id)?.origin).toEqual(second.origin);
  });
});
