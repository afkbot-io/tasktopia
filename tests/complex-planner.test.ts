import { describe, expect, it } from "vitest";
import { organicComplexLotTarget, planComplex } from "../src/server/world/complex-planner";
import { ROAD_WIDTH } from "../src/server/world/city-generation";
import { cellKey, connected, rectangleFootprint } from "../src/server/world/grid";
import { stampRoadCorridor } from "../src/server/world/road-geometry";

const BASE = {
  districtId: "district",
  complexIndex: 0,
  archetype: "NEW_BUILD" as const,
  seed: 42,
};

function corridors(streets: { x: number; y: number }[][]): Set<string> {
  const keys = new Set<string>();
  for (const segment of streets) for (const cell of stampRoadCorridor(segment, "LOCAL", ROAD_WIDTH)) keys.add(cellKey(cell));
  return keys;
}

describe("V10 complex planner", () => {
  it("reserves a lot large enough for the building that triggered growth", () => {
    const rect = { minX: 0, minY: 0, maxX: 35, maxY: 23 };
    const plan = planComplex({
      ...BASE,
      archetype: "MIXED_URBAN",
      rect,
      cells: rectangleFootprint({ x: 0, y: 0 }, 36, 24),
      targetLots: 6,
      minimumLot: { width: 6, height: 6 },
    });

    expect(plan.lots.some((lot) => lot.width >= 6 && lot.height >= 6)).toBe(true);
  });

  it("does not turn sprint capacity into a prebuilt empty superblock", () => {
    expect(organicComplexLotTarget(1)).toBe(3);
    expect(organicComplexLotTarget(14)).toBe(6);
    expect(organicComplexLotTarget(26)).toBe(8);
    expect(organicComplexLotTarget(100)).toBe(8);
  });
  it("plans a single-street ROW with lots flush to the sidewalk", () => {
    const rect = { minX: 10, minY: 10, maxX: 41, maxY: 23 };
    const cells = rectangleFootprint({ x: rect.minX, y: rect.minY }, 32, 14);
    const plan = planComplex({ ...BASE, rect, cells, targetLots: 6, shape: "COMPLEX_ROW" });
    expect(plan.shape).toBe("COMPLEX_ROW");
    expect(plan.streets).toHaveLength(1);
    expect(plan.courtyard).toHaveLength(0);
    expect(plan.lots.length).toBeGreaterThanOrEqual(4);
    expect(plan.lots.length).toBeLessThanOrEqual(8);
    const road = corridors(plan.streets);
    const roadTop = Math.min(...[...road].map((key) => Number(key.split(",")[1])));
    for (const lot of plan.lots) {
      expect(lot.frontageSide).toBe("S");
      expect(lot.position).toBe("FRONTAGE");
      expect(lot.sharedAccess).toEqual([]);
      // Building bottom sits directly above the sidewalk row above the corridor.
      expect(lot.origin.y + lot.height).toBe(roadTop - 1);
    }
  });

  it("plans a SLAB as two stacked tiers — the upper street runs behind the lower row", () => {
    const rect = { minX: 10, minY: 10, maxX: 45, maxY: 29 };
    const cells = rectangleFootprint({ x: rect.minX, y: rect.minY }, 36, 20);
    const plan = planComplex({ ...BASE, rect, cells, targetLots: 10, shape: "COMPLEX_SLAB" });
    // Two tier streets plus one perimeter spine that bridges them into one
    // connected road component.
    expect(plan.streets).toHaveLength(3);
    const roadCells = [...corridors(plan.streets)].map((key) => {
      const [x, y] = key.split(",").map(Number);
      return { x: x!, y: y! };
    });
    expect(connected(roadCells)).toBe(true);
    // Every building faces south: each tier has its own street to the south.
    expect(plan.lots.every((lot) => lot.frontageSide === "S")).toBe(true);
    const rows = new Set(plan.lots.map((lot) => lot.origin.y));
    expect(rows.size).toBe(2);
    expect(plan.lots.length).toBeGreaterThanOrEqual(6);
    const road = corridors(plan.streets);
    for (const lot of plan.lots) {
      const entranceY = lot.origin.y + lot.height;
      // Sidewalk cell below the building borders a street corridor cell.
      expect([lot.origin.x, lot.origin.x + lot.width - 1].some((x) =>
        [{ x, y: entranceY + 1 }, { x: x - 1, y: entranceY }, { x: x + 1, y: entranceY }]
          .some((cell) => road.has(cellKey(cell)))
        || [{ x: 1, y: 0 }, { x: -1, y: 0 }].some((d) => road.has(cellKey({ x: lot.origin.x + 1 + d.x, y: entranceY + d.y })))),
      ).toBe(true);
    }
  });

  it("plans a SQUARE with a connected courtyard path attached to the street", () => {
    const rect = { minX: 10, minY: 10, maxX: 41, maxY: 33 };
    const cells = rectangleFootprint({ x: rect.minX, y: rect.minY }, 32, 24);
    const plan = planComplex({ ...BASE, rect, cells, targetLots: 16, shape: "COMPLEX_SQUARE" });
    // Two tier streets plus one perimeter spine; the courtyard is a footpath.
    expect(plan.streets).toHaveLength(3);
    const frontage = plan.lots.filter((lot) => lot.position !== "COURTYARD");
    const courtyard = plan.lots.filter((lot) => lot.position === "COURTYARD");
    expect(frontage.length).toBeGreaterThanOrEqual(6);
    expect(courtyard.length).toBeGreaterThanOrEqual(3);
    expect(plan.courtyard.length).toBeGreaterThan(0);
    expect(connected(plan.courtyard)).toBe(true);
    const road = corridors(plan.streets);
    const adjacentToRoad = (cell: { x: number; y: number }) =>
      [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]
        .some((delta) => road.has(cellKey({ x: cell.x + delta.x, y: cell.y + delta.y })));
    // The courtyard path touches the street network at two distinct points — no dead ends.
    expect(plan.courtyard.filter(adjacentToRoad).length).toBeGreaterThanOrEqual(2);
    for (const lot of courtyard) {
      expect(lot.frontageSide).toBe("S");
      expect(lot.sharedAccess!.length).toBeGreaterThan(0);
      expect(new Set(lot.sharedAccess!.map(cellKey))).toEqual(new Set(plan.courtyard.map(cellKey)));
    }
    for (const lot of frontage) expect(lot.sharedAccess).toEqual([]);
  });

  it("plans an L_SHAPE with a side street and corner lots", () => {
    const rect = { minX: 10, minY: 10, maxX: 41, maxY: 31 };
    const cells = rectangleFootprint({ x: rect.minX, y: rect.minY }, 32, 22);
    const plan = planComplex({ ...BASE, rect, cells, targetLots: 12, shape: "COMPLEX_L_SHAPE" });
    const hasVertical = plan.streets.some((segment) => new Set(segment.map((cell) => cell.x)).size === 1);
    expect(hasVertical).toBe(true);
    expect(plan.lots.some((lot) => lot.position === "CORNER")).toBe(true);
    expect(plan.lots.every((lot) => lot.frontageSide === "S")).toBe(true);
  });

  it("keeps lots inside the block, off the streets and non-overlapping", () => {
    const rect = { minX: 10, minY: 10, maxX: 41, maxY: 33 };
    const cells = rectangleFootprint({ x: rect.minX, y: rect.minY }, 32, 24);
    for (const shape of ["COMPLEX_ROW", "COMPLEX_SLAB", "COMPLEX_SQUARE", "COMPLEX_L_SHAPE", "COMPLEX_COURT", "COMPLEX_POINT"] as const) {
      const plan = planComplex({ ...BASE, rect, cells, targetLots: 12, shape });
      const road = corridors(plan.streets);
      const claimed = new Set<string>();
      const allowed = new Set(cells.map(cellKey));
      for (const lot of plan.lots) {
        for (const cell of rectangleFootprint(lot.origin, lot.width, lot.height)) {
          const key = cellKey(cell);
          expect(allowed.has(key), `${shape}: lot outside district at ${key}`).toBe(true);
          expect(road.has(key), `${shape}: lot on street at ${key}`).toBe(false);
          expect(claimed.has(key), `${shape}: lots overlap at ${key}`).toBe(false);
          claimed.add(key);
        }
      }
    }
  });

  it("is deterministic per seed and varies lot widths across seeds", () => {
    const rect = { minX: 10, minY: 10, maxX: 41, maxY: 23 };
    const cells = rectangleFootprint({ x: rect.minX, y: rect.minY }, 32, 14);
    const first = planComplex({ ...BASE, rect, cells, targetLots: 6, shape: "COMPLEX_ROW" });
    const again = planComplex({ ...BASE, rect, cells, targetLots: 6, shape: "COMPLEX_ROW" });
    expect(again.lots.map((lot) => [lot.origin.x, lot.origin.y, lot.width, lot.height])).toEqual(
      first.lots.map((lot) => [lot.origin.x, lot.origin.y, lot.width, lot.height]),
    );
    const other = planComplex({ ...BASE, seed: 777, rect, cells, targetLots: 6, shape: "COMPLEX_ROW" });
    expect(other.lots.map((lot) => lot.width)).not.toEqual(first.lots.map((lot) => lot.width));
  });

  it("stacks more tiers in tall blocks instead of rotating", () => {
    const tall = { minX: 10, minY: 10, maxX: 41, maxY: 43 };
    const cells = rectangleFootprint({ x: tall.minX, y: tall.minY }, 32, 34);
    const plan = planComplex({ ...BASE, rect: tall, cells, targetLots: 24, shape: "COMPLEX_SLAB" });
    expect(plan.streets.length).toBeGreaterThanOrEqual(3);
    expect(plan.lots.every((lot) => lot.frontageSide === "S")).toBe(true);
  });

  it("assigns complex identity, slot order and facade family", () => {
    const rect = { minX: 10, minY: 10, maxX: 41, maxY: 33 };
    const cells = rectangleFootprint({ x: rect.minX, y: rect.minY }, 32, 24);
    const plan = planComplex({ ...BASE, complexIndex: 2, rect, cells, targetLots: 14, shape: "COMPLEX_SQUARE" });
    expect(plan.lots.every((lot) => lot.groupId === "district:complex:002")).toBe(true);
    expect(plan.lots.every((lot) => lot.layoutVersion === "block-v3")).toBe(true);
    expect(plan.lots.map((lot) => lot.slotIndex)).toEqual(plan.lots.map((_, index) => index));
    expect(plan.lots.every((lot) => lot.slotCount === plan.lots.length)).toBe(true);
    expect(new Set(plan.lots.map((lot) => lot.facadeFamily)).size).toBe(1);
    // Courtyard infill fills after frontage in slot order.
    const positions = plan.lots.map((lot) => lot.position);
    const firstCourtyard = positions.indexOf("COURTYARD");
    expect(positions.slice(0, firstCourtyard).every((position) => position !== "COURTYARD")).toBe(true);
  });
});
