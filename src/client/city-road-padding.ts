import type { Cell, CellRunDto, Rect, RoadCellDto, SurfaceCellDto } from "../shared/contracts";
import type { CitySceneDto } from "../shared/city-scene-contract";
import { intercityRoadRasterNetwork } from "../shared/intercity-roads";
import { rasterizeBlockRoads } from "../shared/road-raster";
import { buildRoadSurfaces } from "../shared/road-surfaces";
import { expandCellRuns, expandRoadRuns, expandSurfaceRuns } from "../shared/world-cell-runs";

export type CityRoadPaddingChunk = {
  roads: RoadCellDto[]; surfaces: SurfaceCellDto[];
  roadContext: Map<string, RoadCellDto>; surfaceContext: Map<string, SurfaceCellDto>;
};
export type CityRoadPaddingScene = Pick<CitySceneDto, "chunkSize" | "chunks" | "intercityRoads">;
const key = (cell: Cell) => `${cell.x},${cell.y}`;
const inside = (bounds: Rect, cell: Cell) => cell.x >= bounds.minX && cell.x <= bounds.maxX && cell.y >= bounds.minY && cell.y <= bounds.maxY;
const expand = (bounds: Rect, radius: number): Rect => ({ minX: bounds.minX - radius, minY: bounds.minY - radius, maxX: bounds.maxX + radius, maxY: bounds.maxY + radius });

/** Clip compressed resident runs before expansion as well: route length must
 * never dictate a padding allocation. The server owns all supplied geometry. */
export function clipPaddingRuns<T extends CellRunDto>(runs: readonly T[], bounds: Rect): T[] {
  return runs.flatMap(run => {
    const minX = Math.max(bounds.minX, Math.min(run.start.x, run.end.x));
    const minY = Math.max(bounds.minY, Math.min(run.start.y, run.end.y));
    const maxX = Math.min(bounds.maxX, Math.max(run.start.x, run.end.x));
    const maxY = Math.min(bounds.maxY, Math.max(run.start.y, run.end.y));
    if (minX > maxX || minY > maxY) return [];
    return [{ ...run, start: { x: run.start.x <= run.end.x ? minX : maxX, y: run.start.y <= run.end.y ? minY : maxY },
      end: { x: run.start.x <= run.end.x ? maxX : minX, y: run.start.y <= run.end.y ? maxY : minY } }];
  });
}

export class CityRoadPadding {
  private readonly residents;
  private readonly network;
  private readonly cache = new Map<string, CityRoadPaddingChunk | undefined>();
  constructor(private readonly scene: CityRoadPaddingScene, private readonly isSurfaceTerrain: (cell: Cell) => boolean) {
    this.residents = new Map(scene.chunks.map(chunk => [`${chunk.chunkX},${chunk.chunkY}`, chunk]));
    this.network = intercityRoadRasterNetwork(scene.intercityRoads);
  }
  get(x: number, y: number): CityRoadPaddingChunk | undefined {
    const id = `${x},${y}`;
    if (this.residents.has(id)) return undefined;
    if (this.cache.has(id)) return this.cache.get(id);
    const size = this.scene.chunkSize;
    const bounds = { minX: x * size, minY: y * size, maxX: (x + 1) * size - 1, maxY: (y + 1) * size - 1 };
    const profileBounds = expand(bounds, 14);
    const unionBounds = expand(profileBounds, 1);
    const routeRoads = rasterizeBlockRoads(this.network, unionBounds);
    if (!routeRoads.length) { this.cache.set(id, undefined); return undefined; }
    const union = new Map(routeRoads.map(cell => [key(cell), cell]));
    const residentSurfaces = new Map<string, SurfaceCellDto>();
    const blocked = new Set<string>();
    for (let row = Math.floor(unionBounds.minY / size); row <= Math.floor(unionBounds.maxY / size); row++) {
      for (let column = Math.floor(unionBounds.minX / size); column <= Math.floor(unionBounds.maxX / size); column++) {
        const chunk = this.residents.get(`${column},${row}`);
        if (!chunk) continue;
        for (const road of expandRoadRuns(clipPaddingRuns(chunk.roadRuns, unionBounds))) union.set(key(road), road);
        for (const surface of expandSurfaceRuns(clipPaddingRuns([...chunk.decorationContext.surfaceHaloRuns, ...chunk.surfaceRuns], profileBounds))) {
          residentSurfaces.set(key(surface), surface);
        }
        for (const cell of expandCellRuns(clipPaddingRuns(chunk.decorationContext.blockedCellRuns, unionBounds))) blocked.add(key(cell));
        for (const task of chunk.tasks) for (const cell of task.footprint) if (inside(unionBounds, cell)) blocked.add(key(cell));
        for (const feature of chunk.worldFeatures) for (const cell of feature.footprint) if (inside(unionBounds, cell)) blocked.add(key(cell));
      }
    }
    const roadContext = new Map<string, RoadCellDto>();
    for (const cell of [...union.values()].sort((a, b) => a.y - b.y || a.x - b.x)) {
      if (!inside(profileBounds, cell)) continue;
      const mask = (union.has(`${cell.x},${cell.y - 1}`) ? 1 : 0) | (union.has(`${cell.x + 1},${cell.y}`) ? 2 : 0)
        | (union.has(`${cell.x},${cell.y + 1}`) ? 4 : 0) | (union.has(`${cell.x - 1},${cell.y}`) ? 8 : 0);
      roadContext.set(key(cell), { ...cell, mask });
    }
    // Match buildChunkPayload's four-cell surface scope exactly. A larger halo
    // remains read-only for road-band and seam classification, not zebra phase.
    const surfaceScope = expand(bounds, 4);
    const surfaceRoads = new Map([...roadContext].filter(([, cell]) => inside(surfaceScope, cell)));
    const surfaceContext = buildRoadSurfaces({ roads: surfaceRoads, blocked,
      isSurfaceTerrain: this.isSurfaceTerrain, isInsideCity: () => false });
    for (const [id, surface] of residentSurfaces) {
      if (!roadContext.has(id) || surface.kind === "CROSSWALK") surfaceContext.set(id, surface);
    }
    const value = { roads: [...roadContext.values()].filter(cell => inside(bounds, cell)),
      surfaces: [...surfaceContext.values()].filter(cell => inside(bounds, cell)), roadContext, surfaceContext };
    const result = value.roads.length || value.surfaces.length ? value : undefined;
    this.cache.set(id, result);
    return result;
  }
  retain(coordinates: readonly (readonly [number, number])[]): void {
    const wanted = new Set(coordinates.map(([x, y]) => `${x},${y}`));
    for (const id of this.cache.keys()) if (!wanted.has(id)) this.cache.delete(id);
  }
  get cachedChunks(): number { return this.cache.size; }
}
