import type { Cell, ChunkDto, ChunkPayloadDto, TerrainCellDto, TerrainKind } from "./contracts";
import { generateWorldDecorations } from "./world-decorations";
import { terrainAt } from "./world-terrain";
import { expandCellRuns, expandRoadRuns, expandSurfaceRuns } from "./world-cell-runs";
import { taskParkDecorLayout } from "./task-park";

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
  const roads = expandRoadRuns(payload.roadRuns);
  const surfaces = expandSurfaceRuns(payload.surfaceRuns);
  const surfaceHalo = expandSurfaceRuns(payload.decorationContext.surfaceHaloRuns);
  const hardHalo = expandCellRuns(payload.decorationContext.blockedCellRuns);
  const districts = payload.districts.map(({ cellRuns, ...district }) => ({ ...district, cells: expandCellRuns(cellRuns) }));
  const decorationDistricts = payload.decorationContext.districts.map(({ cellRuns, ...district }) => ({ ...district, cells: expandCellRuns(cellRuns) }));
  // The compact contract stores parent areas only; interiors are seed-derived.
  const worldFeatures = payload.worldFeatures;
  // Unlike the mixed decoration blocked set, these remain forbidden even if
  // old paving exists underneath a permanent marker or planned site.
  const furnitureExclusions = new Set<string>([
    ...hardHalo.map(key),
    ...roads.map(key),
    ...worldFeatures.flatMap(feature => [...feature.footprint, ...feature.accessPath]).map(key),
    ...(payload.plannedSites ?? []).flatMap(site => Array.from({ length: site.width * site.height }, (_, i) =>
      key({ x: site.origin.x + i % site.width, y: site.origin.y + Math.floor(i / site.width) }))),
  ]);
  const blocked = new Set<string>([
    ...hardHalo.map(key),
    // Preserve the existing general decoration mask, while furniture can
    // distinguish safe paving from hard geometry using the separate set above.
    ...surfaceHalo.map(key),
    ...roads.map(key),
    ...surfaces.map(key),
    ...payload.tasks.flatMap((task) => task.footprint).map(key),
    ...(payload.plannedSites ?? []).flatMap(site=>Array.from({length:site.width*site.height},(_,i)=>key({x:site.origin.x+i%site.width,y:site.origin.y+Math.floor(i/site.width)}))),
    ...worldFeatures.flatMap((feature) => feature.footprint).map(key),
  ]);
  const decorationTerrain = [...terrain];
  if (payload.lod === "DETAIL" && !payload.baseLayerOnly) {
    // Read-only halo: neighbours inform coast clearance but are never rendered
    // or considered spawn origins in this chunk.
    for (let y = originY - 4; y < originY + payload.size + 4; y++) {
      for (let x = originX - 4; x < originX + payload.size + 4; x++) {
        if (x >= originX && x < originX + payload.size && y >= originY && y < originY + payload.size) continue;
        decorationTerrain.push({ x, y, ...terrainAt(payload.terrainSeed, x, y) });
      }
    }
  }
  const decorations = payload.lod === "DETAIL" && !payload.baseLayerOnly
    ? [
      ...generateWorldDecorations(
      payload.terrainSeed,
      terrain,
      blocked,
      [...surfaces, ...surfaceHalo],
      decorationDistricts,
      payload.decorationContext.cityBounds,
      payload.decorationContext.tasks,
      decorationTerrain,
      cell => terrainAt(payload.terrainSeed, cell.x, cell.y).terrain,
      furnitureExclusions,
      ),
      ...worldFeatures.filter((feature) => feature.assetKind === "AREA" && feature.kind !== "AIRPORT").flatMap((area) => (
        taskParkDecorLayout(
          area.footprint,
          area.developmentStage,
          area.assetKey,
          Math.floor(hashAreaSeed(payload.terrainSeed, area.origin.x, area.origin.y)),
        ).map((placement) => ({
          id: `area:${area.id}:${placement.kind}:${placement.origin.x}:${placement.origin.y}`,
          kind: placement.kind,
          origin: placement.origin,
        }))
      )),
    ]
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
    plannedSites: payload.plannedSites,
    blockPlaques: payload.blockPlaques,
    worldFeatures,
    decorations,
    worldVersion: payload.publishedVersion,
  };
}

function hashAreaSeed(seed: number, x: number, y: number): number {
  return (Math.imul(seed ^ 0x51ed270b, 0x45d9f3b)
    ^ Math.imul(x, 0x27d4eb2d)
    ^ Math.imul(y, 0x165667b1)) >>> 0;
}
