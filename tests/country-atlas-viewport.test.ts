import { describe, expect, it } from "vitest";
import {
  COUNTRY_ATLAS_BASE_HEIGHT_CELLS,
  COUNTRY_ATLAS_BASE_WIDTH_CELLS,
  fixedCountryAtlasLabelBounds,
  fitCountryAtlasBoundsToAspect,
} from "../src/shared/country-atlas-viewport";

describe("country atlas viewport", () => {
  it("keeps every city label at one map-space size", () => {
    const first = fixedCountryAtlasLabelBounds({ x: 10, y: 20 }, 8);
    const second = fixedCountryAtlasLabelBounds({ x: 200, y: -40 }, 75);
    expect(first.maxX - first.minX + 1).toBe(28);
    expect(first.maxY - first.minY + 1).toBe(6);
    expect(second.maxX - second.minX + 1).toBe(28);
    expect(second.maxY - second.minY + 1).toBe(6);
  });
  it("expands vertically without cropping a wide projected atlas", () => {
    const source = { minX: -20, minY: 0, maxX: 179, maxY: 99 };
    const fitted = fitCountryAtlasBoundsToAspect(source, 16 / 9);
    expect(fitted.minX).toBe(source.minX);
    expect(fitted.maxX).toBe(source.maxX);
    expect(fitted.minY).toBeLessThan(source.minY);
    expect(fitted.maxY).toBeGreaterThan(source.maxY);
    expect((fitted.maxX - fitted.minX + 1) / (fitted.maxY - fitted.minY + 1)).toBeCloseTo(16 / 9, 1);
  });

  it("expands horizontally for an ultrawide host", () => {
    const source = { minX: 0, minY: 0, maxX: 159, maxY: 99 };
    const fitted = fitCountryAtlasBoundsToAspect(source, 2.4);
    expect(fitted.minY).toBe(source.minY);
    expect(fitted.maxY).toBe(source.maxY);
    expect(fitted.minX).toBeLessThan(source.minX);
    expect(fitted.maxX).toBeGreaterThan(source.maxX);
  });

  it("keeps a single compact city at the same base atlas scale as a multi-city country", () => {
    const minimum = { width: COUNTRY_ATLAS_BASE_WIDTH_CELLS, height: COUNTRY_ATLAS_BASE_HEIGHT_CELLS };
    const compact = fitCountryAtlasBoundsToAspect({ minX: 40, minY: 20, maxX: 119, maxY: 89 }, 16 / 9, minimum);
    const broad = fitCountryAtlasBoundsToAspect({ minX: -20, minY: 0, maxX: 279, maxY: 168 }, 16 / 9, minimum);

    expect(compact.maxX - compact.minX + 1).toBe(COUNTRY_ATLAS_BASE_WIDTH_CELLS);
    expect(compact.maxY - compact.minY + 1).toBeCloseTo(169, 0);
    expect(broad.maxX - broad.minX + 1).toBe(COUNTRY_ATLAS_BASE_WIDTH_CELLS);
    expect(broad.maxY - broad.minY + 1).toBe(169);
  });
});
