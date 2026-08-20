import type { Cell, ChunkDto, ChunkPayloadDto, TerrainCellDto } from "./contracts";
import { generateWorldDecorations } from "./world-decorations";
import { terrainAt } from "./world-terrain";

function key(cell: Cell): string { return `${cell.x},${cell.y}`; }

export function materializeChunkPayload(payload: ChunkPayloadDto): ChunkDto {
  const originX = payload.chunkX * payload.size;
  const originY = payload.chunkY * payload.size;
  const step = payload.lod === "OVERVIEW" ? 4 : 1;
  const terrain: TerrainCellDto[] = [];
  for (let y = originY; y < originY + payload.size; y += step) {
    for (let x = originX; x < originX + payload.size; x += step) {
      terrain.push({ x, y, ...terrainAt(payload.terrainSeed, x, y) });
    }
  }
  const blocked = new Set<string>([
    ...payload.roads.map(key),
    ...payload.surfaces.map(key),
    ...payload.tasks.flatMap((task) => task.footprint).map(key),
    ...payload.worldFeatures.flatMap((feature) => feature.footprint).map(key),
  ]);
  const decorations = payload.lod === "DETAIL" && !payload.baseLayerOnly
    ? generateWorldDecorations(
      payload.terrainSeed,
      terrain,
      blocked,
      payload.surfaces,
      payload.decorationContext.districts,
      payload.decorationContext.cityBounds,
      payload.decorationContext.tasks,
    )
    : [];
  return {
    chunkX: payload.chunkX,
    chunkY: payload.chunkY,
    size: payload.size,
    terrain,
    roads: payload.roads,
    surfaces: payload.surfaces,
    districts: payload.districts,
    tasks: payload.tasks,
    worldFeatures: payload.worldFeatures,
    decorations,
    worldVersion: payload.publishedVersion,
  };
}
