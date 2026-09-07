import { expect, it } from "vitest";
import { publicSpaceRenderStage } from "../src/shared/public-space-stage";
import { greenAreaPathCells, greenAreaSurfaceLayout } from "../src/shared/green-area";
import { taskParkDecorLayout } from "../src/shared/task-park";
it("has three visual phases without renumbering task workflow stages", () => {
  expect([1, 2, 3, 4, 5].map(publicSpaceRenderStage)).toEqual([1, 1, 3, 3, 5]);
});
it("plants narrow residual strips instead of turning every cell into a pavement boundary", () => {
  for (const [width, height] of [[1, 12], [12, 1], [2, 9], [1, 1]]) {
    const cells = Array.from({ length: width! * height! }, (_, i) => ({ x: -8 + i % width!, y: -9 + Math.floor(i / width!) }));
    const earth = greenAreaSurfaceLayout(cells, 1, "urban-park");
    const planting = greenAreaSurfaceLayout(cells, 3, "urban-park");
    const ready = greenAreaSurfaceLayout(cells, 5, "urban-park");
    expect(earth.every(c => c.role === "EARTH")).toBe(true);
    expect(ready.filter(c => c.role === "MEADOW").length).toBeGreaterThanOrEqual(Math.max(1, cells.length - 1));
    expect(planting.filter(c => c.role === "MEADOW").length).toBeLessThan(ready.filter(c => c.role === "MEADOW").length);
    expect(greenAreaPathCells(cells).length).toBeLessThanOrEqual(1);
    expect(taskParkDecorLayout(cells, 5, "urban-park", 12)).toEqual([]);
  }
});
