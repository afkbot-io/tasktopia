import { describe, expect, it } from "vitest";
import { airportCompoundCells, cityAirportVisualLayout } from "../src/shared/city-airport-layout";
import type { Cell, WorldFeatureDto } from "../src/shared/contracts";

function perimeter(origin: Cell, width: number, height: number): Cell[] {
  const cells: Cell[] = [];
  for (let x = origin.x; x < origin.x + width; x += 1) {
    cells.push({ x, y: origin.y }, { x, y: origin.y + height - 1 });
  }
  for (let y = origin.y + 1; y < origin.y + height - 1; y += 1) {
    cells.push({ x: origin.x, y }, { x: origin.x + width - 1, y });
  }
  return cells;
}

function airport(): WorldFeatureDto {
  return {
    id: "airport-alpha", cityId: "city", districtId: null, parentFeatureId: null,
    kind: "AIRPORT", assetKind: "AREA", assetKey: "city-airport-terminal-3",
    origin: { x: 10, y: 20 }, footprint: perimeter({ x: 10, y: 20 }, 44, 22),
    orientation: "E", accessPath: [{ x: 54, y: 31 }, { x: 55, y: 31 }], developmentStage: 5,
  };
}

describe("city airport visual layout", () => {
  it("expands the persisted perimeter into the complete secured compound", () => {
    const cells = airportCompoundCells(airport());
    expect(cells).toHaveLength(44 * 22);
    expect(cells).toContainEqual({ x: 31, y: 30 });
  });

  it("uses tiled pavement, a construction-family fence and proportional non-overlapping buildings", () => {
    const layout = cityAirportVisualLayout(airport());
    expect(layout.surfaceTiles).toHaveLength(44 * 22);
    expect(layout.surfaceTiles.some((tile) => tile.role === "APRON")).toBe(true);
    expect(layout.surfaceTiles.some((tile) => tile.role === "RUNWAY")).toBe(true);
    expect(layout.fenceTiles.filter((tile) => tile.key === "construction-gate")).toHaveLength(2);
    expect(layout.buildings.map((building) => building.role)).toEqual([
      "TERMINAL", "CONTROL", "HANGAR", "FIRE", "SERVICE", "FUEL",
    ]);
    expect(layout.buildings.find((building) => building.role === "HANGAR")!.displayWidth).toBeGreaterThanOrEqual(88);
    expect(layout.buildings.every((building) => building.bottom <= layout.runway.top - 4)).toBe(true);
    for (const [index, building] of layout.buildings.entries()) {
      for (const other of layout.buildings.slice(index + 1)) {
        const separated = building.right <= other.left || other.right <= building.left
          || building.bottom <= other.top || other.bottom <= building.top;
        expect(separated, `${building.role} overlaps ${other.role}`).toBe(true);
      }
    }
  });
});
