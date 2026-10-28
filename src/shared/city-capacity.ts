import type { Rect } from "./contracts";

export const CITY_SCENE_LEGACY_MAX_CHUNKS = 256;
export const CITY_SCENE_MAX_CHUNKS = 4096;

/** Inclusive canonical chunk envelope, shared by generation, audit and reader.
 * A finite chunk budget bounds work independently of task count or density. */
export function citySceneChunkRange(bounds: Rect, chunkSize = 64) {
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1
    || ![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isSafeInteger)
    || bounds.minX > bounds.maxX || bounds.minY > bounds.maxY) throw new RangeError("Invalid city scene extent");
  const minChunkX = Math.floor(bounds.minX / chunkSize), minChunkY = Math.floor(bounds.minY / chunkSize);
  const maxChunkX = Math.floor(bounds.maxX / chunkSize), maxChunkY = Math.floor(bounds.maxY / chunkSize);
  const columns = maxChunkX - minChunkX + 1, rows = maxChunkY - minChunkY + 1, count = columns * rows;
  if (![columns, rows, count].every(value => Number.isSafeInteger(value) && value > 0)) throw new RangeError("Unsafe city scene extent");
  return { minChunkX, minChunkY, maxChunkX, maxChunkY, columns, rows, count };
}
