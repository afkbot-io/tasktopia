import { describe, expect, it } from "vitest";
import { greenAreaDecorStage, greenAreaDevelopmentStage, greenAreaPathCells, greenAreaSurfaceRole } from "../src/shared/green-area";
import { taskParkDecorLayout } from "../src/shared/task-park";

function rectangle(width: number, height: number) {
  return Array.from({ length: width * height }, (_, index) => ({ x: index % width, y: Math.floor(index / width) }));
}

describe("green area paths", () => {
  it("composes a numbered park progressively and deterministically", () => {
    const footprint = Array.from({ length: 20 * 10 }, (_, index) => ({ x: index % 20, y: Math.floor(index / 20) }));
    expect(taskParkDecorLayout(footprint, 1, "urban-formal", 81)).toEqual([]);
    expect(taskParkDecorLayout(footprint, 2, "urban-formal", 81)).toEqual([]);
    const planted = taskParkDecorLayout(footprint, 3, "urban-formal", 81);
    const furnished = taskParkDecorLayout(footprint, 4, "urban-formal", 81);
    const complete = taskParkDecorLayout(footprint, 5, "urban-formal", 81);
    expect(planted.length).toBeGreaterThanOrEqual(4);
    expect(furnished.length).toBeGreaterThan(planted.length);
    expect(complete.some((placement) => placement.kind === "fountain-large")).toBe(true);
    expect(taskParkDecorLayout(footprint, 5, "urban-formal", 81)).toEqual(complete);
  });
  it("uses the same perimeter and central cross for rendering and navigation", () => {
    const paths = new Set(greenAreaPathCells(rectangle(12, 10), "urban-park").map((cell) => `${cell.x},${cell.y}`));
    expect(paths.has("0,5")).toBe(true);
    expect(paths.has("5,5")).toBe(true);
    expect(paths.has("8,4")).toBe(true);
    expect(paths.has("2,2")).toBe(false);
    expect(paths.has("8,7")).toBe(false);
  });

  it("builds a two-cell formal promenade around four symmetrical garden quarters", () => {
    const paths = new Set(greenAreaPathCells(rectangle(18, 10), "urban-formal").map((cell) => `${cell.x},${cell.y}`));
    for (let y = 0; y < 10; y += 1) {
      expect(paths.has(`8,${y}`)).toBe(true);
      expect(paths.has(`9,${y}`)).toBe(true);
    }
    for (let x = 0; x < 18; x += 1) {
      expect(paths.has(`${x},4`)).toBe(true);
      expect(paths.has(`${x},5`)).toBe(true);
    }
    expect(paths.has("3,2")).toBe(false);
    expect(paths.has("14,7")).toBe(false);
  });

  it("keeps compact parks navigable through their perimeter without inventing a cross", () => {
    const paths = new Set(greenAreaPathCells(rectangle(5, 4)).map((cell) => `${cell.x},${cell.y}`));
    expect(paths.has("0,1")).toBe(true);
    expect(paths.has("2,1")).toBe(false);
  });

  it("builds a park through five deterministic visual stages", () => {
    const footprint = rectangle(18, 10);
    expect(greenAreaSurfaceRole(footprint, { x: 8, y: 4 }, 1, "urban-formal")).toBe("EARTH");
    expect(greenAreaSurfaceRole(footprint, { x: 8, y: 4 }, 2, "urban-formal")).toBe("PATH");
    expect(greenAreaSurfaceRole(footprint, { x: 2, y: 2 }, 2, "urban-formal")).toBe("EARTH");
    expect(greenAreaSurfaceRole(footprint, { x: 2, y: 2 }, 3, "urban-formal")).toBe("MEADOW");
    expect(greenAreaSurfaceRole(footprint, { x: 0, y: 3 }, 5, "urban-formal")).toBe("BOUNDARY");
    expect(greenAreaDecorStage("tree-oak")).toBe(3);
    expect(greenAreaDecorStage("flower-bed-horizontal")).toBe(3);
    expect(greenAreaDecorStage("park-bench-double")).toBe(4);
    expect(greenAreaDecorStage("fountain-large")).toBe(5);
  });

  it("advances a district park with the furthest task lifecycle stage", () => {
    expect(greenAreaDevelopmentStage([])).toBe(1);
    expect(greenAreaDevelopmentStage(["PLANNING"])).toBe(1);
    expect(greenAreaDevelopmentStage(["STARTED", "PLANNING"])).toBe(2);
    expect(greenAreaDevelopmentStage(["IN_PROGRESS", "STARTED"])).toBe(3);
    expect(greenAreaDevelopmentStage(["TESTING", "PLANNING"])).toBe(4);
    expect(greenAreaDevelopmentStage(["COMPLETED", "IN_PROGRESS"])).toBe(5);
  });
});
