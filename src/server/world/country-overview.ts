import type { Cell, Rect } from "../../shared/contracts";

const OVERVIEW_WIDTH = 160;
const OVERVIEW_HEIGHT = 90;
const OVERVIEW_PADDING = 12;

type CityCenter = { id: string; sourceCenter: Cell };

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
