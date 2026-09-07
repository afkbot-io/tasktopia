import type { CountryOverviewCityDto } from "../../shared/country-overview-contract";
import type { GridPoint, OrthogonalDirection } from "../../shared/semantic-road";
import type { IntercityRoadRoute } from "./intercity-road-planner";
import type { CountryGeography, CountryGeographyCell, createCountryWorldProjection } from "./country-geography";

export const COUNTRY_ROAD_PROJECTION_VERSION = 1 as const;
const MINIATURE_DISPLAY_CELL = .72;
const WORLD_SAMPLE_STEP = 8;
const DELTAS: Record<OrthogonalDirection, GridPoint> = { N: { x: 0, y: -1 }, E: { x: 1, y: 0 }, S: { x: 0, y: 1 }, W: { x: -1, y: 0 } };
const same = (a: GridPoint, b: GridPoint) => a.x === b.x && a.y === b.y;
const finite = (point: GridPoint) => Number.isFinite(point.x) && Number.isFinite(point.y);
export type CountryRoadCity = Pick<CountryOverviewCityDto, "id" | "sourceBounds" | "atlasCenter" | "miniature">;
export type CountryRoadProjectionFailureReason = "MISSING_CITY" | "INVALID_CITY" | "INVALID_GEOMETRY"
  | "ENDPOINT_OUTSIDE_CITY" | "ENDPOINT_OFF_LAND" | "UNPROJECTABLE_ANCHOR" | "DISCONNECTED_LAND"
  | "NO_ORDERED_CORRIDOR" | "COLLAPSED_ENDPOINTS" | "ROUTE_BUDGET" | "TOTAL_BUDGET";
export type CountryRoadProjectionFailure = {
  routeId: string; fromCityId: string; toCityId: string; reason: CountryRoadProjectionFailureReason;
};
export type CountryRoadDisplayRoute = {
  routeId: string; fromCityId: string; toCityId: string; fromNodeId: string; toNodeId: string;
  /** Orthogonal COUNTRY display coordinates, not world-metric coordinates. */
  points: GridPoint[];
  /** Ordered, loop-free inherited dry cells. Useful for clipping the painted stroke. */
  cellIds: string[];
  anchorCellIds: string[];
};
export type CountryRoadProjectionLimits = {
  maxWorldSteps: number; maxProjectSamples: number; maxVisitedPerLeg: number;
  maxTotalVisited: number; maxOutputPoints: number; maxOutputCells: number;
};
export type CountryRoadProjection = {
  routes: CountryRoadDisplayRoute[]; failures: CountryRoadProjectionFailure[];
  metrics: { gridCells: number; dryCells: number; inputRuns: number; worldSteps: number; projectSamples: number;
    visited: number; outputPoints: number; outputCells: number };
};
export type CountryRoadProjectionInput = {
  routes: readonly IntercityRoadRoute[]; geography: CountryGeography;
  projectWorldPoint: ReturnType<typeof createCountryWorldProjection>;
  cities: readonly CountryRoadCity[]; limits?: Partial<CountryRoadProjectionLimits>;
};
const DEFAULT_LIMITS: CountryRoadProjectionLimits = { maxWorldSteps: 300_000, maxProjectSamples: 40_000,
  maxVisitedPerLeg: 4096, maxTotalVisited: 100_000, maxOutputPoints: 50_000, maxOutputCells: 50_000 };

/** Match the actual COUNTRY miniature renderer, including inclusive source bounds. */
export function countryRoadMiniaturePoint(city: CountryRoadCity, world: GridPoint): GridPoint {
  return { x: city.atlasCenter.x - city.miniature.columns * MINIATURE_DISPLAY_CELL / 2
    + (world.x - city.sourceBounds.minX) / WORLD_SAMPLE_STEP * MINIATURE_DISPLAY_CELL,
  y: city.atlasCenter.y - city.miniature.rows * MINIATURE_DISPLAY_CELL / 2
    + (world.y - city.sourceBounds.minY) / WORLD_SAMPLE_STEP * MINIATURE_DISPLAY_CELL };
}

/** Read model of accepted roads, never an independent city-link generator.
 * Projected anchors may jump over macro water; only proven four-connected dry
 * corridors may join them. No bridge, straight-line, endpoint clamp or reroll. */
export function projectCountryRoads(input: CountryRoadProjectionInput): CountryRoadProjection {
  const limits = { ...DEFAULT_LIMITS, ...input.limits };
  for (const [name, value] of Object.entries(limits)) if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid country road limit ${name}`);
  if (input.routes.length > 100 || input.cities.length > 100) throw new Error("Country road input exceeds 100 routes/cities");
  const { columns, rows, cellSize, topology } = input.geography.grid;
  if (topology !== "SQUARE_4" || ![columns, rows, cellSize].every(value => Number.isSafeInteger(value) && value > 0)
    || columns * rows > 4096 || input.geography.cells.length > columns * rows) throw new Error("Invalid country road geography bounds");
  const cells = new Map<number, CountryGeographyCell>(), cellIds = new Set<string>();
  for (const cell of input.geography.cells) {
    const index = cell.row * columns + cell.column;
    if (![cell.column, cell.row].every(Number.isSafeInteger) || cell.column < 0 || cell.column >= columns
      || cell.row < 0 || cell.row >= rows || cell.x !== cell.column * cellSize || cell.y !== cell.row * cellSize
      || !cell.id || cells.has(index) || cellIds.has(cell.id)) throw new Error("Invalid or duplicate country road geography cell");
    cells.set(index, cell); cellIds.add(cell.id);
  }
  const dry = new Set([...cells].filter(([, cell]) => cell.land && cell.macroCellId
    && !["river", "unknown", "deep_water", "shallow_water"].includes(cell.terrain)).map(([index]) => index));
  const neighbors = new Map<number, number[]>();
  for (const index of dry) {
    const cell = cells.get(index)!;
    neighbors.set(index, [[1, 0], [0, 1], [-1, 0], [0, -1]].flatMap(([dx, dy]) => {
      const column = cell.column + dx!, row = cell.row + dy!, next = row * columns + column;
      return column >= 0 && column < columns && row >= 0 && row < rows && dry.has(next) ? [next] : [];
    }));
  }
  const components = new Map<number, number>();
  for (let index = 0; index < columns * rows; index++) if (dry.has(index) && !components.has(index)) {
    const queue = [index]; components.set(index, index);
    for (let at = 0; at < queue.length; at++) for (const next of neighbors.get(queue[at]!)!) {
      if (!components.has(next)) { components.set(next, index); queue.push(next); }
    }
  }
  const metrics: CountryRoadProjection["metrics"] = { gridCells: cells.size, dryCells: dry.size,
    inputRuns: 0, worldSteps: 0, projectSamples: 0, visited: 0, outputPoints: 0, outputCells: 0 };
  const cities = new Map(input.cities.map(city => [city.id, city]));
  if (cities.size !== input.cities.length) throw new Error("Duplicate country road city");
  const sourceRoutes = [...input.routes].sort((a, b) => a.id.localeCompare(b.id));
  if (new Set(sourceRoutes.map(route => route.id)).size !== sourceRoutes.length) throw new Error("Duplicate country road identity");
  const cellAt = (point: GridPoint): number | undefined => {
    if (!finite(point) || point.x < 0 || point.y < 0 || point.x >= columns * cellSize || point.y >= rows * cellSize) return undefined;
    const index = Math.floor(point.y / cellSize) * columns + Math.floor(point.x / cellSize);
    return dry.has(index) ? index : undefined;
  };
  const projected = new Map<string, number | "UNPROJECTABLE_ANCHOR">();
  const project = (source: GridPoint): number | "UNPROJECTABLE_ANCHOR" | "TOTAL_BUDGET" => {
    const key = `${source.x}:${source.y}`, cached = projected.get(key);
    if (cached !== undefined) return cached;
    if (metrics.projectSamples >= limits.maxProjectSamples) return "TOTAL_BUDGET";
    metrics.projectSamples++;
    const result = input.projectWorldPoint(source);
    const index = result && cellAt(result.point);
    const answer = index != null && cells.get(index)!.macroCellId === result!.macroCellId ? index : "UNPROJECTABLE_ANCHOR";
    projected.set(key, answer); return answer;
  };
  const findLeg = (start: number, end: number, used: Set<number>, future: Set<number>): number[] | CountryRoadProjectionFailureReason => {
    if (metrics.visited >= limits.maxTotalVisited) return "TOTAL_BUDGET";
    if (neighbors.get(start)!.includes(end)) { metrics.visited++; return [start, end]; }
    const queue = [start], previous = new Map<number, number | null>([[start, null]]);
    let visited = 0;
    for (let at = 0; at < queue.length; at++) {
      if (metrics.visited >= limits.maxTotalVisited) return "TOTAL_BUDGET";
      if (visited >= limits.maxVisitedPerLeg) return "ROUTE_BUDGET";
      const current = queue[at]!; visited++; metrics.visited++;
      if (current === end) {
        const path = [current]; let before = previous.get(current);
        while (before != null) { path.push(before); before = previous.get(before); }
        return path.reverse();
      }
      for (const next of neighbors.get(current)!) if (!used.has(next) && !future.has(next) && !previous.has(next)) {
        previous.set(next, current); queue.push(next);
      }
    }
    return "NO_ORDERED_CORRIDOR";
  };
  const center = (index: number): GridPoint => ({ x: cells.get(index)!.x + cellSize / 2, y: cells.get(index)!.y + cellSize / 2 });
  const port = (a: number, b: number): GridPoint => ({ x: (center(a).x + center(b).x) / 2, y: (center(a).y + center(b).y) / 2 });
  const displayPoints = (path: number[], from: GridPoint, to: GridPoint): GridPoint[] => {
    const points: GridPoint[] = [];
    const append = (point: GridPoint) => {
      if (points.length && same(points.at(-1)!, point)) return;
      if (points.length >= 2) {
        const a = points.at(-2)!, b = points.at(-1)!;
        if ((a.x === b.x && b.x === point.x || a.y === b.y && b.y === point.y)
          && (b.x - a.x) * (point.x - b.x) + (b.y - a.y) * (point.y - b.y) >= 0) points.pop();
      }
      points.push(point);
    };
    append(from);
    if (path.length === 1) { append({ x: to.x, y: from.y }); append(to); return points; }
    const first = port(path[0]!, path[1]!);
    append(cells.get(path[0]!)!.column !== cells.get(path[1]!)!.column ? { x: from.x, y: first.y } : { x: first.x, y: from.y });
    append(first);
    for (let at = 1; at < path.length - 1; at++) { append(center(path[at]!)); append(port(path[at]!, path[at + 1]!)); }
    const last = points.at(-1)!;
    append(cells.get(path.at(-2)!)!.column !== cells.get(path.at(-1)!)!.column ? { x: to.x, y: last.y } : { x: last.x, y: to.y });
    append(to); return points;
  };
  const routeProjection = (route: IntercityRoadRoute): CountryRoadDisplayRoute | CountryRoadProjectionFailureReason => {
    const fromCity = cities.get(route.fromCityId), toCity = cities.get(route.toCityId);
    if (!fromCity || !toCity) return "MISSING_CITY";
    for (const city of [fromCity, toCity]) {
      const bounds = city.sourceBounds;
      if (!finite(city.atlasCenter) || !Object.values(bounds).every(Number.isSafeInteger) || bounds.minX > bounds.maxX || bounds.minY > bounds.maxY
        || city.miniature.cellSize !== WORLD_SAMPLE_STEP || ![city.miniature.columns, city.miniature.rows].every(value => Number.isFinite(value) && value > 0)) return "INVALID_CITY";
    }
    if (!route.id || route.fromCityId === route.toCityId || route.widthCells !== 3 || ![route.geometry.start.x, route.geometry.start.y].every(Number.isSafeInteger)
      || !route.geometry.runs.length) return "INVALID_GEOMETRY";
    if (route.geometry.runs.length > limits.maxWorldSteps) return "TOTAL_BUDGET";
    let length = 0, end = { ...route.geometry.start };
    for (const run of route.geometry.runs) {
      if (metrics.inputRuns >= limits.maxWorldSteps) return "TOTAL_BUDGET";
      metrics.inputRuns++;
      const delta = DELTAS[run.direction];
      if (!delta || !Number.isSafeInteger(run.length) || run.length <= 0) return "INVALID_GEOMETRY";
      length += run.length; end = { x: end.x + delta.x * run.length, y: end.y + delta.y * run.length };
      if (!Number.isSafeInteger(length) || ![end.x, end.y].every(Number.isSafeInteger)) return "INVALID_GEOMETRY";
    }
    if (metrics.worldSteps + length > limits.maxWorldSteps) return "TOTAL_BUDGET";
    metrics.worldSteps += length;
    const start = route.geometry.start;
    const inside = (point: GridPoint, city: CountryRoadCity) => point.x >= city.sourceBounds.minX && point.x <= city.sourceBounds.maxX
      && point.y >= city.sourceBounds.minY && point.y <= city.sourceBounds.maxY;
    if (!inside(start, fromCity) || !inside(end, toCity)) return "ENDPOINT_OUTSIDE_CITY";
    const from = countryRoadMiniaturePoint(fromCity, start), to = countryRoadMiniaturePoint(toCity, end);
    const first = cellAt(from), last = cellAt(to);
    if (first === undefined || last === undefined) return "ENDPOINT_OFF_LAND";
    if (same(from, to)) return "COLLAPSED_ENDPOINTS";
    if (components.get(first) !== components.get(last)) return "DISCONNECTED_LAND";
    const anchors = [first], positions = new Map([[first, 0]]);
    const addAnchor = (index: number): void => {
      const existing = positions.get(index);
      if (existing !== undefined) { while (anchors.length > existing + 1) positions.delete(anchors.pop()!); }
      else { positions.set(index, anchors.length); anchors.push(index); }
    };
    const sample = (point: GridPoint): CountryRoadProjectionFailureReason | undefined => {
      const result = project(point);
      if (typeof result === "string") return result;
      // Check before loop erasure: it must never conceal a jump to another island.
      if (components.get(result) !== components.get(first)) return "DISCONNECTED_LAND";
      addAnchor(result);
    };
    const initialError = sample(start); if (initialError) return initialError;
    let cursor = { ...start };
    for (const run of route.geometry.runs) {
      const delta = DELTAS[run.direction];
      for (let offset = Math.min(WORLD_SAMPLE_STEP, run.length); ; offset = Math.min(offset + WORLD_SAMPLE_STEP, run.length)) {
        const error = sample({ x: cursor.x + delta.x * offset, y: cursor.y + delta.y * offset });
        if (error) return error;
        if (offset === run.length) break;
      }
      cursor = { x: cursor.x + delta.x * run.length, y: cursor.y + delta.y * run.length };
    }
    addAnchor(last);
    const path = [anchors[0]!], used = new Set(path), future = new Set(anchors.slice(1));
    for (let at = 1; at < anchors.length; at++) {
      future.delete(anchors[at]!);
      const leg = findLeg(path.at(-1)!, anchors[at]!, used, future);
      if (typeof leg === "string") return leg;
      for (const index of leg.slice(1)) { path.push(index); used.add(index); }
    }
    const points = displayPoints(path, from, to);
    if (metrics.outputPoints + points.length > limits.maxOutputPoints || metrics.outputCells + path.length > limits.maxOutputCells) return "TOTAL_BUDGET";
    metrics.outputPoints += points.length; metrics.outputCells += path.length;
    return { routeId: route.id, fromCityId: route.fromCityId, toCityId: route.toCityId, fromNodeId: route.fromNodeId, toNodeId: route.toNodeId,
      points, cellIds: path.map(index => cells.get(index)!.id), anchorCellIds: anchors.map(index => cells.get(index)!.id) };
  };
  const routes: CountryRoadDisplayRoute[] = [], failures: CountryRoadProjectionFailure[] = [];
  for (const route of sourceRoutes) {
    const result = routeProjection(route);
    if (typeof result === "string") failures.push({ routeId: route.id, fromCityId: route.fromCityId, toCityId: route.toCityId, reason: result });
    else routes.push(result);
  }
  return { routes, failures, metrics };
}
