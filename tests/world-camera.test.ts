import { describe, expect, it } from "vitest";
import type { CityDto } from "../src/shared/contracts";
import {
  chunkRangeForViewport,
  clampCameraPosition,
  countryViewBounds,
  fitCameraScale,
  minimumCameraScale,
} from "../src/client/world-camera";

function city(bounds: CityDto["bounds"]): CityDto {
  return {
    id: crypto.randomUUID(), name: "Test", description: "", status: "ACTIVE",
    center: { x: 0, y: 0 }, bounds, styleId: "test", morphology: "BALANCED", createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("world camera geometry", () => {
  it("adds a generous natural frame around all published cities", () => {
    expect(countryViewBounds([
      city({ minX: -50, minY: -40, maxX: 49, maxY: 59 }),
      city({ minX: 250, minY: 120, maxX: 349, maxY: 219 }),
    ], 100)).toEqual({ minX: -150, minY: -140, maxX: 449, maxY: 319 });
  });

  it("loads the viewport plus three quarters of a viewport on every side", () => {
    const range = chunkRangeForViewport(
      { x: 720, y: 450 }, 0.8, { width: 1440, height: 900 },
      { minX: -500, minY: -500, maxX: 499, maxY: 499 }, 8, 64,
    );
    expect(range.maxChunkX - range.minChunkX + 1).toBeGreaterThanOrEqual(8);
    expect(range.maxChunkY - range.minChunkY + 1).toBeGreaterThanOrEqual(5);
  });

  it("clamps pan and raises the minimum zoom when the country is smaller than the screen", () => {
    const bounds = { minX: -50, minY: -30, maxX: 49, maxY: 29 };
    const screen = { width: 1200, height: 800 };
    const scale = minimumCameraScale(screen, bounds, 8);
    expect(scale).toBeGreaterThanOrEqual(1200 / 800);
    const clamped = clampCameraPosition({ x: 100_000, y: -100_000 }, scale, screen, bounds, 8);
    expect(clamped.x).toBeLessThanOrEqual(-bounds.minX * 8 * scale);
    expect(clamped.y).toBeGreaterThanOrEqual(screen.height - (bounds.maxY + 1) * 8 * scale);
  });

  it("fits a tall expanded city while preserving the preferred zoom for compact cities", () => {
    const screen = { width: 1440, height: 835 };
    expect(fitCameraScale(screen, { minX: 0, minY: 0, maxX: 59, maxY: 49 }, 8)).toBe(1.55);
    const tallScale = fitCameraScale(screen, { minX: 0, minY: 0, maxX: 79, maxY: 109 }, 8);
    expect(tallScale).toBeLessThan(1);
    expect(110 * 8 * tallScale).toBeLessThanOrEqual(screen.height - 96);
  });
});
