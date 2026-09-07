import type { Cell, DecorationDto, SurfaceCellDto, TerrainCellDto } from "../shared/contracts";
import { clipPaddingRuns, type CityRoadPadding, type CityRoadPaddingScene } from "./city-road-padding";
import type { CityTerrainPadding } from "./city-terrain-padding";
import { expandCellRuns, expandRoadRuns, expandSurfaceRuns } from "../shared/world-cell-runs";
import { generateWorldDecorations } from "../shared/world-decorations";
import { terrainAt } from "../shared/world-terrain";

const key = (cell: Cell) => `${cell.x},${cell.y}`;
const EMPTY: readonly DecorationDto[] = [];

/** Natural scenery only. Resident/task entities remain owned by the scene. */
export class CityTreePadding {
  private readonly residents;
  private readonly cache = new Map<string, readonly DecorationDto[]>();
  constructor(private readonly scene: CityRoadPaddingScene, private readonly seed: number,
    private readonly terrain: CityTerrainPadding, private readonly roads: CityRoadPadding) {
    this.residents = new Map(scene.chunks.map(chunk => [`${chunk.chunkX},${chunk.chunkY}`, chunk]));
  }
  get(x: number, y: number): readonly DecorationDto[] {
    const id = `${x},${y}`;
    if (this.residents.has(id)) return EMPTY;
    const cached = this.cache.get(id); if (cached) return cached;
    const material = this.terrain.get(x, y); if (!material) return EMPTY;
    const size = this.scene.chunkSize;
    const bounds = { minX: x * size - 2, minY: y * size - 2, maxX: (x + 1) * size + 1, maxY: (y + 1) * size + 1 };
    const inside = (cell: Cell) => cell.x >= bounds.minX && cell.x <= bounds.maxX && cell.y >= bounds.minY && cell.y <= bounds.maxY;
    const blocked = new Set<string>();
    const surfaces = new Map<string, SurfaceCellDto>();
    const roadMaterial = this.roads.get(x, y);
    for (const road of roadMaterial?.roadContext.values() ?? []) if (inside(road)) blocked.add(key(road));
    for (const surface of roadMaterial?.surfaceContext.values() ?? []) if (inside(surface)) { blocked.add(key(surface)); surfaces.set(key(surface), surface); }
    for (let cy = Math.floor(bounds.minY / size); cy <= Math.floor(bounds.maxY / size); cy++) {
      for (let cx = Math.floor(bounds.minX / size); cx <= Math.floor(bounds.maxX / size); cx++) {
        const chunk = this.residents.get(`${cx},${cy}`); if (!chunk) continue;
        for (const cell of expandCellRuns(clipPaddingRuns(chunk.decorationContext.blockedCellRuns, bounds))) blocked.add(key(cell));
        for (const road of expandRoadRuns(clipPaddingRuns(chunk.roadRuns, bounds))) blocked.add(key(road));
        for (const surface of expandSurfaceRuns(clipPaddingRuns([...chunk.surfaceRuns, ...chunk.decorationContext.surfaceHaloRuns], bounds))) {
          blocked.add(key(surface)); surfaces.set(key(surface), surface);
        }
        for (const cell of [...chunk.tasks.flatMap(task => [...task.footprint, ...task.accessPath]), ...chunk.worldFeatures.flatMap(feature => feature.footprint)]) {
          if (inside(cell)) blocked.add(key(cell));
        }
        for (const site of chunk.plannedSites ?? []) {
          for (let row = Math.max(site.origin.y, bounds.minY); row <= Math.min(site.origin.y + site.height - 1, bounds.maxY); row++) {
            for (let column = Math.max(site.origin.x, bounds.minX); column <= Math.min(site.origin.x + site.width - 1, bounds.maxX); column++) blocked.add(`${column},${row}`);
          }
        }
      }
    }
    const context = new Map(material.chunk.terrain.map(cell => [key(cell), cell]));
    const sample = (cell: Cell): TerrainCellDto => {
      const cached = context.get(key(cell)); if (cached) return cached;
      const value = { ...cell, ...terrainAt(this.seed, cell.x, cell.y) }; context.set(key(cell), value); return value;
    };
    for (let row = bounds.minY; row <= bounds.maxY; row++) for (let column = bounds.minX; column <= bounds.maxX; column++) sample({ x: column, y: row });
    const trees = generateWorldDecorations(this.seed, material.chunk.terrain, blocked, [...surfaces.values()], [], [], [], [...context.values()],
      cell => sample(cell).terrain).filter(decoration => decoration.kind.startsWith("tree-") && decoration.id.startsWith(`${decoration.kind}:`));
    this.cache.set(id, trees); return trees;
  }
  retain(coordinates: readonly (readonly [number, number])[]): void {
    const wanted = new Set(coordinates.map(([x, y]) => `${x},${y}`));
    for (const id of this.cache.keys()) if (!wanted.has(id)) this.cache.delete(id);
  }
  get cachedChunks(): number { return this.cache.size; }
}
