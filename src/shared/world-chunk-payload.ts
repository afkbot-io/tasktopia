import type { Cell, ChunkDto, ChunkPayloadDto, TerrainCellDto, TerrainKind } from "./contracts";
import { generateWorldDecorations } from "./world-decorations";
import { terrainAt } from "./world-terrain";
import { expandCellRuns, expandRoadRuns, expandSurfaceRuns } from "./world-cell-runs";

function key(cell: Cell): string { return `${cell.x},${cell.y}`; }

const TERRAIN_CODE_KINDS: readonly TerrainKind[] = [
  "GRASS", "MEADOW", "FOREST", "HILL", "MOUNTAIN", "SAND",
  "WET_SAND", "CLAY", "STONE", "SHALLOW_WATER", "DEEP_WATER", "DIRT",
];
const TERRAIN_CODE_BY_KIND = new Map(TERRAIN_CODE_KINDS.map((kind, index) => [kind, index]));

/** Packs a deterministic terrain sample into one byte for worker reuse. */
export function encodeTerrainSample(sample: Pick<TerrainCellDto, "terrain" | "variant">): number {
  const kind = TERRAIN_CODE_BY_KIND.get(sample.terrain);
  if (kind === undefined || sample.variant < 0 || sample.variant > 15) throw new Error("Terrain sample cannot be encoded");
  return kind | (sample.variant << 4);
}

function decodeTerrainSample(code: number): Pick<TerrainCellDto, "terrain" | "variant"> {
  const terrain = TERRAIN_CODE_KINDS[code & 0x0f];
  if (!terrain) throw new Error(`Unknown terrain code ${code}`);
  return { terrain, variant: code >> 4 };
}

export function materializeChunkPayload(payload: ChunkPayloadDto, encodedTerrain?: Uint8Array): ChunkDto {
  const originX = payload.chunkX * payload.size;
  const originY = payload.chunkY * payload.size;
  const step = payload.lod === "OVERVIEW" ? 4 : 1;
  const expectedTerrainSamples = (payload.size / step) ** 2;
  if (encodedTerrain && encodedTerrain.length !== expectedTerrainSamples) {
    throw new Error(`Expected ${expectedTerrainSamples} terrain samples, received ${encodedTerrain.length}`);
  }
  const terrain: TerrainCellDto[] = [];
  let terrainIndex = 0;
  for (let y = originY; y < originY + payload.size; y += step) {
    for (let x = originX; x < originX + payload.size; x += step) {
      const sample = encodedTerrain
        ? decodeTerrainSample(encodedTerrain[terrainIndex]!)
        : terrainAt(payload.terrainSeed, x, y);
      terrain.push({ x, y, ...sample });
      terrainIndex += 1;
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
