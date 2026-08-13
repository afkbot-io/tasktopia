import { describe, expect, it } from "vitest";
import type { Cell } from "../src/shared/contracts";
import { ROAD_WIDTH } from "../src/server/world/city-generation";
import { roadBandRole, roadClassSupportsVehicle } from "../src/shared/road-profile";
import { centeredRoadOffsets, roadCorridorBlockers, stampRoadCorridor } from "../src/server/world/road-geometry";
import { cellKey, orthogonalPath } from "../src/server/world/grid";

function keys(cells: Cell[]): Set<string> {
  return new Set(cells.map(cellKey));
}

describe("canonical road geometry", () => {
  it("uses two travel cells locally and a marked median in larger streets", () => {
    expect(ROAD_WIDTH.LOCAL).toBe(2);
    expect(ROAD_WIDTH.COLLECTOR).toBe(3);
    expect(ROAD_WIDTH.ARTERIAL).toBe(3);
    expect(ROAD_WIDTH.HIGHWAY).toBe(3);
    expect(centeredRoadOffsets(2)).toEqual([-1, 0]);
    expect(centeredRoadOffsets(3)).toEqual([-1, 0, 1]);
  });

  it("keeps full-size buses on separated three-cell road classes", () => {
    expect(roadClassSupportsVehicle("LOCAL", "CAR")).toBe(true);
    expect(roadClassSupportsVehicle("LOCAL", "BUS")).toBe(false);
    expect(roadClassSupportsVehicle("COLLECTOR", "BUS")).toBe(true);
    expect(roadClassSupportsVehicle("ARTERIAL", "BUS")).toBe(true);
  });

  it("stamps a complete three-cell collector cross-section", () => {
    const road = keys(stampRoadCorridor(orthogonalPath({ x: -2, y: 0 }, { x: 2, y: 0 }, true), "COLLECTOR", ROAD_WIDTH));
    for (let x = -2; x <= 2; x += 1) for (let y = -1; y <= 1; y += 1) expect(road.has(`${x},${y}`)).toBe(true);
    expect(road.size).toBe(15);
  });

  it("classifies visual and routing roles from the same three-cell band", () => {
    const cells = stampRoadCorridor(orthogonalPath({ x: -4, y: 0 }, { x: 4, y: 0 }, true), "COLLECTOR", ROAD_WIDTH);
    const graph = new Map(cells.map((cell) => [`${cell.x},${cell.y}`, cell]));
    expect(roadBandRole(graph, { x: 0, y: -1 })).toEqual({ kind: "TRAVEL", axis: "H", dx: -1, dy: 0 });
    expect(roadBandRole(graph, { x: 0, y: 0 })).toEqual({ kind: "MEDIAN", axis: "H" });
    expect(roadBandRole(graph, { x: 0, y: 1 })).toEqual({ kind: "TRAVEL", axis: "H", dx: 1, dy: 0 });
  });

  it("does not multiply lane markings where a narrower road class joins a main road", () => {
    const graph = new Map<string, Cell & { roadClass: "LOCAL" | "COLLECTOR" }>();
    for (let x = -6; x <= 6; x += 1) {
      for (let y = -1; y <= 1; y += 1) graph.set(`${x},${y}`, { x, y, roadClass: "COLLECTOR" });
    }
    for (let y = 2; y <= 7; y += 1) {
      for (let x = 0; x <= 1; x += 1) graph.set(`${x},${y}`, { x, y, roadClass: "LOCAL" });
    }

    expect([-1, 0, 1].map((y) => roadBandRole(graph, { x: 0, y, roadClass: "COLLECTOR" }))).toEqual([
      { kind: "TRAVEL", axis: "H", dx: -1, dy: 0 },
      { kind: "MEDIAN", axis: "H" },
      { kind: "TRAVEL", axis: "H", dx: 1, dy: 0 },
    ]);
    expect(roadBandRole(graph, { x: 0, y: 4, roadClass: "LOCAL" })).toEqual({
      kind: "TRAVEL", axis: "V", dx: 0, dy: 1,
    });
  });

  it("stamps every cross-section of a straight local street", () => {
    const road = keys(stampRoadCorridor(orthogonalPath({ x: -3, y: 0 }, { x: 3, y: 0 }, true), "LOCAL", ROAD_WIDTH));
    for (let x = -3; x <= 3; x += 1) for (let y = -1; y <= 0; y += 1) expect(road.has(`${x},${y}`)).toBe(true);
    expect(road.size).toBe(14);
  });

  it("fills the complete corner envelope without an inner curb notch", () => {
    const path = [
      { x: -2, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 0 },
      { x: 0, y: -1 }, { x: 0, y: -2 },
    ];
    const road = keys(stampRoadCorridor(path, "LOCAL", ROAD_WIDTH));
    for (let y = -1; y <= 0; y += 1) for (let x = -1; x <= 0; x += 1) expect(road.has(`${x},${y}`)).toBe(true);
  });

  it("unions full-width crossing arms even when the center already exists", () => {
    const horizontal = keys(stampRoadCorridor(orthogonalPath({ x: -4, y: 0 }, { x: 4, y: 0 }, true), "LOCAL", ROAD_WIDTH));
    const vertical = stampRoadCorridor(orthogonalPath({ x: 0, y: -4 }, { x: 0, y: 4 }, false), "LOCAL", ROAD_WIDTH);
    for (const cell of vertical) horizontal.add(cellKey(cell));
    for (let y = -1; y <= 0; y += 1) for (let x = -1; x <= 0; x += 1) expect(horizontal.has(`${x},${y}`)).toBe(true);
  });

  it("rejects a clipped cross-section instead of publishing a narrow road", () => {
    const path = orthogonalPath({ x: -2, y: 0 }, { x: 2, y: 0 }, true);
    const blocked = new Set(["0,-1"]);
    expect(roadCorridorBlockers(path, "LOCAL", ROAD_WIDTH, blocked)).toEqual([{ x: 0, y: -1 }]);
    expect(roadCorridorBlockers(path, "LOCAL", ROAD_WIDTH, blocked, new Set(["0,-1"]))).toEqual([]);
  });
});
