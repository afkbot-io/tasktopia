import { describe, expect, it } from "vitest";
import type { Cell, RoadCellDto } from "../src/shared/contracts";
import { ROAD_WIDTH } from "../src/server/world/city-generation";
import { roadBandRole, roadClassSupportsVehicle, roadMarkingAxis } from "../src/shared/road-profile";
import { bridgeComponentsWithoutTwoLandPortals, centeredRoadOffsets, roadCorridorBlockers, stampRoadCorridor } from "../src/server/world/road-geometry";
import { cellKey, orthogonalPath } from "../src/server/world/grid";

function keys(cells: Cell[]): Set<string> {
  return new Set(cells.map(cellKey));
}

describe("canonical road geometry", () => {
  it("detects a multi-lane bridge cap with only one land portal", () => {
    const road = (x: number, y: number, structure: RoadCellDto["structure"]): RoadCellDto => ({
      x, y, structure, roadClass: "COLLECTOR", mask: 0,
    });
    const westBank = [-1, 0, 1].map((y) => road(0, y, "ROAD"));
    const bridge = [1, 2, 3].flatMap((x) => [-1, 0, 1].map((y) => road(x, y, "BRIDGE")));

    expect(bridgeComponentsWithoutTwoLandPortals([...westBank, ...bridge])).toEqual([new Set(bridge.map(cellKey))]);
    const eastBank = [-1, 0, 1].map((y) => road(4, y, "ROAD"));
    expect(bridgeComponentsWithoutTwoLandPortals([...westBank, ...bridge, ...eastBank])).toEqual([]);
  });

  it("uses two travel cells locally and a marked median in larger streets", () => {
    expect(ROAD_WIDTH.LOCAL).toBe(3);
    expect(ROAD_WIDTH.COLLECTOR).toBe(7);
    expect(ROAD_WIDTH.ARTERIAL).toBe(7);
    expect(ROAD_WIDTH.HIGHWAY).toBe(7);
    expect(centeredRoadOffsets(2)).toEqual([-1, 0]);
    expect(centeredRoadOffsets(3)).toEqual([-1, 0, 1]);
    expect(centeredRoadOffsets(5)).toEqual([-2, -1, 0, 1, 2]);
    expect(centeredRoadOffsets(7)).toEqual([-3, -2, -1, 0, 1, 2, 3]);
  });

  it("keeps full-size buses on separated seven-cell road classes", () => {
    expect(roadClassSupportsVehicle("LOCAL", "CAR")).toBe(true);
    expect(roadClassSupportsVehicle("LOCAL", "BUS")).toBe(false);
    expect(roadClassSupportsVehicle("COLLECTOR", "BUS")).toBe(true);
    expect(roadClassSupportsVehicle("ARTERIAL", "BUS")).toBe(true);
  });

  it("stamps a complete seven-cell collector cross-section", () => {
    const road = keys(stampRoadCorridor(orthogonalPath({ x: -2, y: 0 }, { x: 2, y: 0 }, true), "COLLECTOR", ROAD_WIDTH));
    for (let x = -2; x <= 2; x += 1) for (let y = -3; y <= 3; y += 1) expect(road.has(`${x},${y}`)).toBe(true);
    expect(road.size).toBe(35);
  });

  it("classifies shoulders, travel cells and median clearance from one seven-cell band", () => {
    const cells = stampRoadCorridor(orthogonalPath({ x: -4, y: 0 }, { x: 4, y: 0 }, true), "COLLECTOR", ROAD_WIDTH);
    const graph = new Map(cells.map((cell) => [`${cell.x},${cell.y}`, { ...cell, roadClass: "COLLECTOR" as const }]));
    expect(roadBandRole(graph, { x: 0, y: -3 })).toEqual({ kind: "SHOULDER", axis: "H" });
    expect(roadBandRole(graph, { x: 0, y: -2 })).toEqual({ kind: "TRAVEL", axis: "H", dx: -1, dy: 0 });
    expect(roadBandRole(graph, { x: 0, y: -1 })).toEqual({ kind: "MEDIAN", axis: "H" });
    expect(roadBandRole(graph, { x: 0, y: 0 })).toEqual({ kind: "MEDIAN", axis: "H" });
    expect(roadBandRole(graph, { x: 0, y: 1 })).toEqual({ kind: "MEDIAN", axis: "H" });
    expect(roadBandRole(graph, { x: 0, y: 2 })).toEqual({ kind: "TRAVEL", axis: "H", dx: 1, dy: 0 });
    expect(roadBandRole(graph, { x: 0, y: 3 })).toEqual({ kind: "SHOULDER", axis: "H" });
    expect([-3, -2, -1, 0, 1, 2, 3].filter((y) => roadMarkingAxis(graph, { x: 0, y })).length).toBe(1);
    expect(roadMarkingAxis(graph, { x: 0, y: 0 })).toBe("H");
  });

  it("does not multiply lane markings where a narrower road class joins a main road", () => {
    const graph = new Map<string, Cell & { roadClass: "LOCAL" | "COLLECTOR" }>();
    for (let x = -6; x <= 6; x += 1) {
      for (let y = -3; y <= 3; y += 1) graph.set(`${x},${y}`, { x, y, roadClass: "COLLECTOR" });
    }
    for (let y = 4; y <= 9; y += 1) {
      for (let x = -1; x <= 1; x += 1) graph.set(`${x},${y}`, { x, y, roadClass: "LOCAL" });
    }

    expect([-3, -2, -1, 0, 1, 2, 3].map((y) => roadBandRole(graph, { x: 0, y, roadClass: "COLLECTOR" }))).toEqual([
      { kind: "SHOULDER", axis: "H" },
      { kind: "TRAVEL", axis: "H", dx: -1, dy: 0 },
      { kind: "MEDIAN", axis: "H" },
      { kind: "MEDIAN", axis: "H" },
      { kind: "MEDIAN", axis: "H" },
      { kind: "TRAVEL", axis: "H", dx: 1, dy: 0 },
      { kind: "SHOULDER", axis: "H" },
    ]);
    expect(roadBandRole(graph, { x: -1, y: 6, roadClass: "LOCAL" })).toEqual({
      kind: "TRAVEL", axis: "V", dx: 0, dy: 1,
    });
  });

  it("keeps every travel lane connected through a three-to-seven-cell T junction", () => {
    const graph = new Map<string, Cell & { roadClass: "LOCAL" | "COLLECTOR" }>();
    for (let x = -10; x <= 10; x += 1) {
      for (let y = -3; y <= 3; y += 1) graph.set(`${x},${y}`, { x, y, roadClass: "COLLECTOR" });
    }
    for (let y = -10; y <= -4; y += 1) {
      for (let x = -1; x <= 1; x += 1) graph.set(`${x},${y}`, { x, y, roadClass: "LOCAL" });
    }

    const travelCells = [...graph.values()].filter((cell) => (
      cell.x > -10 && cell.x < 10 && cell.y > -10 && roadBandRole(graph, cell).kind === "TRAVEL"
    ));
    expect(travelCells.length).toBeGreaterThan(0);
    for (const cell of travelCells) {
      const role = roadBandRole(graph, cell);
      if (role.kind !== "TRAVEL") continue;
      const next = { x: cell.x + role.dx, y: cell.y + role.dy };
      expect(graph.has(cellKey(next)), `lane at ${cellKey(cell)} exits asphalt toward ${cellKey(next)}`).toBe(true);
    }
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

  it("rejects a clipped cross-section instead of publishing a narrow road", () => {
    const path = orthogonalPath({ x: -2, y: 0 }, { x: 2, y: 0 }, true);
    const blocked = new Set(["0,-1"]);
    expect(roadCorridorBlockers(path, "LOCAL", ROAD_WIDTH, blocked)).toEqual([{ x: 0, y: -1 }]);
    expect(roadCorridorBlockers(path, "LOCAL", ROAD_WIDTH, blocked, new Set(["0,-1"]))).toEqual([]);
  });
});
