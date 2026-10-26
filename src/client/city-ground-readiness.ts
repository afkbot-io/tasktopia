import type { Rect } from "../shared/contracts";
import type { CameraPosition, ChunkCoordinate, ChunkRange, ScreenSize } from "./world-camera";

export type CityGroundReadinessPlan = {
  critical: Array<[number, number]>;
  halo: Array<[number, number]>;
};

/** Continuous visible city ground, including a fractional strip at an edge. */
export function cityGroundRangeForViewport(
  position: CameraPosition,
  scale: number,
  screen: ScreenSize,
  bounds: Rect,
  cellSize: number,
  chunkSize: number,
): ChunkRange {
  const empty = (): ChunkRange => ({ minChunkX: 0, minChunkY: 0, maxChunkX: -1, maxChunkY: -1 });
  if (![position.x, position.y, scale, screen.width, screen.height, bounds.minX, bounds.minY,
    bounds.maxX, bounds.maxY, cellSize, chunkSize].every(Number.isFinite)
    || scale <= 0 || screen.width <= 0 || screen.height <= 0 || cellSize <= 0 || chunkSize <= 0
    || bounds.maxX < bounds.minX || bounds.maxY < bounds.minY) return empty();
  const minX = Math.max(bounds.minX * cellSize, -position.x / scale);
  const minY = Math.max(bounds.minY * cellSize, -position.y / scale);
  const maxX = Math.min((bounds.maxX + 1) * cellSize, (screen.width - position.x) / scale);
  const maxY = Math.min((bounds.maxY + 1) * cellSize, (screen.height - position.y) / scale);
  if (maxX <= minX || maxY <= minY) return empty();
  const chunkPixels = cellSize * chunkSize;
  return {
    minChunkX: Math.floor(minX / chunkPixels), minChunkY: Math.floor(minY / chunkPixels),
    maxChunkX: Math.ceil(maxX / chunkPixels) - 1, maxChunkY: Math.ceil(maxY / chunkPixels) - 1,
  };
}

/** Partition existing city residency; camera policy belongs to the caller. */
export function planCityGroundReadiness(
  wanted: readonly ChunkCoordinate[],
  range: ChunkRange,
): CityGroundReadinessPlan {
  const critical: Array<[number, number]> = [];
  const halo: Array<[number, number]> = [];
  for (const [x, y] of wanted) {
    const visible = x >= range.minChunkX && x <= range.maxChunkX
      && y >= range.minChunkY && y <= range.maxChunkY;
    (visible ? critical : halo).push([x, y]);
  }
  return { critical, halo };
}
