import { describe, expect, it } from "vitest";
import type { Rect } from "../src/shared/contracts";
import { cityGroundRangeForViewport, planCityGroundReadiness } from "../src/client/city-ground-readiness";
import { planCityResidency } from "../src/client/city-residency";
import { chunkRangeForViewport, type ChunkCoordinate, type ScreenSize } from "../src/client/world-camera";

const chunkSize = 64;
const cellSize = 8;
type Pose = { x: number; y: number; scale: number };

function cityChunks(bounds: Rect) {
  const chunks: Array<{ chunkX: number; chunkY: number }> = [];
  for (let y = Math.floor(bounds.minY / chunkSize); y <= Math.floor(bounds.maxY / chunkSize); y += 1) {
    for (let x = Math.floor(bounds.minX / chunkSize); x <= Math.floor(bounds.maxX / chunkSize); x += 1) {
      chunks.push({ chunkX: x, chunkY: y });
    }
  }
  return chunks;
}

// Independent screen-space rectangle intersection; no range/planner reuse.
function intersectsViewport([x, y]: ChunkCoordinate, pose: Pose, screen: ScreenSize, bounds: Rect) {
  const left = Math.max(x * chunkSize, bounds.minX) * cellSize * pose.scale + pose.x;
  const right = Math.min((x + 1) * chunkSize, bounds.maxX + 1) * cellSize * pose.scale + pose.x;
  const top = Math.max(y * chunkSize, bounds.minY) * cellSize * pose.scale + pose.y;
  const bottom = Math.min((y + 1) * chunkSize, bounds.maxY + 1) * cellSize * pose.scale + pose.y;
  return right > left && bottom > top && right > 0 && bottom > 0 && left < screen.width && top < screen.height;
}

const viewports: Array<{ name: string; bounds: Rect; pose: Pose; screen: ScreenSize }> = [
  {
    name: "the last pixel-center subpixel sliver at positive chunk edges",
    bounds: { minX: 0, minY: 0, maxX: 255, maxY: 255 },
    pose: { x: -512.6, y: -512.6, scale: 1 }, screen: { width: 512, height: 512 },
  },
  {
    name: "the last pixel-center subpixel sliver at negative chunk edges",
    bounds: { minX: -256, minY: -256, maxX: 255, maxY: 255 },
    pose: { x: 1023.4, y: 1023.4, scale: 1 }, screen: { width: 512, height: 512 },
  },
  {
    name: "fractional phone scale across negative coordinates",
    bounds: { minX: -190, minY: -140, maxX: 210, maxY: 180 },
    pose: { x: 183.2, y: 286.4, scale: .8 }, screen: { width: 390, height: 844 },
  },
  {
    name: "an exact chunk boundary without the adjacent page",
    bounds: { minX: -128, minY: -128, maxX: 255, maxY: 255 },
    pose: { x: -512, y: -512, scale: 1 }, screen: { width: 512, height: 512 },
  },
  {
    name: "partial city pages at negative edges",
    bounds: { minX: -95, minY: -65, maxX: 81, maxY: 93 },
    pose: { x: 960, y: 720, scale: 1 }, screen: { width: 640, height: 480 },
  },
  {
    name: "partial city pages at positive edges",
    bounds: { minX: -95, minY: -65, maxX: 81, maxY: 93 },
    pose: { x: -400, y: -200, scale: 1 }, screen: { width: 640, height: 480 },
  },
];

describe("initial city ground readiness", () => {
  it("separates actual visible chunks from the retained halo in existing order", () => {
    const wanted: readonly ChunkCoordinate[] = [[1, 1], [-1, 0], [0, 0], [2, 0]];
    expect(planCityGroundReadiness(wanted, {
      minChunkX: 0, minChunkY: 0, maxChunkX: 1, maxChunkY: 1,
    })).toEqual({ critical: [[1, 1], [0, 0]], halo: [[-1, 0], [2, 0]] });
  });

  it.each(viewports)("makes every real intersecting ground rectangle critical: $name", ({ bounds, pose, screen }) => {
    const chunks = cityChunks(bounds);
    const range = cityGroundRangeForViewport(pose, pose.scale, screen, bounds, cellSize, chunkSize);
    // Residency remains the existing full halo; only its readiness split uses
    // continuous geometry instead of the old whole-world-pixel subtraction.
    const legacyRange = chunkRangeForViewport(pose, pose.scale, screen, bounds, cellSize, chunkSize, 0);
    const { wanted } = planCityResidency(chunks, legacyRange, chunkSize);
    const plan = planCityGroundReadiness(wanted, range);
    const visible = chunks.map(({ chunkX, chunkY }) => [chunkX, chunkY] as ChunkCoordinate)
      .filter(coordinate => intersectsViewport(coordinate, pose, screen, bounds));
    const keys = (coordinates: readonly ChunkCoordinate[]) => coordinates.map(([x, y]) => `${x},${y}`).sort();

    expect(keys(plan.critical)).toEqual(keys(visible));
    expect(plan.critical).toEqual(wanted.filter(coordinate => intersectsViewport(coordinate, pose, screen, bounds)));
    expect(plan.halo).toEqual(wanted.filter(coordinate => !intersectsViewport(coordinate, pose, screen, bounds)));
    expect(keys([...plan.critical, ...plan.halo])).toEqual(keys(wanted));
  });

  it("uses the staged camera pose rather than the old presented viewport", () => {
    const bounds = { minX: -500, minY: -500, maxX: 499, maxY: 499 };
    const screen = { width: 390, height: 844 };
    const presented: Pose = { x: 0, y: 0, scale: 1 };
    const pending: Pose | undefined = { x: 1024, y: 512, scale: .8 };
    const camera = pending ?? presented;
    const range = cityGroundRangeForViewport(camera, camera.scale, screen, bounds, cellSize, chunkSize);
    const wanted = planCityResidency(cityChunks(bounds), chunkRangeForViewport(
      camera, camera.scale, screen, bounds, cellSize, chunkSize, 0,
    ), chunkSize).wanted;
    const plan = planCityGroundReadiness(wanted, range);

    expect(plan.critical).toHaveLength(6);
    expect(plan.critical).toContainEqual([-3, -2]);
    expect(plan.critical).toContainEqual([-2, 0]);
    expect(plan.critical.every(coordinate => intersectsViewport(coordinate, pending, screen, bounds))).toBe(true);
    expect(planCityGroundReadiness(wanted, cityGroundRangeForViewport(
      presented, presented.scale, screen, bounds, cellSize, chunkSize,
    )).critical).toEqual([]);
  });

  it.each([
    { name: "positive", beforeX: -511.8, nextX: -512.6, y: -512, row: 1, beforeColumns: [0, 1], nextColumns: [1, 2] },
    { name: "negative", beforeX: 1024.2, nextX: 1023.4, y: 1024, row: -2, beforeColumns: [-3, -2], nextColumns: [-2, -1] },
  ])("requires a newly exposed edge after a subpixel pan: $name", ({ beforeX, nextX, y, row, beforeColumns, nextColumns }) => {
    const bounds = { minX: -256, minY: -256, maxX: 255, maxY: 255 };
    const screen = { width: 512, height: 512 };
    const before = cityGroundRangeForViewport({ x: beforeX, y }, 1, screen, bounds, cellSize, chunkSize);
    const next = cityGroundRangeForViewport({ x: nextX, y }, 1, screen, bounds, cellSize, chunkSize);
    const wanted = [...new Set([...beforeColumns, ...nextColumns])].map(x => [x, row] as const);
    expect(planCityGroundReadiness(wanted, before).critical).toEqual(beforeColumns.map(x => [x, row]));
    expect(planCityGroundReadiness(wanted, next).critical).toEqual(nextColumns.map(x => [x, row]));
  });

  it.each([
    { x: 512, y: 0 }, { x: -2048, y: 0 }, { x: 0, y: 512 }, { x: 0, y: -2048 },
  ])("has no critical ground when the viewport only touches or misses city bounds: %j", position => {
    const range = cityGroundRangeForViewport(position, 1, { width: 512, height: 512 },
      { minX: 0, minY: 0, maxX: 255, maxY: 255 }, cellSize, chunkSize);
    expect(range.maxChunkX).toBeLessThan(range.minChunkX);
    expect(planCityGroundReadiness([[0, 0]], range)).toEqual({ critical: [], halo: [[0, 0]] });
  });

  it.each([
    { scale: 0, width: 512 }, { scale: -1, width: 512 }, { scale: Infinity, width: 512 },
    { scale: 1, width: 0 }, { scale: 1, width: NaN },
  ])("returns empty readiness for a non-renderable viewport: %j", ({ scale, width }) => {
    const range = cityGroundRangeForViewport({ x: 0, y: 0 }, scale, { width, height: 512 },
      { minX: 0, minY: 0, maxX: 255, maxY: 255 }, cellSize, chunkSize);
    expect(planCityGroundReadiness([[0, 0]], range).critical).toEqual([]);
  });

  it("does not cap visible pages or invent missing residency", () => {
    const wanted = cityChunks({ minX: 0, minY: 0, maxX: 255, maxY: 255 })
      .map(({ chunkX, chunkY }) => [chunkX, chunkY] as const);
    const range = { minChunkX: 0, minChunkY: 0, maxChunkX: 8, maxChunkY: 8 };
    const plan = planCityGroundReadiness(wanted, range);
    expect(plan.critical).toEqual(wanted);
    expect(plan.critical).toHaveLength(16);
    expect(plan.halo).toEqual([]);
  });

  it("keeps frozen inputs untouched and returns independent tuples", () => {
    const wanted = Object.freeze([
      Object.freeze([3, -2] as const), Object.freeze([-1, 0] as const), Object.freeze([3, -2] as const),
    ]);
    const range = Object.freeze({ minChunkX: 3, minChunkY: -2, maxChunkX: 3, maxChunkY: -2 });
    const plan = planCityGroundReadiness(wanted, range);
    expect(plan).toEqual({ critical: [[3, -2], [3, -2]], halo: [[-1, 0]] });
    expect(plan.critical[0]).not.toBe(wanted[0]);
    expect(plan.halo[0]).not.toBe(wanted[1]);
    plan.critical[0]![0] = 100;
    plan.halo[0]![1] = 100;
    expect(wanted).toEqual([[3, -2], [-1, 0], [3, -2]]);
    expect(plan.critical[1]).toEqual([3, -2]);
  });

  it("keeps an empty wanted set empty", () => {
    expect(planCityGroundReadiness([], { minChunkX: -2, minChunkY: -2, maxChunkX: 2, maxChunkY: 2 }))
      .toEqual({ critical: [], halo: [] });
  });
});
