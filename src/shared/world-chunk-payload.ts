import type { Cell, ChunkDto, ChunkPayloadDto, TerrainCellDto } from "./contracts";
import { generateWorldDecorations } from "./world-decorations";
import { terrainAt } from "./world-terrain";
import { expandCellRuns, expandRoadRuns, expandSurfaceRuns } from "./world-cell-runs";

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
  const roads = payload.payloadVersion === 2 ? expandRoadRuns(payload.roadRuns) : payload.roads;
  const surfaces = payload.payloadVersion === 2 ? expandSurfaceRuns(payload.surfaceRuns) : payload.surfaces;
  const districts = payload.payloadVersion === 2
    ? payload.districts.map(({ cellRuns, ...district }) => ({ ...district, cells: expandCellRuns(cellRuns) }))
    : payload.districts;
  const decorationDistricts = payload.payloadVersion === 2
    ? payload.decorationContext.districts.map(({ cellRuns, ...district }) => ({ ...district, cells: expandCellRuns(cellRuns) }))
    : payload.decorationContext.districts;
  const blocked = new Set<string>([
    ...roads.map(key),
    ...surfaces.map(key),
    ...payload.tasks.flatMap((task) => task.footprint).map(key),
    ...payload.worldFeatures.flatMap((feature) => feature.footprint).map(key),
  ]);
  const decorations = payload.lod === "DETAIL" && !payload.baseLayerOnly
    ? generateWorldDecorations(
      payload.terrainSeed,
      terrain,
      blocked,
      surfaces,
      decorationDistricts,
      payload.decorationContext.cityBounds,
      payload.decorationContext.tasks,
    )
    : [];
  return {
    chunkX: payload.chunkX,
    chunkY: payload.chunkY,
    size: payload.size,
    terrain,
    roads,
    surfaces,
    districts,
    tasks: payload.tasks,
    worldFeatures: payload.worldFeatures,
    decorations,
    worldVersion: payload.publishedVersion,
  };
}
