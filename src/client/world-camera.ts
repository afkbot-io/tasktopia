import type { Rect } from "../shared/contracts";
export { CITY_CAMERA_MIN_SCALE, cityDetailFocusBounds } from "../shared/city-camera";

export type ScreenSize = { width: number; height: number };
export type CameraPosition = { x: number; y: number };
export type ChunkRange = { minChunkX: number; minChunkY: number; maxChunkX: number; maxChunkY: number };
export type ChunkCoordinate = readonly [chunkX: number, chunkY: number];
export type ProgressiveChunkPlan = { critical: ChunkCoordinate[]; background: ChunkCoordinate[] };

// A chunk is already 512px at the native 8px grid. Loading another fractional
// viewport therefore expands to a full chunk ring and can double the first
// request burst. Keep the network window strictly visible; the resident LRU
// retains recently crossed chunks for smooth reverse pans.
export const PREFETCH_VIEWPORT_RATIO = 0;

/** Clamp the continuous camera scale; sprite textures remain nearest-sampled. */
export function pixelPerfectCameraScale(requested: number, minimum: number, detailThreshold = 1): number {
  void detailThreshold;
  return Math.max(requested, minimum);
}

/**
 * Wheel zoom must accumulate against its unrounded target. Accumulating from
 * the integer presentation scale makes 1x and 2x sticky (2 * 0.88 rounds back
 * to 2 forever), so a user can never cross the detail/overview boundary.
 */
export function nextCameraTargetScale(currentTarget: number, deltaY: number, minimum = 0.8, maximum = 4): number {
  const factor = Math.exp(-deltaY * .0015);
  return Math.max(minimum, Math.min(maximum, currentTarget * factor));
}

/** Exponential, frame-rate independent interpolation for wheel and trackpad zoom. */
export function smoothCameraScale(current: number, target: number, deltaMs: number, responseMs = 110): number {
  if (Math.abs(target - current) < .0005) return target;
  const blend = 1 - Math.exp(-Math.max(0, deltaMs) / Math.max(1, responseMs));
  const next = current + (target - current) * blend;
  return Math.abs(target - next) < .0005 ? target : next;
}

export function minimumCameraScale(screen: ScreenSize, bounds: Rect, cellSize: number, configuredMinimum = 0.8): number {
  const width = (bounds.maxX - bounds.minX + 1) * cellSize;
  const height = (bounds.maxY - bounds.minY + 1) * cellSize;
  return Math.max(configuredMinimum, screen.width / width, screen.height / height);
}

export function fitCameraScale(
  screen: ScreenSize,
  bounds: Rect,
  cellSize: number,
  preferredScale = 1.55,
  paddingPixels = 48,
): number {
  const availableWidth = Math.max(cellSize, screen.width - paddingPixels * 2);
  const availableHeight = Math.max(cellSize, screen.height - paddingPixels * 2);
  const width = Math.max(1, bounds.maxX - bounds.minX + 1) * cellSize;
  const height = Math.max(1, bounds.maxY - bounds.minY + 1) * cellSize;
  return Math.min(preferredScale, availableWidth / width, availableHeight / height);
}

export function clampCameraPosition(
  position: CameraPosition,
  scale: number,
  screen: ScreenSize,
  bounds: Rect,
  cellSize: number,
): CameraPosition {
  const left = bounds.minX * cellSize * scale;
  const right = (bounds.maxX + 1) * cellSize * scale;
  const top = bounds.minY * cellSize * scale;
  const bottom = (bounds.maxY + 1) * cellSize * scale;
  const minX = screen.width - right;
  const maxX = -left;
  const minY = screen.height - bottom;
  const maxY = -top;
  return {
    x: minX > maxX ? (minX + maxX) / 2 : Math.max(minX, Math.min(maxX, position.x)),
    y: minY > maxY ? (minY + maxY) / 2 : Math.max(minY, Math.min(maxY, position.y)),
  };
}

export function chunkRangeForViewport(
  position: CameraPosition,
  scale: number,
  screen: ScreenSize,
  bounds: Rect,
  cellSize: number,
  chunkSize: number,
  paddingRatio = PREFETCH_VIEWPORT_RATIO,
): ChunkRange {
  const paddingX = screen.width * paddingRatio / scale;
  const paddingY = screen.height * paddingRatio / scale;
  const minWorldX = Math.max(bounds.minX * cellSize, -position.x / scale - paddingX);
  const minWorldY = Math.max(bounds.minY * cellSize, -position.y / scale - paddingY);
  const maxWorldX = Math.min((bounds.maxX + 1) * cellSize, (screen.width - position.x) / scale + paddingX);
  const maxWorldY = Math.min((bounds.maxY + 1) * cellSize, (screen.height - position.y) / scale + paddingY);
  const chunkPixels = cellSize * chunkSize;
  return {
    minChunkX: Math.floor(minWorldX / chunkPixels),
    minChunkY: Math.floor(minWorldY / chunkPixels),
    maxChunkX: Math.floor((Math.max(minWorldX + 1, maxWorldX) - 1) / chunkPixels),
    maxChunkY: Math.floor((Math.max(minWorldY + 1, maxWorldY) - 1) / chunkPixels),
  };
}

/**
 * Split a visible range into a small center-first paint and a background ring.
 * Resident keys are excluded so panning only requests newly exposed chunks.
 */
export function progressiveChunkPlan(range: ChunkRange, resident = new Set<string>()): ProgressiveChunkPlan {
  const centerX = (range.minChunkX + range.maxChunkX) / 2;
  const centerY = (range.minChunkY + range.maxChunkY) / 2;
  const pending: Array<{ coordinate: ChunkCoordinate; distance: number }> = [];
  for (let chunkX = range.minChunkX; chunkX <= range.maxChunkX; chunkX += 1) {
    for (let chunkY = range.minChunkY; chunkY <= range.maxChunkY; chunkY += 1) {
      if (resident.has(`${chunkX},${chunkY}`)) continue;
      pending.push({
        coordinate: [chunkX, chunkY],
        distance: Math.abs(chunkX - centerX) + Math.abs(chunkY - centerY),
      });
    }
  }
  pending.sort((left, right) => left.distance - right.distance
    || left.coordinate[1] - right.coordinate[1]
    || left.coordinate[0] - right.coordinate[0]);
  return {
    critical: pending.slice(0, 9).map((entry) => entry.coordinate),
    background: pending.slice(9).map((entry) => entry.coordinate),
  };
}
