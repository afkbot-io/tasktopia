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

/** Expand sparse row spans, not every origin's overlapping square of strings. */
function nearbyCells(cells:readonly Cell[],radius:number,bounds:{minX:number;minY:number;maxX:number;maxY:number}):Cell[]{
  const ordered=[...cells].sort((a,b)=>a.y-b.y||a.x-b.x),rows=new Map<number,Array<[number,number]>>();
  for(let index=0;index<ordered.length;){
    const first=ordered[index++]!;let end=first.x;
    while(index<ordered.length&&ordered[index]!.y===first.y&&ordered[index]!.x<=end+1){end=Math.max(end,ordered[index++]!.x);}
    const minX=Math.max(bounds.minX,first.x-radius),maxX=Math.min(bounds.maxX,end+radius);
    if(minX>maxX)continue;
    for(let y=Math.max(bounds.minY,first.y-radius);y<=Math.min(bounds.maxY,first.y+radius);y++){
      let spans=rows.get(y);if(!spans){spans=[];rows.set(y,spans);}spans.push([minX,maxX]);
    }
  }
  const result:Cell[]=[];
  for(const [y,spans] of [...rows].sort((a,b)=>a[0]-b[0])){
    let end=bounds.minX-1;
    for(const [minX,maxX] of spans.sort((a,b)=>a[0]-b[0])){
      for(let x=Math.max(minX,end+1);x<=maxX;x++)result.push({x,y});
      end=Math.max(end,maxX);
    }
  }
  return result;
}

export function materializeChunkPayload(payload: ChunkPayloadDto, encodedTerrain?: Uint8Array, physicalOnly = false): ChunkDto {
  const originX = payload.chunkX * payload.size;
  const originY = payload.chunkY * payload.size;
  const step = payload.lod === "OVERVIEW" ? 4 : 1;
  const expectedTerrainSamples = (payload.size / step) ** 2;
  if (encodedTerrain && encodedTerrain.length !== expectedTerrainSamples) {
    throw new Error(`Expected ${expectedTerrainSamples} terrain samples, received ${encodedTerrain.length}`);
  }
  const roads = expandRoadRuns(payload.roadRuns);
  const surfaces = expandSurfaceRuns(payload.surfaceRuns);
  const surfaceHalo = expandSurfaceRuns(payload.decorationContext.surfaceHaloRuns);
  const hardHalo = expandCellRuns(payload.decorationContext.blockedCellRuns);
  const districts = payload.districts.map(({ cellRuns, ...district }) => ({ ...district, cells: physicalOnly ? [] : expandCellRuns(cellRuns) }));
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
  const terrain: TerrainCellDto[] = [];
  if (physicalOnly) {
    // Canonical walking needs paving furniture and its nearby clearance, not
    // a terrain object for every cell in every offscreen page. Keep the same
    // row order as visual materialization for deterministic prop ownership.
    const origins=nearbyCells([...surfaces,...surfaceHalo,...roads],3,
      {minX:originX,minY:originY,maxX:originX+payload.size-1,maxY:originY+payload.size-1});
    for (const cell of origins) {
      terrain.push({...cell,...terrainAt(payload.terrainSeed,cell.x,cell.y,payload.terrainProfile)});
    }
  } else {
    let terrainIndex = 0;
    for (let y = originY; y < originY + payload.size; y += step) {
      for (let x = originX; x < originX + payload.size; x += step) {
        const sample = encodedTerrain
          ? decodeTerrainSample(encodedTerrain[terrainIndex]!)
          : terrainAt(payload.terrainSeed, x, y, payload.terrainProfile);
        terrain.push({ x, y, ...sample });
        terrainIndex += 1;
      }
    }
  }
  const decorationTerrain = [...terrain];
  if (payload.lod === "DETAIL" && !payload.baseLayerOnly) {
    // Read-only halo: neighbours inform coast clearance but are never rendered
    // or considered spawn origins in this chunk.
    if (physicalOnly) {
      const context = new Map(decorationTerrain.map(cell => [key(cell),cell]));
      for (const {x,y} of nearbyCells(terrain,4,
        {minX:originX-4,minY:originY-4,maxX:originX+payload.size+3,maxY:originY+payload.size+3})) {
        const id=`${x},${y}`;
        if (context.has(id)) continue;
        context.set(id,{x,y,...terrainAt(payload.terrainSeed,x,y,payload.terrainProfile)});
      }
      decorationTerrain.splice(0,decorationTerrain.length,...context.values());
    } else for (let y = originY - 4; y < originY + payload.size + 4; y++) {
      for (let x = originX - 4; x < originX + payload.size + 4; x++) {
        if (x >= originX && x < originX + payload.size && y >= originY && y < originY + payload.size) continue;
        decorationTerrain.push({ x, y, ...terrainAt(payload.terrainSeed, x, y, payload.terrainProfile) });
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
      cell => terrainAt(payload.terrainSeed, cell.x, cell.y, payload.terrainProfile).terrain,
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
    terrain: physicalOnly ? [] : terrain,
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
