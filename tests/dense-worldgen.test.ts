import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";
import type { DistrictArchetype } from "../src/shared/contracts";
import { auditWorld, type WorldAuditResult } from "../src/server/world/world-audit";
import { readActiveBlockLayout } from "../src/server/world/active-block-layout";
import { compileBlockLayout, rasterizeBlockRoads } from "../src/server/world/block-layout-compiler";
import type { CompiledBlockLayoutV1 } from "../src/shared/block-world";

function perimeterAsphaltCells(layout: CompiledBlockLayoutV1): Map<string, number> {
  const roads = rasterizeBlockRoads(layout.roadNetwork);
  expect(layout.roadNetwork.segments.every(segment => segment.widthCells === 3)).toBe(true);
  return new Map(layout.blocks.map(block => {
    const { x, y } = block.origin;
    const cells = roads.filter(cell => cell.x >= x && cell.x < x + block.width && cell.y >= y && cell.y < y + block.height);
    // Half-open ownership includes two cells on the west/north edges and
    // one on the east/south edges of the three-cell perimeter street.
    const expected = block.width * block.height - (block.width - 3) * (block.height - 3);
    expect(cells, `Perimeter asphalt count in ${block.id}`).toHaveLength(expected);
    expect(cells.every(cell => cell.x < x + 2 || cell.y < y + 2
      || cell.x >= x + block.width - 1 || cell.y >= y + block.height - 1), `Interior road in ${block.id}`).toBe(true);
    return [block.id, expected];
  }));
}

describe("one-city world generation gate", () => {
  let db: Db;
  let audit: WorldAuditResult;
  let layout: CompiledBlockLayoutV1;
  const districtNames = new Map<string, string>();

  beforeAll(async () => {
    db = await createTestDb();
    const registered = await registerUser(db, {
      email: "small-world@tasktopia.local",
      name: "Small World",
      password: "small-world-password",
    });
    await db.prepare("UPDATE countries SET seed = ? WHERE id = ?").run(424_242, registered.user.countryId);
    const service = new AppService(db);
    const city = await service.createCity(registered.user.countryId, { name: "Riverside", idempotencyKey: "city" });
    const archetypes: DistrictArchetype[] = ["NEW_BUILD", "PRIVATE", "MIXED_URBAN", "COMMERCIAL", "CIVIC"];
    for (let districtIndex = 0; districtIndex < 10; districtIndex += 1) {
      const archetype = archetypes[districtIndex % archetypes.length]!;
      const district = await service.createDistrict(registered.user.countryId, {
                                cityId: city.id,
                                name: `Район ${districtIndex + 1}`,
                                archetype,
                                capacitySp: 26,
                                activate: districtIndex === 0,
                                idempotencyKey: `district-${districtIndex}`,
                              });
      districtNames.set(district.id, district.name);
      for (let taskIndex = 0; taskIndex < 2; taskIndex += 1) {
        await service.createTask(registered.user.countryId, {
                                                  cityId: city.id,
                                                  districtId: district.id,
                                                  title: `Задача ${districtIndex + 1}.${taskIndex + 1}`,
                                                  estimate: archetype === "PRIVATE" ? 1 : 2,
                                                  idempotencyKey: `task-${districtIndex}-${taskIndex}`,
                                                });
      }
    }
    audit = await auditWorld(db, service, registered.user.countryId);
    layout = (await readActiveBlockLayout(db, city.id))!;
  // Coverage instrumentation and parallel database suites can roughly double
  // the bounded 1-city/10-district fixture time on CI runners.
  }, 60_000);

  afterAll(async () => await db.close());

  it("keeps the default fixture bounded to one city and ten districts", () => {
    expect(audit.metrics.cities).toBe(1);
    expect(audit.metrics.districts).toBe(10);
    expect(audit.metrics.tasks).toBe(20);
    expect(Object.values(audit.metrics.tasksPerDistrict)).toEqual(Array.from({ length: 10 }, () => 2));
  });

  it("passes spatial, access, zoning and asphalt invariants", () => {
    expect(audit.violations).toEqual([]);
    expect(audit.metrics.zoningCompliance).toBe(1);
    // Central dense parcels reach the nearest edge through a shared aisle:
    // 2 gate/aisle cells + at most4 horizontal +14 to the nearer north/south
    // sidewalk in the largest32-cell block. Reverse-distance tests separately
    // prove each emitted route is shortest, rather than hiding a long detour.
    expect(audit.metrics.maximumEntranceAccessLength).toBeLessThanOrEqual(20);
    const perimeter = perimeterAsphaltCells(layout), shares: number[] = [];
    for (const district of layout.districtLayouts) {
      const owned = layout.blocks.filter(block => block.districtLayoutId === district.id);
      const area = owned.reduce((sum, block) => sum + block.width * block.height, 0);
      const share = area ? owned.reduce((sum, block) => sum + perimeter.get(block.id)!, 0) / area : 0;
      // A valid24×24 block uses135/576=23.4375%; a universal20% cap
      // depended on random IDs selecting only larger fallback templates.
      expect(audit.metrics.asphaltSharePerDistrict[districtNames.get(district.districtId)!]).toBe(share);
      shares.push(share);
    }
    expect(audit.metrics.maximumResidentialAsphaltShare).toBe(Math.max(...shares));
    expect(audit.metrics.surfaceCells).toBeGreaterThan(0);
    expect(audit.metrics.roadJunctionsPerCity.Riverside).toBeGreaterThan(0);
  });

  it("qualifies the exact135-cell perimeter of a compact24×24 fallback", () => {
    const compact = compileBlockLayout({ countryId: "country", cityId: "city", seed: 424242, revision: 1,
      canPlaceBlock: bounds => bounds.minX >= -2 && bounds.minY >= -2 && bounds.maxX <= 26 && bounds.maxY <= 26,
      districts: [{ id: "district", sequence: 0, archetype: "MIXED_URBAN", tasks: [{ id: "task", taskNumber: 1,
        constructionStage: 3, buildingFamily: "compact-apartment-v1", requestedFamily: "compact-apartment-v1", facadeVariant: "south" }] }] });
    expect(compact.blocks.map(block => [block.width, block.height])).toEqual([[24, 24]]);
    expect([...perimeterAsphaltCells(compact).values()]).toEqual([135]);
  });
});
