import { describe, expect, it } from "vitest";
import { projectCountryCityMiniature, projectCountryOverview } from "../src/server/world/country-overview";

describe("compact country overview projection", () => {
  it("preserves relative distances with one uniform transform", () => {
    const projected = projectCountryOverview([
      { id: "a", sourceCenter: { x: 0, y: 0 } },
      { id: "b", sourceCenter: { x: 100, y: 0 } },
      { id: "c", sourceCenter: { x: 300, y: 0 } },
    ]);
    const a = projected.centers.get("a")!;
    const b = projected.centers.get("b")!;
    const c = projected.centers.get("c")!;

    expect((b.x - a.x) / (c.x - a.x)).toBeCloseTo(1 / 3, 1);
    expect(a.y).toBe(b.y);
    expect(b.y).toBe(c.y);
    expect(projected.connections).toHaveLength(2);
  });

  it("centers a single city and creates no synthetic connection", () => {
    const projected = projectCountryOverview([{ id: "only", sourceCenter: { x: 812, y: -93 } }]);
    expect(projected.centers.get("only")).toEqual({ x: 72, y: 44 });
    expect(projected.connections).toEqual([]);
  });
});

describe("semantic country city miniature", () => {
  it("preserves an elongated non-rectangular silhouette without copying city objects", () => {
    const miniature = projectCountryCityMiniature({
      sourceBounds: { minX: 0, minY: 0, maxX: 99, maxY: 39 },
      districts: [
        { id: "west", cells: Array.from({ length: 28 }, (_, index) => ({ x: index, y: 14 + index % 3 })) },
        { id: "east", cells: Array.from({ length: 34 }, (_, index) => ({ x: 48 + index, y: 18 + index % 4 })) },
      ],
    });
    expect(miniature.blockSize).toBe(16);
    expect(miniature.columns).toBe(6);
    expect(miniature.rows).toBeLessThan(miniature.columns);
    expect(miniature.districtCodes).toHaveLength(miniature.columns * miniature.rows);
    expect(miniature.coverageCodes).toHaveLength(miniature.columns * miniature.rows);
    expect(miniature.shapeCodes).toHaveLength(miniature.columns * miniature.rows);
    expect(miniature.terrainCodes).toHaveLength(miniature.columns * miniature.rows);
    expect(new Set(miniature.districtCodes)).toEqual(new Set(["0", "1", "2"]));
    expect(miniature.coverageCodes).toMatch(/[1-9a-f]/);
    expect(miniature.shapeCodes).toMatch(/[1-9a-f]/);
    expect(miniature.airportCell.y).toBeGreaterThanOrEqual(0);
  });

  it("creates a bounded fallback core before the first district is published", () => {
    const miniature = projectCountryCityMiniature({
      sourceBounds: { minX: -80, minY: -50, maxX: 79, maxY: 49 },
      districts: [],
    });
    expect(miniature.columns).toBe(10);
    expect(miniature.rows).toBe(7);
    expect(miniature.districtCodes).toMatch(/1/);
  });

  it("projects a production-scale city without overflowing the JavaScript call stack", () => {
    const cells = Array.from({ length: 125_223 }, (_, index) => ({
      x: index % 501,
      y: Math.floor(index / 501),
    }));

    const miniature = projectCountryCityMiniature({
      sourceBounds: { minX: 0, minY: 0, maxX: 500, maxY: 249 },
      districts: [{ id: "large-district", cells }],
    });

    expect(miniature.blockSize).toBe(16);
    expect(miniature.columns).toBe(32);
    expect(miniature.rows).toBe(16);
    expect(miniature.districtCodes).toHaveLength(512);
    expect(miniature.coverageCodes).toHaveLength(512);
    expect(miniature.shapeCodes).toHaveLength(512);
    expect(miniature.terrainCodes).toHaveLength(512);
    expect(new Set(miniature.districtCodes)).toEqual(new Set(["1"]));
  });

  it.each([
    {
      name: "compact",
      cells: Array.from({ length: 64 }, (_, index) => ({ x: index % 8, y: Math.floor(index / 8) })),
      orientation: "square",
    },
    {
      name: "elongated",
      cells: Array.from({ length: 72 }, (_, index) => ({ x: index, y: index % 3 })),
      orientation: "wide",
    },
    {
      name: "irregular",
      cells: Array.from({ length: 80 }, (_, index) => index < 40
        ? { x: index % 8, y: Math.floor(index / 8) }
        : { x: 7 + Math.floor((index - 40) / 5), y: 4 + (index - 40) % 5 }),
      orientation: "wide",
    },
  ])("keeps the $name city form in a deterministic bounded snapshot", ({ cells, orientation }) => {
    const first = projectCountryCityMiniature({
      sourceBounds: { minX: -100, minY: -100, maxX: 99, maxY: 99 },
      districts: [{ id: "district", cells }],
    });
    const second = projectCountryCityMiniature({
      sourceBounds: { minX: -100, minY: -100, maxX: 99, maxY: 99 },
      districts: [{ id: "district", cells }],
    });
    expect(second).toEqual(first);
    expect(first.columns * first.rows).toBeLessThanOrEqual(Math.ceil(200 / 16) ** 2);
    if (orientation === "square") expect(Math.abs(first.columns - first.rows)).toBeLessThanOrEqual(1);
    else expect(first.columns).toBeGreaterThanOrEqual(first.rows);
    expect(first.shapeCodes).toMatch(/[1-9a-f]/);
  });
});
