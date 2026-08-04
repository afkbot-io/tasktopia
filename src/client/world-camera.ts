import type { Rect } from "../shared/contracts";

export type ScreenSize = { width: number; height: number };
export type CameraPosition = { x: number; y: number };
export type ChunkRange = { minChunkX: number; minChunkY: number; maxChunkX: number; maxChunkY: number };

export const PREFETCH_VIEWPORT_RATIO = 0.25;

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
