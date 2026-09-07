import { describe, expect, it } from "vitest";
import type { Cell } from "../src/shared/contracts";
import { ROAD_WIDTH } from "../src/server/world/city-generation";
import { roadBandRole, roadMarkingAxis } from "../src/shared/road-profile";
import { centeredRoadOffsets } from "../src/server/world/road-geometry";
import { cellKey } from "../src/server/world/grid";

describe("canonical road geometry", () => {
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

  it("classifies shoulders, travel cells and median clearance from one seven-cell band", () => {
    const cells = Array.from({ length: 9 * 7 }, (_, i) => ({ x: i % 9 - 4, y: Math.floor(i / 9) - 3 }));
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


});
