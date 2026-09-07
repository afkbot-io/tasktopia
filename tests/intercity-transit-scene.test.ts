import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb, type Db } from "../src/server/db";
import { registerUser } from "../src/server/auth";
import { AppService } from "../src/server/app-service";
import { readCountryRoads } from "../src/server/world/intercity-road-store";
import { CityRoadPadding } from "../src/client/city-road-padding";
import type { IntercityRoadRoute } from "../src/shared/intercity-roads";
import { expandRoadRuns } from "../src/shared/world-cell-runs";

describe("canonical transit roads in the CITY read model", () => {
  let db: Db | undefined;
  afterEach(async () => { await db?.close(); });

  it("continues a B–C route across A's resident chunk edge without including distant routes or foreign entities", async () => {
    db = await createTestDb();
    const user = (await registerUser(db, { email: "transit-scene@example.com", name: "Transit scene", password: "password123" })).user;
    const service = new AppService(db);
    const city = await service.createCity(user.countryId, { name: "Viewed city", idempotencyKey: "city" });
    const district = await service.createDistrict(user.countryId, { cityId: city.id, name: "Viewed sprint", activate: true, idempotencyKey: "district" });
    const task = await service.createTask(user.countryId, { cityId: city.id, districtId: district.id, title: "Only local task", estimate: 1, idempotencyKey: "task" });
    const initial = await service.getCityScene(user.countryId, city.id);
    const size = initial.chunkSize;
    const right = Math.max(...initial.chunks.map(chunk => chunk.chunkX));
    const top = Math.min(...initial.chunks.map(chunk => chunk.chunkY));
    const edgeX = (right + 1) * size;
    const y = top * size + 8;
    const b = randomUUID(), c = randomUUID();
    // The durable snapshot is the producer's authority. These two compressed
    // fixtures isolate read-model selection, not the separately tested dry A*.
    const transit: IntercityRoadRoute = { id: "accepted-b-c", fromCityId: b, toCityId: c,
      fromNodeId: "b:perimeter", toNodeId: "c:perimeter", widthCells: 3,
      geometry: { start: { x: edgeX - 2 * size, y }, runs: [{ direction: "E", length: 4 * size }] } };
    const far: IntercityRoadRoute = { ...transit, id: "accepted-distant", fromCityId: randomUUID(), toCityId: randomUUID(),
      geometry: { start: { x: edgeX + 100 * size, y }, runs: [{ direction: "S", length: size }] } };
    const snapshot = (await readCountryRoads(db, user.countryId))!;
    const plan = { ...snapshot.plan, routes: [transit, far] };
    await db.prepare("UPDATE country_road_snapshots_v1 SET revision=revision+1,plan_json=?::jsonb WHERE country_id=?")
      .run(JSON.stringify(plan), user.countryId);
    await db.prepare("UPDATE countries SET world_version=world_version+1 WHERE id=?").run(user.countryId);
    // Mirror a topology-changing mutation's derived payload invalidation.
    await db.prepare("DELETE FROM world_chunk_payloads_v1 WHERE country_id=?").run(user.countryId);
    const fresh = new AppService(db);
    const scene = await fresh.getCityScene(user.countryId, city.id);
    const resident = scene.chunks.find(chunk => chunk.chunkX === right && chunk.chunkY === top)!;
    expect(expandRoadRuns(resident.roadRuns)).toContainEqual(expect.objectContaining({ x: edgeX - 1, y, mask: 15 }));
    expect(scene.intercityRoads).toEqual([transit]);
    const padding = new CityRoadPadding(scene, () => true).get(right + 1, top)!;
    expect(padding.roads).toContainEqual(expect.objectContaining({ x: edgeX, y, mask: 15 }));
    expect(padding.roadContext.get(`${edgeX - 1},${y}`)?.mask).toBe(15);
    expect(new Set(scene.chunks.flatMap(chunk => chunk.tasks.map(item => item.id)))).toEqual(new Set([task.id]));
    expect(scene.sceneRevision).not.toBe(initial.sceneRevision);
    expect(await fresh.getCityScene(user.countryId, city.id)).toEqual(scene);
  });
});
