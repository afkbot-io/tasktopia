import type { Cell, Rect } from "../../shared/contracts";
import type { CompiledBlockLayoutV1 } from "../../shared/block-world";
import type { CountryCityMiniature } from "../../shared/country-overview-contract";
import { blockSlots } from "../../shared/block-templates";
import { blockSlotAirportPoint } from "../../shared/airport-location";

/** One semantic block -> one house, O(blocks + placements), no cell raster. */
export function projectCountryCityMiniature(input: {
  sourceBounds: Rect;
  layout: CompiledBlockLayoutV1 | null;
}): CountryCityMiniature {
  const cellSize = 8;
  const { sourceBounds: bounds, layout } = input;
  const miniature: CountryCityMiniature = {
    cellSize,
    columns: Math.max(1, (bounds.maxX - bounds.minX + 1) / cellSize),
    rows: Math.max(1, (bounds.maxY - bounds.minY + 1) / cellSize),
    blocks: [], airports: [],
  };
  if (!layout) return miniature;
  const districts = new Map(layout.districtLayouts.map((district) => [district.id, district.districtId]));
  const placements = new Map<string, typeof layout.placements>();
  for (const placement of layout.placements) {
    const group = placements.get(placement.blockId) ?? [];
    group.push(placement); placements.set(placement.blockId, group);
  }
  for (const block of [...layout.blocks].sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id))) {
    const placed = placements.get(block.id) ?? [];
    const districtId = districts.get(block.districtLayoutId);
    if (!districtId || placed.length === 0) continue;
    const family = [...placed].sort((a, b) => a.slotKey.localeCompare(b.slotKey))[0]!.buildingFamily;
    miniature.blocks.push({ id: block.id, districtId,
      x: (block.origin.x + block.width / 2 - bounds.minX) / cellSize,
      y: (block.origin.y + block.height / 2 - bounds.minY) / cellSize, family,
    });
    for (const airport of placed.filter((placement) => placement.serviceRole === "AIRPORT" && placement.constructionStage === 5)) {
      const slot = blockSlots(block).find((candidate) => candidate.key === airport.slotKey)!;
      const point = blockSlotAirportPoint(slot);
      miniature.airports.push({ taskId: airport.taskId,
        x: (point.x - bounds.minX) / cellSize,
        y: (point.y - bounds.minY) / cellSize,
      });
    }
  }
  return miniature;
}

/** One uniform projection preserves canonical relative city distances. */
export function projectCountryOverview(cities: readonly { id: string; sourceCenter: Cell }[]): {
  bounds: Rect; centers: Map<string, Cell>; connections: Array<{ fromCityId: string; toCityId: string }>;
} {
  const bounds = { minX: 0, minY: 0, maxX: 144, maxY: 88 };
  const centers = new Map<string, Cell>();
  if (!cities.length) return { bounds, centers, connections: [] };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const { sourceCenter: cell } of cities) {
    minX = Math.min(minX, cell.x); maxX = Math.max(maxX, cell.x);
    minY = Math.min(minY, cell.y); maxY = Math.max(maxY, cell.y);
  }
  const scale = Math.min(124 / Math.max(1, maxX - minX), 68 / Math.max(1, maxY - minY));
  for (const city of cities) centers.set(city.id, {
    x: 72 + (city.sourceCenter.x - (minX + maxX) / 2) * scale,
    y: 44 + (city.sourceCenter.y - (minY + maxY) / 2) * scale,
  });
  // Real completed infrastructure supplies flight routes, not a synthetic MST.
  return { bounds, centers, connections: [] };
}
