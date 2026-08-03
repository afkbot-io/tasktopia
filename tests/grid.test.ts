import { describe, expect, it } from "vitest";
import { aStarPath, connected, floorDiv, floorMod, manhattan, perimeterSegments, rectangleFootprint } from "../src/server/world/grid";

describe("square grid geometry", () => {
  it("creates four-neighbor A* paths", () => {
    const path = aStarPath({ x: -3, y: 2 }, { x: 7, y: -4 }, (cell) => cell.x === 1 && cell.y !== 5 ? 20 : 1);
    expect(path[0]).toEqual({ x: -3, y: 2 });
    expect(path.at(-1)).toEqual({ x: 7, y: -4 });
    for (let index = 1; index < path.length; index += 1) expect(manhattan(path[index - 1]!, path[index]!)).toBe(1);
  });

  it("handles negative chunks with mathematical floor division", () => {
    expect(floorDiv(-1, 64)).toBe(-1);
    expect(floorDiv(-64, 64)).toBe(-1);
    expect(floorDiv(-65, 64)).toBe(-2);
    expect(floorMod(-1, 64)).toBe(63);
  });

  it("creates connected rectangular footprints and external perimeter only", () => {
    const cells = rectangleFootprint({ x: 3, y: 4 }, 4, 3);
    expect(cells).toHaveLength(12);
    expect(connected(cells)).toBe(true);
    expect(perimeterSegments(cells)).toHaveLength(14);
  });
});

