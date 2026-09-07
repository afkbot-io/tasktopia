import { describe, expect, it } from "vitest";
import { rectangleFootprint } from "../src/server/world/grid";
import { greenAreaPathCells, greenAreaSurfaceLayout } from "../src/shared/green-area";
import { taskParkDecorLayout, taskParkingMarkings } from "../src/shared/task-park";
import { constructionStageLayout } from "../src/shared/construction-stage";

const footprint = rectangleFootprint({ x: 10, y: -4 }, 6, 6);
const key = (cell: { x: number; y: number }) => `${cell.x},${cell.y}`;

describe("compact task-owned area stages", () => {
  it("fills the lake basin only after structural work, keeping one unchanged shore", () => {
    const stages = ([1, 2, 3, 4, 5] as const).map((stage) => greenAreaSurfaceLayout(footprint, stage, "urban-lake"));
    expect(stages.map((cells) => cells.filter((cell) => cell.role === "WATER").length)).toEqual([0, 0, 0, 8, 16]);
    expect(stages[2]!.filter((cell) => cell.role === "BASIN")).toHaveLength(16);
    const shore = stages[4]!.filter((cell) => cell.role === "BOUNDARY").map(key);
    expect(shore).toHaveLength(20);
    for (const cells of stages.slice(1)) {
      expect(cells.filter((cell) => cell.role === "BOUNDARY").map(key)).toEqual(shore);
      expect(cells.filter((cell) => cell.role === "PATH")).toEqual([]);
    }
    expect(greenAreaPathCells(footprint, "urban-lake").map(key)).toEqual(shore);
  });

  it.each([3, 4, 5] as const)("lake stage%s never places a tree or fountain inside the basin", (stage) => {
    const cells = new Map(greenAreaSurfaceLayout(footprint, stage, "urban-lake").map((cell) => [key(cell), cell.role]));
    const decor = taskParkDecorLayout(footprint, stage, "urban-lake", 19);
    for (const placement of decor) {
      expect(placement.kind).toBe("bench-horizontal");
      for (const cell of rectangleFootprint(placement.origin, placement.width, placement.height)) expect(cells.get(key(cell))).toBe("BOUNDARY");
    }
  });

  it("parking has a paved interior and staged native-pixel markings, not park decor", () => {
    for (const stage of [3, 4, 5] as const) {
      const cells = greenAreaSurfaceLayout(footprint, stage, "urban-parking");
      expect(cells.filter((cell) => cell.role === "PARKING")).toHaveLength(16);
      expect(cells.filter((cell) => cell.role === "MEADOW" || cell.role === "WATER")).toEqual([]);
      expect(taskParkDecorLayout(footprint, stage, "urban-parking", 1)).toEqual([]);
    }
    expect(taskParkingMarkings(footprint, 3)).toEqual([]);
    const partial = taskParkingMarkings(footprint, 4);
    const complete = taskParkingMarkings(footprint, 5);
    expect(partial.length).toBeGreaterThan(0);
    expect(partial.length).toBeLessThan(complete.length);
    for (const line of complete) {
      expect([line.x, line.y, line.width, line.height].every(Number.isInteger)).toBe(true);
      expect(Math.min(line.width, line.height)).toBe(1);
      expect(line.x).toBeGreaterThanOrEqual(8);
      expect(line.y).toBeGreaterThanOrEqual(8);
      expect(line.x + line.width).toBeLessThanOrEqual(41);
      expect(line.y + line.height).toBeLessThanOrEqual(40);
    }
  });

  it("area fencing and equipment obey exactly the same five-stage site contract", () => {
    const layouts = [1, 2, 3, 4, 5].map((stage) => constructionStageLayout({ width: 6, height: 6 }, 3, stage));
    expect(layouts[0]!.site).toEqual([]);
    expect(layouts[0]!.details).toEqual([]);
    expect(layouts[1]!.site).toHaveLength(36);
    expect(layouts[1]!.details.some((detail) => detail.key === "compact-construction-crane")).toBe(true);
    for (const layout of layouts.slice(1, 4)) expect(layout.rearFence).toEqual(layouts[0]!.rearFence);
    expect(layouts[4]!.frontFence).toEqual([]);
  });

  it("handles absent and undersized sites without negative pixel geometry", () => {
    expect(greenAreaSurfaceLayout([], 5, "urban-lake")).toEqual([]);
    expect(taskParkingMarkings([], 5)).toEqual([]);
    expect(taskParkingMarkings([{ x: 0, y: 0 }], 5)).toEqual([]);
  });
});
