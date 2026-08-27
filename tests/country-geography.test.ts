import { describe, expect, it } from "vitest";
import { buildCountryGeography, countryGridNeighbors, snapCountryCitiesToLand } from "../src/server/world/country-geography";

describe("country geography LOD", () => {
  const macroCells = [
    { q: 0, r: 0, id: "country:0:0", terrain: "grass" as const, ownerCountryId: "country" },
    { q: 1, r: 0, id: "country:1:0", terrain: "mountain" as const, ownerCountryId: "country" },
    { q: 0, r: 1, id: "country:0:1", terrain: "forest" as const, ownerCountryId: "country" },
    { q: 1, r: 1, id: "country:1:1", terrain: "river" as const, ownerCountryId: "country" },
    { q: 2, r: 0, id: "neighbor:2:0", terrain: "forest" as const, ownerCountryId: "neighbor" },
    { q: -1, r: 0, id: "ocean:-1:0", terrain: "deep_water" as const, ownerCountryId: null },
  ];

  it("expands one deterministic macro geography into bounded square meso cells", () => {
    const first = buildCountryGeography({ countryId: "country", seed: 42, macroCells });
    const second = buildCountryGeography({ countryId: "country", seed: 42, macroCells });

    expect(second).toEqual(first);
    expect(first.grid).toEqual({ columns: 36, rows: 22, cellSize: 4, topology: "SQUARE_4" });
    expect(first.cells).toHaveLength(36 * 22);
    expect(first.cells.every((cell) => cell.x % 4 === 0 && cell.y % 4 === 0)).toBe(true);
    expect(first.cells.filter((cell) => cell.macroCellId === "country:1:0" && ["mountain", "hill", "stone"].includes(cell.terrain)).length).toBeGreaterThan(4);
    expect(first.cells.some((cell) => cell.terrain === "deep_water")).toBe(true);
    expect(first.cells.some((cell) => cell.terrain === "coast")).toBe(true);
  });

  it("keeps adjacent foreign land instead of synthesizing an ocean moat", () => {
    const geography = buildCountryGeography({ countryId: "country", seed: 42, macroCells });
    const neighbor = geography.cells.filter((cell) => cell.ownerCountryId === "neighbor");
    expect(neighbor.length).toBeGreaterThan(0);
    expect(neighbor.every((cell) => cell.land)).toBe(true);
    expect(neighbor.every((cell) => !["deep_water", "shallow_water", "coast"].includes(cell.terrain))).toBe(true);
    expect(geography.cells.some((cell) => cell.terrain === "unknown")).toBe(true);
  });

  it("uses the same four-neighbour square topology as the city world", () => {
    expect(countryGridNeighbors({ column: 4, row: 8 })).toEqual([
      { column: 5, row: 8 },
      { column: 3, row: 8 },
      { column: 4, row: 9 },
      { column: 4, row: 7 },
    ]);
  });

  it("keeps macro terrain recognizable without requiring cell-for-cell identity", () => {
    const geography = buildCountryGeography({ countryId: "country", seed: 777, macroCells });
    const mountainFamily = geography.cells.filter((cell) => cell.macroCellId === "country:1:0" && cell.land);
    const forestFamily = geography.cells.filter((cell) => cell.macroCellId === "country:0:1" && cell.land);

    expect(mountainFamily.filter((cell) => ["mountain", "hill", "stone"].includes(cell.terrain)).length / mountainFamily.length).toBeGreaterThan(.7);
    expect(forestFamily.filter((cell) => ["forest", "grass", "meadow"].includes(cell.terrain)).length / forestFamily.length).toBeGreaterThan(.8);
  });

  it("grounds city miniatures on distinct dry square cells", () => {
    const geography = buildCountryGeography({ countryId: "country", seed: 42, macroCells });
    const snapped = snapCountryCitiesToLand(geography, [
      { id: "coastal", atlasCenter: { x: 0, y: 0 } },
      { id: "neighbor", atlasCenter: { x: 0, y: 0 } },
    ]);
    const points = [...snapped.values()];
    expect(new Set(points.map((point) => `${point.x}:${point.y}`))).toHaveLength(2);
    for (const point of points) {
      const cell = geography.cells.find((candidate) => candidate.x + 2 === point.x && candidate.y + 2 === point.y);
      expect(cell?.land).toBe(true);
      expect(cell?.terrain).not.toBe("coast");
    }
  });

  it("does not compress a continent when its planet cells are far from zero", () => {
    const base = buildCountryGeography({ countryId: "country", seed: 42, macroCells });
    const translated = buildCountryGeography({
      countryId: "country",
      seed: 42,
      macroCells: macroCells.map((cell) => ({ ...cell, q: cell.q + 47, r: cell.r + 61 })),
    });
    expect(translated.cells.filter((cell) => cell.land)).toHaveLength(base.cells.filter((cell) => cell.land).length);
    expect(translated.cells.filter((cell) => cell.land).length).toBeGreaterThan(250);
  });
});
