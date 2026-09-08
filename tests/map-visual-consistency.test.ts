import { describe, expect, it } from "vitest";
import { pixelPlanetRows, blockPlaqueText } from "../src/client/map-visual-consistency";
import { greenAreaSurfaceLayout } from "../src/shared/green-area";

describe("map visual consistency", () => {
  it("builds a circular planet from complete square-grid rows", () => {
    const rows = pixelPlanetRows({ minX: 0, minY: 0, maxX: 160, maxY: 160 }, 8);
    expect(rows.length).toBe(20);
    expect(rows[0]!.width).toBeLessThan(rows[10]!.width);
    for (const row of rows) for (const value of [row.x, row.y, row.width, row.height]) expect(value % 8).toBe(0);
    expect(rows.map(row => row.width)).toEqual(rows.map(row => row.width).reverse());
  });
  it("uses one count format, including Russian plurals", () => {
    expect([1, 2, 5, 11, 21, 24].map(blockPlaqueText)).toEqual(["1 задача", "2 задачи", "5 задач", "11 задач", "21 задача", "24 задачи"]);
  });
  it("keeps a one-cell task strip planted in every workflow stage", () => {
    const cells = Array.from({ length: 10 }, (_, y) => ({ x: 1, y }));
    for (const stage of [1, 2, 3, 4, 5] as const) {
      expect(greenAreaSurfaceLayout(cells, stage).every(cell => cell.role === "MEADOW" || cell.role === "PATH")).toBe(true);
    }
  });
});
