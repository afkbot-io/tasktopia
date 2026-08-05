import { describe, expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { PROP_CATALOG } from "../src/shared/catalog";
import type { Cell, CityDto, DecorationDto, DistrictDto, SurfaceCellDto, TerrainCellDto } from "../src/shared/contracts";
import { cellKey, rectangleFootprint } from "../src/server/world/grid";

type DecorationGenerator = (
  seed: number,
  terrain: TerrainCellDto[],
  blocked: Set<string>,
  surfaces: SurfaceCellDto[],
  districts: DistrictDto[],
  cities: CityDto[],
) => DecorationDto[];

describe("procedural decoration footprints", () => {
  it("reserves every footprint cell and keeps fences inside their district", () => {
    const terrain: TerrainCellDto[] = [];
    const cells: Cell[] = [];
    for (let y = 0; y < 96; y += 1) for (let x = 0; x < 96; x += 1) {
      terrain.push({ x, y, terrain: "GRASS", variant: 0 });
      cells.push({ x, y });
    }
    const district = {
      id: "district", cityId: "city", name: "Planned", goal: "", status: "PLANNED", capacitySp: 20,
      cells, lots: [], growthDirection: "E", archetype: "MIXED_URBAN", color: "#fff", createdAt: "2026-01-01T00:00:00.000Z",
    } satisfies DistrictDto;
    const generate = (AppService.prototype as unknown as { decorations: DecorationGenerator }).decorations;
    const decorations = generate(84721, terrain, new Set(), [], [district], []);
    const fences = decorations.filter((item) => item.kind.startsWith("fence-"));
    expect(fences.length).toBeGreaterThan(0);
    const occupied = new Set<string>();
    for (const decoration of decorations) {
      const prop = PROP_CATALOG[decoration.kind]!;
      const footprint = rectangleFootprint(decoration.origin, prop.footprint.width, prop.footprint.height);
      expect(footprint.every((cell) => cells.some((candidate) => cellKey(candidate) === cellKey(cell)))).toBe(true);
      expect(footprint.every((cell) => !occupied.has(cellKey(cell)))).toBe(true);
      for (const cell of footprint) occupied.add(cellKey(cell));
    }
  });

  it("keeps boats and stationary people sparse around a representative shoreline", () => {
    const terrain: TerrainCellDto[] = [];
    for (let y = 0; y < 96; y += 1) for (let x = 0; x < 96; x += 1) {
      terrain.push({ x, y, terrain: y < 40 ? "DEEP_WATER" : y < 44 ? "SAND" : "GRASS", variant: 0 });
    }
    const surfaces: SurfaceCellDto[] = Array.from({ length: 76 }, (_, index) => ({ x: index + 10, y: 50, kind: "PATH" }));
    const city: CityDto = {
      id: "city", name: "Harbour", description: "", status: "ACTIVE", center: { x: 48, y: 68 },
      bounds: { minX: 24, minY: 48, maxX: 72, maxY: 88 }, styleId: "pixel-v4", morphology: "BALANCED", createdAt: "2026-01-01T00:00:00.000Z",
    };
    const generate = (AppService.prototype as unknown as { decorations: DecorationGenerator }).decorations;
    const decorations = generate(424242, terrain, new Set(), surfaces, [], [city]);
    const boats = decorations.filter((item) => item.kind.startsWith("boat-"));
    const fishers = decorations.filter((item) => item.kind.startsWith("fisher-"));
    const residents = decorations.filter((item) => item.kind.startsWith("resident-"));
    expect(boats.length).toBeLessThanOrEqual(8);
    expect(fishers.length).toBeLessThanOrEqual(5);
    expect(residents.length).toBeLessThanOrEqual(5);
    expect(boats.length + fishers.length + residents.length).toBeLessThanOrEqual(12);
  });
});
