import type { Cell, Rect, TerrainKind } from "../../shared/contracts";
import { COUNTRY_TERRAIN_KINDS, type CountryOverviewTerrainKind } from "../../shared/country-overview-contract";
import { terrainAt } from "../../shared/world-terrain";
import { boundsOf } from "./grid";

const OVERVIEW_WIDTH = 144;
const OVERVIEW_HEIGHT = 88;
const OVERVIEW_PADDING = 10;
export const COUNTRY_CITY_LOD_BLOCK_SIZE = 16;

type CityCenter = { id: string; sourceCenter: Cell };

export type CountryCityMiniature = {
  blockSize: number;
  columns: number;
  rows: number;
  districtCodes: string;
  /** Hex-encoded occupied fraction per semantic block, from 0 to 15. */
  coverageCodes: string;
  /** Four quadrant occupancy bits preserve the coarse contour without sub-cell objects. */
  shapeCodes: string;
  terrainCodes: string;
  airportCell: Cell;
};

/**
 * Reduces canonical district ownership to fixed 16x16-cell semantic blocks. It
 * does not copy buildings, roads or props. The stable block size preserves the
 * city's proportions and makes snapshot cost proportional to area / 256 rather
 * than to every simulation cell.
 */
export function projectCountryCityMiniature(input: {
  sourceBounds: Rect;
  districts: ReadonlyArray<{ id: string; cells: readonly Cell[] }>;
  terrainSeed?: number;
}): CountryCityMiniature {
  const publishedCells = input.districts.flatMap((district) => district.cells);
  const silhouetteBounds = publishedCells.length > 0
    ? boundsOf(publishedCells)
    : input.sourceBounds;
  const sourceWidth = Math.max(1, silhouetteBounds.maxX - silhouetteBounds.minX + 1);
  const sourceHeight = Math.max(1, silhouetteBounds.maxY - silhouetteBounds.minY + 1);
  const blockSize = COUNTRY_CITY_LOD_BLOCK_SIZE;
  const columns = Math.max(1, Math.ceil(sourceWidth / blockSize));
  const rows = Math.max(1, Math.ceil(sourceHeight / blockSize));
  const codes = Array.from({ length: columns * rows }, () => 0);
  const coverage = Array.from({ length: columns * rows }, () => 0);
  const shapes = Array.from({ length: columns * rows }, () => 0);
  const terrainCodes = Array.from({ length: columns * rows }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const counts = new Map<CountryOverviewTerrainKind, number>();
    for (let localY = 0; localY < blockSize; localY += 1) for (let localX = 0; localX < blockSize; localX += 1) {
      const x = silhouetteBounds.minX + column * blockSize + localX;
      const y = silhouetteBounds.minY + row * blockSize + localY;
      if (x > silhouetteBounds.maxX || y > silhouetteBounds.maxY) continue;
      const kind = overviewTerrainKind(terrainAt(input.terrainSeed ?? 0, x, y).terrain);
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
    const dominant = [...counts.entries()].sort((left, right) => right[1] - left[1]
      || COUNTRY_TERRAIN_KINDS.indexOf(left[0]) - COUNTRY_TERRAIN_KINDS.indexOf(right[0]))[0]?.[0] ?? "grass";
    return COUNTRY_TERRAIN_KINDS.indexOf(dominant).toString(16);
  }).join("");
  const districtCounts = Array.from({ length: columns * rows }, () => new Map<number, number>());
  const ordered = [...input.districts].sort((left, right) => left.id.localeCompare(right.id));
  for (let districtIndex = 0; districtIndex < ordered.length; districtIndex += 1) {
    for (const cell of ordered[districtIndex]!.cells) {
      const column = Math.max(0, Math.min(columns - 1, Math.floor((cell.x - silhouetteBounds.minX) / blockSize)));
      const row = Math.max(0, Math.min(rows - 1, Math.floor((cell.y - silhouetteBounds.minY) / blockSize)));
      const index = row * columns + column;
      coverage[index] += 1;
      const localX = (cell.x - silhouetteBounds.minX) % blockSize;
      const localY = (cell.y - silhouetteBounds.minY) % blockSize;
      shapes[index] |= 1 << ((localY >= blockSize / 2 ? 2 : 0) + (localX >= blockSize / 2 ? 1 : 0));
      const code = districtIndex % 15 + 1;
      districtCounts[index]!.set(code, (districtCounts[index]!.get(code) ?? 0) + 1);
    }
  }
  for (let index = 0; index < districtCounts.length; index += 1) {
    const dominant = [...districtCounts[index]!.entries()]
      .sort((left, right) => right[1] - left[1] || left[0] - right[0])[0];
    if (dominant) codes[index] = dominant[0];
  }
  // A city without published district cells still has a stable compact core.
  if (!codes.some(Boolean)) {
    const centerX = Math.floor(columns / 2);
    const centerY = Math.floor(rows / 2);
    for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
      if (Math.abs(column - centerX) + Math.abs(row - centerY) <= 2) {
        const index = row * columns + column;
        codes[index] = 1;
        coverage[index] = blockSize * blockSize;
        shapes[index] = 15;
      }
    }
  }
  const occupied = codes.flatMap((code, index) => code ? [{ x: index % columns, y: Math.floor(index / columns) }] : []);
  const airportCell = [...occupied].sort((left, right) => right.y - left.y || right.x - left.x)[0] ?? { x: Math.floor(columns / 2), y: Math.floor(rows / 2) };
  const coverageCodes = coverage.map((count) => count === 0
    ? "0"
    : Math.max(1, Math.min(15, Math.ceil(count / (blockSize * blockSize) * 15))).toString(16)).join("");
  const shapeCodes = shapes.map((mask) => mask.toString(16)).join("");
  return { blockSize, columns, rows, districtCodes: codes.map((code) => code.toString(16)).join(""), coverageCodes, shapeCodes, terrainCodes, airportCell };
}

function overviewTerrainKind(kind: TerrainKind): CountryOverviewTerrainKind {
  switch (kind) {
    case "GRASS": return "grass";
    case "MEADOW": return "meadow";
    case "FOREST": return "forest";
    case "HILL": return "hill";
    case "MOUNTAIN": return "mountain";
    case "SAND": case "WET_SAND": return "coast";
    case "SHALLOW_WATER": return "shallow_water";
    case "DEEP_WATER": return "deep_water";
    case "STONE": return "stone";
    default: return "grass";
  }
}

/**
 * Projects canonical city centers with one uniform affine transform. Unlike
 * the legacy atlas layout this never compresses individual inter-city gaps.
 */
export function projectCountryOverview(cities: readonly CityCenter[]): {
  bounds: Rect;
  centers: Map<string, Cell>;
  connections: Array<{ fromCityId: string; toCityId: string }>;
} {
  const bounds = { minX: 0, minY: 0, maxX: OVERVIEW_WIDTH, maxY: OVERVIEW_HEIGHT };
  if (cities.length === 0) return { bounds, centers: new Map(), connections: [] };
  const minX = Math.min(...cities.map((city) => city.sourceCenter.x));
  const maxX = Math.max(...cities.map((city) => city.sourceCenter.x));
  const minY = Math.min(...cities.map((city) => city.sourceCenter.y));
  const maxY = Math.max(...cities.map((city) => city.sourceCenter.y));
  const sourceWidth = Math.max(1, maxX - minX);
  const sourceHeight = Math.max(1, maxY - minY);
  const scale = Math.min(
    (OVERVIEW_WIDTH - OVERVIEW_PADDING * 2) / sourceWidth,
    (OVERVIEW_HEIGHT - OVERVIEW_PADDING * 2) / sourceHeight,
  );
  const renderedWidth = (maxX - minX) * scale;
  const renderedHeight = (maxY - minY) * scale;
  const offsetX = (OVERVIEW_WIDTH - renderedWidth) / 2;
  const offsetY = (OVERVIEW_HEIGHT - renderedHeight) / 2;
  const centers = new Map(cities.map((city) => [city.id, {
    x: Math.round(offsetX + (city.sourceCenter.x - minX) * scale),
    y: Math.round(offsetY + (city.sourceCenter.y - minY) * scale),
  }]));

  // A deterministic minimum spanning tree keeps the country connected without
  // transferring road cells. Edge weights use canonical coordinates.
  const byId = [...cities].sort((left, right) => left.id.localeCompare(right.id));
  const visited = new Set<string>([byId[0]!.id]);
  const connections: Array<{ fromCityId: string; toCityId: string }> = [];
  while (visited.size < byId.length) {
    let best: { fromCityId: string; toCityId: string; distance: number } | undefined;
    for (const from of byId) {
      if (!visited.has(from.id)) continue;
      for (const to of byId) {
        if (visited.has(to.id)) continue;
        const dx = from.sourceCenter.x - to.sourceCenter.x;
        const dy = from.sourceCenter.y - to.sourceCenter.y;
        const candidate = { fromCityId: from.id, toCityId: to.id, distance: dx * dx + dy * dy };
        if (!best || candidate.distance < best.distance
          || candidate.distance === best.distance
            && `${candidate.fromCityId}:${candidate.toCityId}` < `${best.fromCityId}:${best.toCityId}`) best = candidate;
      }
    }
    if (!best) break;
    connections.push({ fromCityId: best.fromCityId, toCityId: best.toCityId });
    visited.add(best.toCityId);
  }
  return { bounds, centers, connections };
}
