import { describe, expect, it } from "vitest";
import { fitCountryAtlasBoundsToAspect } from "../src/shared/country-atlas-viewport";

describe("country atlas viewport", () => {
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
});
