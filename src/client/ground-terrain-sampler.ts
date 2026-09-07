import type { ChunkDto } from "../shared/contracts";
import { atlasTerrainKindFromWorld, type AtlasTerrainKind } from "../shared/atlas-scene";

/** Reuse worker-materialized terrain during texture construction. Only the
 * one-cell border (or a missing cell) needs deterministic seed evaluation. */
export function createGroundTerrainSampler(chunk: Pick<ChunkDto, "chunkX" | "chunkY" | "size" | "terrain">,
  fallback: (column: number, row: number) => AtlasTerrainKind | undefined): (column: number, row: number) => AtlasTerrainKind | undefined {
  const originX = chunk.chunkX * chunk.size;
  const originY = chunk.chunkY * chunk.size;
  const cells = new Array<AtlasTerrainKind | undefined>(chunk.size * chunk.size);
  for (const cell of chunk.terrain) {
    const x = cell.x - originX;
    const y = cell.y - originY;
    if (x >= 0 && y >= 0 && x < chunk.size && y < chunk.size) cells[y * chunk.size + x] = atlasTerrainKindFromWorld(cell.terrain);
  }
  const outside = new Map<string, AtlasTerrainKind | undefined>();
  return (column, row) => {
    const x = column - originX;
    const y = row - originY;
    if (x >= 0 && y >= 0 && x < chunk.size && y < chunk.size) {
      const kind = cells[y * chunk.size + x];
      if (kind !== undefined) return kind;
    }
    const key = `${column}:${row}`;
    if (!outside.has(key)) outside.set(key, fallback(column, row));
    return outside.get(key);
  };
}
