import type { BlockPlaqueDto, Cell, ChunkDistrictDto, ChunkDto, ChunkTaskDto, PlannedSiteDto, RoadCellDto, SurfaceCellDto, WorldFeatureDto } from "../shared/contracts";

const key = (cell: Cell) => `${cell.x},${cell.y}`;
type CityEntities = {
  districts: ReadonlyMap<string, ChunkDistrictDto>; tasks: ReadonlyMap<string, ChunkTaskDto>;
  roads: ReadonlyMap<string, RoadCellDto>; surfaces: ReadonlyMap<string, SurfaceCellDto>;
  terrain: ReadonlyMap<string, ChunkDto["terrain"][number]>;
  decorations: ReadonlyMap<string, ChunkDto["decorations"][number]>;
  features: ReadonlyMap<string, WorldFeatureDto>; plannedSites: ReadonlyMap<string, PlannedSiteDto>;
  blockPlaques: ReadonlyMap<string, BlockPlaqueDto>;
};

/** One renderer owns one cached collection. Immutable chunk/task replacements,
 * removals and LOD changes invalidate it; asset readiness alone does not.
 * No TTL or history retains obsolete cities after their renderer is released. */
export function createCityEntityCollector() {
  let previous: { chunks: readonly ChunkDto[]; completed: readonly ChunkTaskDto[]; detail: boolean; entities: CityEntities } | undefined;
  return (chunks: readonly ChunkDto[], completed: readonly ChunkTaskDto[], detail: boolean): CityEntities => {
    if (previous && previous.detail === detail && previous.chunks.length === chunks.length
      && previous.completed.length === completed.length
      && chunks.every((chunk, index) => chunk === previous!.chunks[index])
      && completed.every((task, index) => task === previous!.completed[index])) return previous.entities;
    const districts = new Map<string, ChunkDistrictDto>(), districtCells = new Map<string, Map<string, Cell>>();
    const tasks = new Map<string, ChunkTaskDto>(), roads = new Map<string, RoadCellDto>(), surfaces = new Map<string, SurfaceCellDto>();
    const terrain = new Map<string, ChunkDto["terrain"][number]>(), decorations = new Map<string, ChunkDto["decorations"][number]>();
    const features = new Map<string, WorldFeatureDto>(), plannedSites = new Map<string, PlannedSiteDto>(), blockPlaques = new Map<string, BlockPlaqueDto>();
    for (const chunk of chunks) {
      for (const cell of chunk.terrain) terrain.set(key(cell), cell);
      for (const road of chunk.roads) roads.set(key(road), road);
      for (const surface of chunk.surfaces) surfaces.set(key(surface), surface);
      for (const district of chunk.districts) {
        districts.set(district.id, district);
        let cells = districtCells.get(district.id);
        if (!cells) { cells = new Map(); districtCells.set(district.id, cells); }
        for (const cell of district.cells) cells.set(key(cell), cell);
      }
      for (const task of chunk.tasks) tasks.set(task.id, task);
      for (const decoration of chunk.decorations) {
        if (decoration.kind === "hill-rocky" || decoration.kind === "hill-small" || decoration.kind.startsWith("rock-")) continue;
        decorations.set(decoration.id, decoration);
      }
      for (const feature of chunk.worldFeatures) features.set(feature.id, feature);
      if (detail) for (const site of chunk.plannedSites ?? []) plannedSites.set(site.id, site);
      if (detail) for (const plaque of chunk.blockPlaques ?? []) blockPlaques.set(plaque.id, plaque);
    }
    for (const [id, cells] of districtCells) districts.set(id, { ...districts.get(id)!, cells: [...cells.values()] });
    for (const task of completed) tasks.set(task.id, task);
    const entities = { districts, tasks, roads, surfaces, terrain, decorations, features, plannedSites, blockPlaques };
    previous = { chunks: [...chunks], completed: [...completed], detail, entities };
    return entities;
  };
}
