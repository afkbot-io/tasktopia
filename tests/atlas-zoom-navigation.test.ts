import { describe, expect, it } from "vitest";
import {
  atlasTargetCoverage,
  continuousAtlasZoom,
  mapAtlasFocusPoint,
} from "../src/client/atlas-zoom-navigation";

describe("atlas zoom level navigation", () => {
  it("uses wheel magnitude for continuous zoom instead of fixed zoom steps", () => {
    const trackpad = continuousAtlasZoom(1, -24, { min: 0.8, max: 4 });
    const wheel = continuousAtlasZoom(1, -120, { min: 0.8, max: 4 });

    expect(trackpad).toBeGreaterThan(1);
    expect(wheel).toBeGreaterThan(trackpad);
    expect(continuousAtlasZoom(3.98, -120, { min: 0.8, max: 4 })).toBe(4);
    expect(continuousAtlasZoom(0.81, 120, { min: 0.8, max: 4 })).toBe(0.8);
  });

  it("measures when the focused atlas target nearly fills the viewport", () => {
    expect(atlasTargetCoverage(
      { minX: 100, minY: 80, maxX: 900, maxY: 620 },
      { minX: 0, minY: 0, maxX: 1_000, maxY: 700 },
    )).toBeCloseTo(0.8);
    expect(atlasTargetCoverage(
      { minX: -100, minY: -100, maxX: 1_100, maxY: 800 },
      { minX: 0, minY: 0, maxX: 1_000, maxY: 700 },
    )).toBe(1);
  });

  it("maps the focused atlas point into the same normalized city source point", () => {
    expect(mapAtlasFocusPoint(
      { x: 75, y: 40 },
      { minX: 50, minY: 20, maxX: 149, maxY: 69 },
      { minX: -200, minY: 100, maxX: 199, maxY: 299 },
    )).toEqual({ x: -100, y: 180 });
    expect(mapAtlasFocusPoint(
      { x: 150, y: 70 },
      { minX: 50, minY: 20, maxX: 149, maxY: 69 },
      { minX: -200, minY: 100, maxX: 199, maxY: 299 },
    )).toEqual({ x: 199, y: 299 });
  });
});
