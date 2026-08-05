import { describe, expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { PROP_CATALOG } from "../src/shared/catalog";
import type { Cell, DecorationDto, DistrictDto, TerrainCellDto } from "../src/shared/contracts";
import { cellKey, rectangleFootprint } from "../src/server/world/grid";

type DecorationGenerator = (
  seed: number,
  terrain: TerrainCellDto[],
  blocked: Set<string>,
  surfaces: [],
  districts: DistrictDto[],
  cities: [],
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
});
