import { describe, expect, it } from "vitest";
import { IMMEDIATE_PADDING_CELL_LIMIT, planImmediatePadding } from "../src/client/immediate-padding-plan";

describe("bounded first-visible native terrain", () => {
  it("clips the actual four missing B chunks to 5250 visible cells, with no full-chunk allocation", () => {
    const scale = .81, screen = { width: 1600, height: 2748 };
    const position = { x: 800 - 192.99 * 8 * scale, y: 1374 + 128 * 8 * scale };
    const plan = planImmediatePadding(position, scale, screen, [[3, -6], [4, -6], [3, 1], [4, 1]], new Set(), IMMEDIATE_PADDING_CELL_LIMIT, 8, 64);
    expect(plan.cells).toBe(5250); expect(plan.complete).toBe(true); expect(plan.regions).toHaveLength(4);
    expect(plan.regions[0]!.cells[0]).toEqual({ x: 192, y: -341 });
    expect(new Set(plan.regions.flatMap(region => region.cells).map(cell => `${cell.x},${cell.y}`)).size).toBe(plan.cells);
  });
  it("never exceeds its remaining per-frame/retained cap and avoids duplicate existing native tiles", () => {
    const covered = new Set(["0,0", "1,0"]);
    const plan = planImmediatePadding({ x: 0, y: 0 }, 1, { width: 64, height: 64 }, [[0, 0]], covered, 3, 8, 8);
    expect(plan).toMatchObject({ cells: 3, complete: false });
    expect(plan.regions[0]!.cells).toEqual([{ x: 2, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 }]);
    const zero = planImmediatePadding({ x: 0, y: 0 }, 1, { width: 64, height: 64 }, [[0, 0]], covered, 0, 8, 8);
    expect(zero).toEqual({ regions: [], cells: 0, complete: false });
  });
  it("rejects invalid/unbounded dimensions and supports negative coordinates and fractional camera phase", () => {
    expect(() => planImmediatePadding({ x: 0, y: 0 }, 0, { width: 64, height: 64 }, [], new Set(), 1, 8, 64)).toThrow();
    expect(() => planImmediatePadding({ x: 0, y: 0 }, 1, { width: 64, height: 64 }, [], new Set(), IMMEDIATE_PADDING_CELL_LIMIT + 1, 8, 64)).toThrow();
    const plan = planImmediatePadding({ x: 4, y: 4 }, .5, { width: 8, height: 8 }, [[-1, -1], [0, -1], [-1, 0], [0, 0]], new Set(), 4, 8, 8);
    expect(plan.cells).toBe(4); expect(plan.complete).toBe(true);
    expect(plan.regions.flatMap(region => region.cells)).toEqual([{ x: -1, y: -1 }, { x: 0, y: -1 }, { x: -1, y: 0 }, { x: 0, y: 0 }]);
  });
});
