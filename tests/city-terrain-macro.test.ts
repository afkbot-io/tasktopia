import { describe, expect, it } from "vitest";
import {
  BLOCK_V1_CITY_PRESENTATION,
  auditCityTerrainPlan,
  compileCityTerrain,
  reconstructCityTerrain,
  type CityTerrainCell,
} from "../src/shared/city-terrain-macro.js";

function rectangle(
  minX: number,
  minY: number,
  width: number,
  height: number,
  terrain: CityTerrainCell["terrain"] = "GRASS",
): CityTerrainCell[] {
  return Array.from({ length: width * height }, (_, index) => ({
    x: minX + index % width,
    y: minY + Math.floor(index / width),
    terrain,
  }));
}

describe("block-v1 CITY terrain presentation", () => {
  it("keeps pixel scale in a versioned presentation profile", () => {
    expect(BLOCK_V1_CITY_PRESENTATION).toEqual({
      version: "block-v1-city-v1",
      logicalCellPx: 4,
      terrainMacroCells: 4,
      terrainMacroPx: 16,
    });
    expect(BLOCK_V1_CITY_PRESENTATION.logicalCellPx * BLOCK_V1_CITY_PRESENTATION.terrainMacroCells)
      .toBe(BLOCK_V1_CITY_PRESENTATION.terrainMacroPx);
  });

  it("compiles a homogeneous aligned 4x4 region into one macro", () => {
    const plan = compileCityTerrain(rectangle(0, 0, 4, 4), { seed: "test-world" });

    expect(plan.macros).toHaveLength(1);
    expect(plan.macros[0]).toMatchObject({ x: 0, y: 0, terrain: "GRASS", sizeCells: 4 });
    expect(plan.details).toHaveLength(0);
    expect(reconstructCityTerrain(plan)).toEqual(rectangle(0, 0, 4, 4));
  });

  it("preserves mixed terrain as exact detail cells", () => {
    const cells = rectangle(0, 0, 4, 4);
    cells[5] = { ...cells[5], terrain: "SHALLOW_WATER" };

    const plan = compileCityTerrain(cells, { seed: "coast" });

    expect(plan.macros).toHaveLength(0);
    expect(plan.details).toHaveLength(16);
    expect(reconstructCityTerrain(plan)).toEqual(cells);
  });

  it("preserves incomplete edges and negative coordinates", () => {
    const fullNegativeMacro = rectangle(-4, -4, 4, 4, "FOREST");
    const incompleteEdge = rectangle(0, 0, 3, 4, "SAND");
    const cells = [...incompleteEdge, ...fullNegativeMacro].reverse();

    const plan = compileCityTerrain(cells, { seed: "negative" });

    expect(plan.macros).toHaveLength(1);
    expect(plan.macros[0]).toMatchObject({ x: -4, y: -4, terrain: "FOREST" });
    expect(plan.details).toHaveLength(12);
    expect(reconstructCityTerrain(plan)).toEqual([...fullNegativeMacro, ...incompleteEdge]);
  });

  it("is byte-stable regardless of input order", () => {
    const cells = [...rectangle(0, 0, 4, 4), ...rectangle(4, 0, 4, 4, "MEADOW")];
    const forward = compileCityTerrain(cells, { seed: "stable" });
    const reverse = compileCityTerrain([...cells].reverse(), { seed: "stable" });

    expect(JSON.stringify(reverse)).toBe(JSON.stringify(forward));
  });

  it("deduplicates identical cells and rejects conflicting duplicates", () => {
    const cell: CityTerrainCell = { x: 2, y: 3, terrain: "STONE" };
    expect(reconstructCityTerrain(compileCityTerrain([cell, cell], { seed: "duplicates" })))
      .toEqual([cell]);
    expect(() => compileCityTerrain([cell, { ...cell, terrain: "GRASS" }], { seed: "duplicates" }))
      .toThrow(/conflicting terrain cells at 2,3/i);
  });

  it("meets the homogeneous 64x64 command-count budget", () => {
    const plan = compileCityTerrain(rectangle(0, 0, 64, 64), { seed: "budget" });

    expect(plan.macros).toHaveLength(256);
    expect(plan.details).toHaveLength(0);
    expect(plan.macros.length + plan.details.length).toBe(4096 / 16);
  });

  it("audits exact topology and reports command reduction", () => {
    const cells = rectangle(0, 0, 8, 8, "DEEP_WATER");
    const plan = compileCityTerrain(cells, { seed: "audit" });

    expect(auditCityTerrainPlan(cells, plan)).toEqual({
      exact: true,
      sourceCells: 64,
      reconstructedCells: 64,
      macroCommands: 4,
      detailCommands: 0,
      commandReduction: 16,
    });
    expect(auditCityTerrainPlan(cells.slice(1), plan).exact).toBe(false);
  });
});
