import { describe, expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createTestDb } from "../src/server/db";
import { readActiveBlockLayout, synchronizeCityBlocks } from "../src/server/world/active-block-layout";
import type { Cell } from "../src/shared/contracts";
import type { CitySceneDto } from "../src/shared/city-scene-contract";
import { taskParkDecorLayout } from "../src/shared/task-park";
import { expandCellRuns } from "../src/shared/world-cell-runs";
import { materializeChunkPayload } from "../src/shared/world-chunk-payload";

describe("public-space task persistence", () => {
  it("keeps completed park furniture and building frontage when real occupied lots enter the hard mask", async () => {
    const db = await createTestDb();
    try {
      const service = new AppService(db);
      const { countryId } = (await registerUser(db, { email: "park-hard-mask@example.test", name: "Parks", password: "password123" })).user;
      await db.prepare("UPDATE countries SET seed=424242 WHERE id=?").run(countryId);
      const city = await service.createCity(countryId, { name: "Occupied park mask", idempotencyKey: "city" });
      const district = await service.createDistrict(countryId, { cityId: city.id, name: "Furniture sprint", activate: true, idempotencyKey: "district" });
      const house = await service.createTask(countryId, { cityId: city.id, districtId: district.id, title: "Completed home", estimate: 1,
        buildingHint: "compact-apartment-v1", idempotencyKey: "home" });
      const park = await service.createTask(countryId, { cityId: city.id, districtId: district.id, title: "Completed garden", estimate: 1,
        parkVariant: "urban-large", idempotencyKey: "park" });
      for (const task of [house, park]) for (const status of ["STARTED", "IN_PROGRESS", "TESTING", "COMPLETED"] as const) {
        await service.updateTaskStatus(countryId, { taskId: task.id, status, idempotencyKey: `${task.id}-${status}` });
      }

      const fresh = new AppService(db);
      const key = (cell: Cell) => `${cell.x},${cell.y}`;
      const lots = (await fresh.listDistricts(countryId, city.id)).flatMap(value => value.lots);
      // The actual producer passes occupied lots too. Their mask is the task
      // footprint, not the larger construction-clearance/site rectangle.
      for (const task of [house, park]) {
        const lot = lots.find(value => value.taskId === task.id)!;
        expect(lot.vacant).toBe(false);
        const lotCells = Array.from({ length: lot.width * lot.height }, (_, index) => ({
          x: lot.origin.x + index % lot.width, y: lot.origin.y + Math.floor(index / lot.width),
        }));
        expect(new Set(lotCells.map(key))).toEqual(new Set(task.footprint.map(key)));
      }
      const scene = await fresh.getCityScene(countryId, city.id);
      const wire = JSON.parse(JSON.stringify(scene)) as CitySceneDto;
      const hard = new Set(wire.chunks.flatMap(chunk => expandCellRuns(chunk.decorationContext.blockedCellRuns)).map(key));
      expect(park.footprint.every(cell => hard.has(key(cell)))).toBe(true);
      expect(house.footprint.every(cell => hard.has(key(cell)))).toBe(true);
      const chunks = wire.chunks.map(chunk => materializeChunkPayload(chunk));
      const renderedPark = chunks.flatMap(chunk => chunk.tasks).find(task => task.id === park.id)!;
      expect(renderedPark).toMatchObject({ stage: 5, visualKind: "PARK", visualAssetKey: "urban-large" });
      // This is the task-backed park composition invoked by WorldCanvas,
      // separate from natural decoration exclusion masks.
      const parkFurniture = taskParkDecorLayout(renderedPark.footprint, 5, renderedPark.visualAssetKey, renderedPark.taskNumber)
        .filter(prop => prop.kind.startsWith("courtyard-"));
      expect(parkFurniture.map(prop => prop.kind).sort()).toEqual([
        "courtyard-cycle-rack", "courtyard-picnic-table", "courtyard-square-planter",
      ]);
      expect(parkFurniture).toEqual(taskParkDecorLayout(park.footprint, 5, park.visualAssetKey, park.taskNumber)
        .filter(prop => prop.kind.startsWith("courtyard-")));
      const isHouseFurniture = (prop: { id: string; kind: string }) => prop.id.startsWith(`frontage:${house.id}:`)
        && prop.kind.startsWith("courtyard-");
      const frontage = chunks.flatMap(chunk => chunk.decorations).filter(isHouseFurniture);
      expect(frontage).toHaveLength(1);
      expect(frontage[0]!.kind).toBe("courtyard-cycle-rack");
      expect(hard.has(key(frontage[0]!.origin))).toBe(false);
      expect(frontage).toEqual(scene.chunks.flatMap(chunk => materializeChunkPayload(chunk).decorations)
        .filter(isHouseFurniture));
    } finally { await db.close(); }
  }, 30_000);

  it("keeps compact fountain identity/stages on refresh and transfer, and reserves its deleted location permanently", async () => {
    const db = await createTestDb();
    try {
      const service = new AppService(db);
      const { countryId } = (await registerUser(db, { email: "parks@example.test", name: "Parks", password: "password123" })).user;
      await db.prepare("UPDATE countries SET seed=424242 WHERE id=?").run(countryId);
      const city = await service.createCity(countryId, { name: "Public spaces", idempotencyKey: "city" });
      const district = await service.createDistrict(countryId, { cityId: city.id, name: "Garden sprint", activate: true, idempotencyKey: "district" });
      const house = await service.createTask(countryId, { cityId: city.id, districtId: district.id, title: "House", estimate: 1, idempotencyKey: "house" });
      const fountain = await service.createTask(countryId, { cityId: city.id, districtId: district.id, title: "Fountain", estimate: 1, parkVariant: "urban-fountain", idempotencyKey: "fountain" });
      expect(fountain.visualKind).toBe("PARK");
      expect(fountain.visualAssetKey).toBe("urban-fountain");
      expect(fountain.footprint.length).toBeLessThanOrEqual(36);
      expect((await readActiveBlockLayout(db, city.id))!.blocks).toHaveLength(1);
      for (const status of ["STARTED", "IN_PROGRESS", "TESTING", "COMPLETED"] as const) {
        const changed = await service.updateTaskStatus(countryId, { taskId: fountain.id, status, idempotencyKey: `stage-${status}` });
        expect(changed.footprint).toEqual(fountain.footprint);
        expect(changed.visualAssetKey).toBe("urban-fountain");
      }
      await synchronizeCityBlocks(db, countryId, city.id);
      expect((await new AppService(db).getTask(countryId, fountain.id)).visualAssetKey).toBe("urban-fountain");
      const target = await service.createDistrict(countryId, { cityId: city.id, name: "Next sprint", idempotencyKey: "next" });
      const moved = await service.transferTask(countryId, { taskId: fountain.id, targetDistrictId: target.id, idempotencyKey: "move" });
      expect(moved).toMatchObject({ visualKind: "PARK", visualAssetKey: "urban-fountain", stage: 5 });
      await service.deleteTask(countryId, { taskId: fountain.id, confirmTitle: fountain.title, idempotencyKey: "delete" });
      const sites = await service.listWorldFeatures(countryId);
      expect(sites.filter(s => s.siteMarker)).toHaveLength(2);
      expect((await service.getTask(countryId, house.id)).footprint).toEqual(house.footprint);
      expect(await service.listTasks(countryId)).toHaveLength(1);
    } finally { await db.close(); }
  }, 30_000);

  it("allocates a genuinely large park and keeps automatically selected variants on later writes", async () => {
    const db = await createTestDb();
    try {
      const service = new AppService(db);
      const { countryId } = (await registerUser(db, { email: "park-size@example.test", name: "Parks", password: "password123" })).user;
      await db.prepare("UPDATE countries SET seed=424242 WHERE id=?").run(countryId);
      const city = await service.createCity(countryId, { name: "Park sizes", idempotencyKey: "city" });
      const district = await service.createDistrict(countryId, { cityId: city.id, name: "Park sprint", activate: true, idempotencyKey: "district" });
      for (let n = 0; n < 25; n++) await service.createTask(countryId, { cityId: city.id, districtId: district.id, title: `Work ${n}`, estimate: 1, idempotencyKey: `work-${n}` });
      const before = (await service.listTasks(countryId)).filter(t => t.visualKind === "PARK");
      expect(before.length).toBeGreaterThan(0);
      const large = await service.createTask(countryId, { cityId: city.id, districtId: district.id, title: "Large park", estimate: 3, parkVariant: "urban-large", idempotencyKey: "large" });
      expect(new Set(large.footprint.map(c => c.x)).size).toBeGreaterThanOrEqual(17);
      expect(new Set(large.footprint.map(c => c.y)).size).toBeGreaterThanOrEqual(17);
      await synchronizeCityBlocks(db, countryId, city.id);
      for (const task of before) expect(await new AppService(db).getTask(countryId, task.id)).toMatchObject({ visualAssetKey: task.visualAssetKey, footprint: task.footprint });
      await expect(service.createTask(countryId, { cityId: city.id, districtId: district.id, title: "Invalid", estimate: 1, parkVariant: "toString", idempotencyKey: "invalid" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
      expect(await service.listTasks(countryId)).toHaveLength(26);
    } finally { await db.close(); }
  }, 30_000);
});
