import { describe, expect, it } from "vitest";
import {
  chunkRangeForViewport,
  cityDetailFocusBounds,
  clampCameraPosition,
  fitCameraScale,
  minimumCameraScale,
  nextCameraTargetScale,
  pixelPerfectCameraScale,
  progressiveChunkPlan,
  smoothCameraScale,
} from "../src/client/world-camera";

describe("world camera geometry", () => {
  it("opens every city through the same 160 by 100 cell camera territory", () => {
    expect(cityDetailFocusBounds(
      { x: 200, y: 140 },
      { minX: -40, minY: -80, maxX: 520, maxY: 420 },
    )).toEqual({ minX: 120, minY: 90, maxX: 279, maxY: 189 });
    expect(cityDetailFocusBounds(
      { x: 20, y: 20 },
      { minX: 0, minY: 0, maxX: 49, maxY: 39 },
    )).toEqual({ minX: -60, minY: -30, maxX: 99, maxY: 69 });
  });

  it("requests only chunks intersecting the visible viewport", () => {
    const range = chunkRangeForViewport(
      { x: 720, y: 450 }, 0.8, { width: 1440, height: 900 },
      { minX: -500, minY: -500, maxX: 499, maxY: 499 }, 8, 64,
    );
    expect(range.maxChunkX - range.minChunkX + 1).toBeLessThanOrEqual(4);
    expect(range.maxChunkY - range.minChunkY + 1).toBeLessThanOrEqual(4);
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

  it("keeps continuous scales while nearest sampling preserves hard pixel edges", () => {
    expect(pixelPerfectCameraScale(1.25, 0.8)).toBe(1.25);
    expect(pixelPerfectCameraScale(1.55, 0.8)).toBe(1.55);
    expect(pixelPerfectCameraScale(2.37, 0.8)).toBe(2.37);
    expect(pixelPerfectCameraScale(1.25, 1.3)).toBe(1.3);
    expect(pixelPerfectCameraScale(0.88, 0.8)).toBeCloseTo(0.88);
  });

  it("uses real wheel magnitude and interpolates toward the target", () => {
    const trackpad = nextCameraTargetScale(1, -24);
    const wheel = nextCameraTargetScale(1, -120);
    expect(trackpad).toBeGreaterThan(1);
    expect(wheel).toBeGreaterThan(trackpad);
    const firstFrame = smoothCameraScale(1, wheel, 16);
    expect(firstFrame).toBeGreaterThan(1);
    expect(firstFrame).toBeLessThan(wheel);
    expect(smoothCameraScale(firstFrame, wheel, 64)).toBeGreaterThan(firstFrame);
  });

  it("accumulates wheel zoom on an unrounded target so integer scales are not sticky", () => {
    let target = 2;
    for (let step = 0; step < 8; step += 1) target = nextCameraTargetScale(target, 800);
    expect(target).toBe(0.8);
    expect(pixelPerfectCameraScale(target, 0.8)).toBe(0.8);
    for (let step = 0; step < 8; step += 1) target = nextCameraTargetScale(target, -800);
    expect(target).toBeGreaterThan(1);
    expect(pixelPerfectCameraScale(target, 0.8)).toBeCloseTo(target);
  });

  it("loads a center-first critical window and leaves the prefetch ring in background", () => {
    const plan = progressiveChunkPlan({ minChunkX: -2, minChunkY: -2, maxChunkX: 3, maxChunkY: 2 });
    expect(plan.critical.length).toBeLessThanOrEqual(9);
    expect(plan.critical).toContainEqual([0, 0]);
    expect(new Set([...plan.critical, ...plan.background].map(([x, y]) => `${x},${y}`)).size).toBe(30);
    expect(plan.background[0]).toEqual(expect.any(Array));
  });

  it("does not schedule resident chunks again while panning", () => {
    const resident = new Set(["0,0", "0,1", "1,0", "1,1"]);
    const plan = progressiveChunkPlan({ minChunkX: 0, minChunkY: 0, maxChunkX: 2, maxChunkY: 1 }, resident);
    expect([...plan.critical, ...plan.background]).toEqual([[2, 0], [2, 1]]);
  });
});
