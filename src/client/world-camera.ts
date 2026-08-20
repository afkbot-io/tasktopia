import type { Rect } from "../shared/contracts";

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

/** Keep city entry readable; the country atlas remains the all-city view. */
export function cityDetailFocusBounds(center: { x: number; y: number }, bounds: Rect): Rect {
  const width = bounds.maxX - bounds.minX + 1;
  const height = bounds.maxY - bounds.minY + 1;
  if (width <= 120 && height <= 80) return bounds;
  const targetWidth = Math.min(120, width);
  const targetHeight = Math.min(80, height);
  const minX = Math.max(bounds.minX, Math.min(bounds.maxX - targetWidth + 1, center.x - Math.floor(targetWidth / 2)));
  const minY = Math.max(bounds.minY, Math.min(bounds.maxY - targetHeight + 1, center.y - Math.floor(targetHeight / 2)));
  return { minX, minY, maxX: minX + targetWidth - 1, maxY: minY + targetHeight - 1 };
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
