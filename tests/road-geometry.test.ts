import { describe, expect, it } from "vitest";
import type { Cell } from "../src/shared/contracts";
import { ROAD_WIDTH } from "../src/server/world/city-generation";
import { centeredRoadOffsets, stampRoadCorridor } from "../src/server/world/road-geometry";
import { cellKey, orthogonalPath } from "../src/server/world/grid";

function keys(cells: Cell[]): Set<string> {
  return new Set(cells.map(cellKey));
}

describe("v7 canonical road geometry", () => {
  it("uses a real center cell for three-wide local streets", () => {
    expect(ROAD_WIDTH.LOCAL).toBe(3);
    expect(centeredRoadOffsets(3)).toEqual([-1, 0, 1]);
    expect(centeredRoadOffsets(4)).toEqual([-2, -1, 0, 1]);
  });

  it("stamps every cross-section of a straight local street", () => {
    const road = keys(stampRoadCorridor(orthogonalPath({ x: -3, y: 0 }, { x: 3, y: 0 }, true), "LOCAL", ROAD_WIDTH));
    for (let x = -3; x <= 3; x += 1) for (let y = -1; y <= 1; y += 1) expect(road.has(`${x},${y}`)).toBe(true);
    expect(road.size).toBe(21);
  });

  it("fills the complete corner envelope without an inner curb notch", () => {
    const path = [
      { x: -2, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 0 },
      { x: 0, y: -1 }, { x: 0, y: -2 },
    ];
    const road = keys(stampRoadCorridor(path, "LOCAL", ROAD_WIDTH));
    for (let y = -1; y <= 1; y += 1) for (let x = -1; x <= 1; x += 1) expect(road.has(`${x},${y}`)).toBe(true);
  });

  it("unions full-width crossing arms even when the center already exists", () => {
    const horizontal = keys(stampRoadCorridor(orthogonalPath({ x: -4, y: 0 }, { x: 4, y: 0 }, true), "LOCAL", ROAD_WIDTH));
    const vertical = stampRoadCorridor(orthogonalPath({ x: 0, y: -4 }, { x: 0, y: 4 }, false), "LOCAL", ROAD_WIDTH);
    for (const cell of vertical) horizontal.add(cellKey(cell));
    for (let y = -1; y <= 1; y += 1) for (let x = -1; x <= 1; x += 1) expect(horizontal.has(`${x},${y}`)).toBe(true);
  });
});
