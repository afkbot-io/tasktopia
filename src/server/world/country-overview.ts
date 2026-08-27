import type { Cell, Rect } from "../../shared/contracts";
import { boundsOf } from "./grid";

const OVERVIEW_WIDTH = 144;
const OVERVIEW_HEIGHT = 88;
const OVERVIEW_PADDING = 10;

type CityCenter = { id: string; sourceCenter: Cell };

export type CountryCityMiniature = {
  columns: number;
  rows: number;
  districtCodes: string;
  airportCell: Cell;
};

/**
 * Reduces canonical district ownership to a tiny semantic silhouette. It does
 * not copy buildings, roads or terrain and always uses one uniform scale, so a
 * long city stays long instead of being squeezed into a square thumbnail.
 */
export function projectCountryCityMiniature(input: {
  sourceBounds: Rect;
  districts: ReadonlyArray<{ id: string; cells: readonly Cell[] }>;
}): CountryCityMiniature {
  const publishedCells = input.districts.flatMap((district) => district.cells);
  const silhouetteBounds = publishedCells.length > 0
    ? boundsOf(publishedCells)
    : input.sourceBounds;
  const sourceWidth = Math.max(1, silhouetteBounds.maxX - silhouetteBounds.minX + 1);
  const sourceHeight = Math.max(1, silhouetteBounds.maxY - silhouetteBounds.minY + 1);
  const scale = Math.min(14 / sourceWidth, 14 / sourceHeight);
  const columns = Math.max(5, Math.min(14, Math.round(sourceWidth * scale)));
  const rows = Math.max(5, Math.min(14, Math.round(sourceHeight * scale)));
  const codes = Array.from({ length: columns * rows }, () => 0);
  const ordered = [...input.districts].sort((left, right) => left.id.localeCompare(right.id));
  for (let districtIndex = 0; districtIndex < ordered.length; districtIndex += 1) {
    for (const cell of ordered[districtIndex]!.cells) {
      const column = Math.max(0, Math.min(columns - 1, Math.floor((cell.x - silhouetteBounds.minX) * columns / sourceWidth)));
      const row = Math.max(0, Math.min(rows - 1, Math.floor((cell.y - silhouetteBounds.minY) * rows / sourceHeight)));
      codes[row * columns + column] = districtIndex % 15 + 1;
    }
  }
  // A city without published district cells still has a stable compact core.
  if (!codes.some(Boolean)) {
    const centerX = Math.floor(columns / 2);
    const centerY = Math.floor(rows / 2);
    for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
      if (Math.abs(column - centerX) + Math.abs(row - centerY) <= 2) codes[row * columns + column] = 1;
    }
  }
  const occupied = codes.flatMap((code, index) => code ? [{ x: index % columns, y: Math.floor(index / columns) }] : []);
  const airportCell = [...occupied].sort((left, right) => right.y - left.y || right.x - left.x)[0] ?? { x: Math.floor(columns / 2), y: Math.floor(rows / 2) };
  return { columns, rows, districtCodes: codes.map((code) => code.toString(16)).join(""), airportCell };
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
