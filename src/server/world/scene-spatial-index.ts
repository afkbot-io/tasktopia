import type { Cell, CityDto, DistrictDto, Rect, RoadCellDto, TaskDto, WorldFeatureDto, ChunkTaskDto } from "../../shared/contracts";

export type ViewportSpatialSnapshot = {
  roads: RoadCellDto[];
  districts: DistrictDto[];
  cities: CityDto[];
  tasks: TaskDto[];
  features: WorldFeatureDto[];
  defectSummaryByTask: Map<string, NonNullable<ChunkTaskDto["defectSummary"]>>;
};

type Range = { minChunkX: number; minChunkY: number; maxChunkX: number; maxChunkY: number };

/** Partition once, before building the atomic scene. Each page receives just
 * its four-cell halo; a large district's other parcels must not be processed
 * again for every page. References and input ordering remain unchanged. */
export function createSceneSpatialIndex(source: ViewportSpatialSnapshot, range: Range, chunkSize: number) {
  const pages = new Map<string, ViewportSpatialSnapshot>();
  const key = (x: number, y: number) => `${x},${y}`;
  const page = (id: string) => {
    let value = pages.get(id);
    if (!value) {
      value = { roads: [], districts: [], cities: [], tasks: [], features: [], defectSummaryByTask: source.defectSummaryByTask };
      pages.set(id, value);
    }
    return value;
  };
  const inRange = (x: number, y: number) => x >= range.minChunkX && x <= range.maxChunkX && y >= range.minChunkY && y <= range.maxChunkY;
  const forCell = (cell: Cell, publish: (id: string) => void) => {
    const minX = Math.max(range.minChunkX, Math.floor((cell.x - 4) / chunkSize));
    const maxX = Math.min(range.maxChunkX, Math.floor((cell.x + 4) / chunkSize));
    const minY = Math.max(range.minChunkY, Math.floor((cell.y - 4) / chunkSize));
    const maxY = Math.min(range.maxChunkY, Math.floor((cell.y + 4) / chunkSize));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) publish(key(x, y));
  };
  const rectKeys = (bounds: Rect, margin: number, ids = new Set<string>()) => {
    const minX = Math.max(range.minChunkX, Math.floor((bounds.minX - margin) / chunkSize));
    const maxX = Math.min(range.maxChunkX, Math.floor((bounds.maxX + margin) / chunkSize));
    const minY = Math.max(range.minChunkY, Math.floor((bounds.minY - margin) / chunkSize));
    const maxY = Math.min(range.maxChunkY, Math.floor((bounds.maxY + margin) / chunkSize));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) ids.add(key(x, y));
    return ids;
  };
  const cellKeys = (cells: readonly Cell[], ids = new Set<string>()) => {
    for (const cell of cells) forCell(cell, id => { ids.add(id); });
    return ids;
  };
  for (const road of source.roads) forCell(road, id => { page(id).roads.push(road); });
  for (const task of source.tasks) for (const id of cellKeys(task.accessPath, cellKeys(task.footprint))) page(id).tasks.push(task);
  for (const feature of source.features) for (const id of cellKeys(feature.accessPath, cellKeys(feature.footprint))) page(id).features.push(feature);
  for (const district of source.districts) {
    const local = new Map<string, DistrictDto>();
    for (const cell of district.cells) forCell(cell, id => {
      let clipped = local.get(id);
      if (!clipped) {
        clipped = { ...district, cells: [], lots: [], blockPlaques: [] };
        local.set(id, clipped);
        page(id).districts.push(clipped);
      }
      clipped.cells.push(cell);
    });
    for (const lot of district.lots) {
      const ids = rectKeys({ minX: lot.origin.x, minY: lot.origin.y,
        maxX: lot.origin.x + lot.width - 1, maxY: lot.origin.y + lot.height - 1 }, 4);
      cellKeys(lot.sharedAccess ?? [], ids);
      for (const id of ids) local.get(id)?.lots.push(lot);
    }
    for (const plaque of district.blockPlaques ?? []) for (const id of cellKeys([plaque.origin])) local.get(id)?.blockPlaques?.push(plaque);
  }
  // CITY presently has one scoped city, but keep the shared snapshot's
  // established 96-cell city context for other callers and boundary paving.
  for (const city of source.cities) for (const id of rectKeys(city.bounds, 96)) page(id).cities.push(city);
  const empty: ViewportSpatialSnapshot = { roads: [], districts: [], cities: [], tasks: [], features: [], defectSummaryByTask: source.defectSummaryByTask };
  return {
    forChunk(x: number, y: number): ViewportSpatialSnapshot {
      if (!inRange(x, y)) return empty;
      return pages.get(key(x, y)) ?? empty;
    },
  };
}
