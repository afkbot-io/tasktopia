import { createHash } from "node:crypto";
import type { BlockWorldBounds, CityBlockV1 } from "../../shared/block-world";
import { decodeOrthogonalRoadRuns, encodeOrthogonalRoadPath, type GridPoint, type SemanticRoadNode } from "../../shared/semantic-road";
import { isBuildableTerrain, terrainAt } from "../../shared/world-terrain";
import type { IntercityRoadRoute } from "../../shared/intercity-roads";
export type { IntercityRoadRoute } from "../../shared/intercity-roads";

const GRID = 8;
const RADIUS = 2; // Three road cells and one clearance cell on either side.
const BUCKET = 64;
export type IntercityRoadCity = {
  id: string;
  /** Actual supplied layout nodes, not synthetic city-centre endpoints. */
  nodes: readonly SemanticRoadNode[];
  blocks: readonly Pick<CityBlockV1, "origin" | "width" | "height">[];
};
export type IntercityRoadFailure = { fromCityId: string; toCityId: string; reason: "NO_ENDPOINT" | "NO_PATH" | "ROUTE_BUDGET" | "TOTAL_BUDGET" };
export type IntercityRoadLimits = {
  searchMarginCells: number; maxVisitedPerRoute: number; maxTotalVisited: number;
  maxTerrainSamples: number; maxEndpointNodes: number; maxGeometrySteps: number;
};
export type IntercityRoadPlan = {
  countryId: string; seed: number; routes: IntercityRoadRoute[]; unreachable: IntercityRoadFailure[];
  /** Actual accepted connectivity, including isolated cities. Never implies a full country network. */
  components: string[][];
  metrics: { candidates: number; attemptedRoutes: number; retainedRoutes: number; visited: number; terrainSamples: number; edgeChecks: number };
};
export type IntercityRoadPlannerInput = {
  countryId: string; seed: number; cities: readonly IntercityRoadCity[];
  protectedSites?: readonly BlockWorldBounds[];
  previous?: Pick<IntercityRoadPlan, "countryId" | "seed" | "routes">;
  isBuildable?: (cell: GridPoint) => boolean;
  limits?: Partial<IntercityRoadLimits>;
  /** Read-only audit: validate retained roads and return their components,
   * without candidate generation or discovering/replacing any connection. */
  validateOnly?: boolean;
};
const DEFAULT_LIMITS: IntercityRoadLimits = { searchMarginCells: 128, maxVisitedPerRoute: 8000,
  maxTotalVisited: 32_000, maxTerrainSamples: 1_000_000, maxEndpointNodes: 64, maxGeometrySteps: 300_000 };
const key = (p: GridPoint) => `${p.x}:${p.y}`;
const distance = (a: GridPoint, b: GridPoint) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const pointIn = (p: GridPoint, b: BlockWorldBounds) => p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
type SearchNode = GridPoint & { heading: number; cost: number; score: number; order: number; previous?: SearchNode; startId: string };

/** Small search-local heap: no change to the legacy router's fallback policy. */
class Frontier {
  private items: SearchNode[] = [];
  get size() { return this.items.length; }
  private before(a: SearchNode, b: SearchNode) { return a.score < b.score || a.score === b.score && a.order < b.order; }
  push(node: SearchNode) {
    let i = this.items.length; this.items.push(node);
    while (i > 0) { const parent = (i - 1) >> 1;
      if (!this.before(node, this.items[parent]!)) break;
      this.items[i] = this.items[parent]!; i = parent;
    }
    this.items[i] = node;
  }
  pop(): SearchNode {
    const first = this.items[0]!, last = this.items.pop()!;
    if (this.items.length) {
      let i = 0;
      while (i * 2 + 1 < this.items.length) {
        let child = i * 2 + 1;
        if (child + 1 < this.items.length && this.before(this.items[child + 1]!, this.items[child]!)) child++;
        if (!this.before(this.items[child]!, last)) break;
        this.items[i] = this.items[child]!; i = child;
      }
      this.items[i] = last;
    }
    return first;
  }
}

/** Append-only bounded forest of proven land routes. NO_PATH describes only
 * the declared candidate endpoints and finite search window, not all geography.
 * This function neither persists a network nor projects/renders a country. */
export function planIntercityRoads(input: IntercityRoadPlannerInput): IntercityRoadPlan {
  if (!input.countryId || !Number.isSafeInteger(input.seed)) throw new Error("Intercity country and seed required");
  if (input.previous && (input.previous.countryId !== input.countryId || input.previous.seed !== input.seed)) throw new Error("Previous intercity country/seed mismatch");
  const limits = { ...DEFAULT_LIMITS, ...input.limits };
  for (const [name, value] of Object.entries(limits)) if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid intercity limit ${name}`);
  const metrics: IntercityRoadPlan["metrics"] = { candidates: 0, attemptedRoutes: 0, retainedRoutes: input.previous?.routes.length ?? 0,
    visited: 0, terrainSamples: 0, edgeChecks: 0 };
  const cities = [...input.cities].sort((a, b) => a.id.localeCompare(b.id));
  if (cities.length > 100) throw new Error("Intercity planner supports at most 100 cities");
  if (cities.reduce((sum, city) => sum + city.nodes.length, 0) > 100_000) throw new Error("Intercity nodes exceed input budget");
  const byId = new Map(cities.map(city => [city.id, city]));
  if (byId.size !== cities.length || cities.some(city => !city.id)) throw new Error("Duplicate or empty intercity city ID");
  const protection = new Map<string, BlockWorldBounds[]>();
  let protectedEntries = 0;
  const indexBounds = (bounds: BlockWorldBounds, insert: (key: string) => void) => {
    if (!Object.values(bounds).every(Number.isSafeInteger) || bounds.minX > bounds.maxX || bounds.minY > bounds.maxY) throw new Error("Invalid protected road bounds");
    const x0 = Math.floor(bounds.minX / BUCKET), x1 = Math.floor(bounds.maxX / BUCKET);
    const y0 = Math.floor(bounds.minY / BUCKET), y1 = Math.floor(bounds.maxY / BUCKET);
    protectedEntries += (x1 - x0 + 1) * (y1 - y0 + 1);
    if (protectedEntries > 100_000) throw new Error("Aggregate protected road index exceeds budget");
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      insert(`${x}:${y}`);
    }
  };
  const protect = (bounds: BlockWorldBounds) => indexBounds(bounds, cell => {
    const bucket = protection.get(cell) ?? []; bucket.push(bounds); protection.set(cell, bucket);
  });
  const coordinateOwners = new Set<string>();
  for (const city of cities) {
    const perimeterBuckets = new Map<string, BlockWorldBounds[]>();
    for (const block of city.blocks) {
      if (![block.origin.x, block.origin.y, block.width, block.height].every(Number.isSafeInteger)
        || block.width < 8 || block.height < 8) throw new Error("Invalid intercity block geometry");
      protect({ minX: block.origin.x + 3, minY: block.origin.y + 3,
        maxX: block.origin.x + block.width - 3, maxY: block.origin.y + block.height - 3 });
      const bounds = { minX: block.origin.x, minY: block.origin.y,
        maxX: block.origin.x + block.width, maxY: block.origin.y + block.height };
      indexBounds(bounds, cell => { const bucket = perimeterBuckets.get(cell) ?? []; bucket.push(bounds); perimeterBuckets.set(cell, bucket); });
    }
    const ids = new Set<string>();
    for (const node of city.nodes) {
      if (!node.id || ids.has(node.id)) throw new Error(`Duplicate intercity node in ${city.id}`);
      ids.add(node.id);
      if (![node.x, node.y].every(value => Number.isSafeInteger(value) && value % GRID === 0)) throw new Error("Intercity endpoint must use the 8-cell world grid");
      if (coordinateOwners.has(key(node))) throw new Error("Intercity node coordinate has more than one owner");
      coordinateOwners.add(key(node));
      if (city.blocks.length && !perimeterBuckets.get(`${Math.floor(node.x / BUCKET)}:${Math.floor(node.y / BUCKET)}`)?.some(bounds => pointIn(node, bounds)
        && (node.x === bounds.minX || node.x === bounds.maxX || node.y === bounds.minY || node.y === bounds.maxY))) {
        throw new Error("Intercity endpoint is not on a supplied block perimeter");
      }
    }
  }
  input.protectedSites?.forEach(protect);
  const dry = new Map<string, boolean>();
  let sampleBudgetExhausted = false;
  const isBuildable = input.isBuildable ?? ((cell: GridPoint) => isBuildableTerrain(terrainAt(input.seed, cell.x, cell.y).terrain));
  const cellOpen = (cell: GridPoint): boolean => {
    const id = key(cell), cached = dry.get(id);
    if (cached !== undefined) return cached;
    if (metrics.terrainSamples >= limits.maxTerrainSamples) { sampleBudgetExhausted = true; return false; }
    metrics.terrainSamples++;
    const blocked = protection.get(`${Math.floor(cell.x / BUCKET)}:${Math.floor(cell.y / BUCKET)}`)?.some(bounds => pointIn(cell, bounds));
    const result = !blocked && isBuildable(cell); dry.set(id, result); return result;
  };
  const pointOpen = (point: GridPoint) => {
    for (let dy = -RADIUS; dy <= RADIUS; dy++) for (let dx = -RADIUS; dx <= RADIUS; dx++) {
      if (!cellOpen({ x: point.x + dx, y: point.y + dy })) return false;
    }
    return true;
  };
  const edgeCache = new Map<string, boolean>();
  const edgeOpen = (from: GridPoint, to: GridPoint) => {
    const a = key(from), b = key(to), id = a < b ? `${a}/${b}` : `${b}/${a}`;
    const cached = edgeCache.get(id); if (cached !== undefined) return cached;
    metrics.edgeChecks++;
    for (let step = 0; step <= GRID; step++) {
      if (!pointOpen({ x: from.x + Math.sign(to.x - from.x) * step, y: from.y + Math.sign(to.y - from.y) * step })) {
        edgeCache.set(id, false); return false;
      }
    }
    edgeCache.set(id, true); return true;
  };
  const parents = new Map(cities.map(city => [city.id, city.id]));
  const root = (id: string): string => { const p = parents.get(id)!; if (p === id) return id; const result = root(p); parents.set(id, result); return result; };
  const join = (a: string, b: string) => parents.set(root(b), root(a));
  const components = () => {
    const groups = new Map<string, string[]>();
    for (const city of cities) { const id = root(city.id); const group = groups.get(id) ?? []; group.push(city.id); groups.set(id, group); }
    return [...groups.values()];
  };
  const routes = [...input.previous?.routes ?? []];
  if (routes.length > Math.max(0, cities.length - 1)) throw new Error("Previous intercity route count exceeds forest budget");
  let geometrySteps = 0;
  const routeIds = new Set<string>();
  for (const route of routes) {
    const a = byId.get(route.fromCityId)?.nodes.find(node => node.id === route.fromNodeId);
    const b = byId.get(route.toCityId)?.nodes.find(node => node.id === route.toNodeId);
    if (!a || !b || !route.id || route.fromCityId === route.toCityId || route.widthCells !== 3 || routeIds.has(route.id)) throw new Error("Invalid previous intercity endpoints");
    routeIds.add(route.id);
    const length = route.geometry.runs.reduce((sum, run) => sum + run.length, 0);
    geometrySteps += length;
    if (!Number.isSafeInteger(length) || !Number.isSafeInteger(geometrySteps) || geometrySteps > limits.maxGeometrySteps) throw new Error("Previous intercity geometry exceeds aggregate budget");
    if (root(route.fromCityId) === root(route.toCityId)) throw new Error("Previous intercity routes must form a forest");
    const path = decodeOrthogonalRoadRuns(route.geometry);
    if (key(path[0]!) !== key(a) || key(path.at(-1)!) !== key(b)) throw new Error("Previous intercity geometry/endpoints disagree");
    if (path.some(point => !pointOpen(point))) throw new Error(sampleBudgetExhausted ? "Previous intercity validation exceeds sample budget" : "Previous accepted road is obstructed; do not move it silently");
    join(route.fromCityId, route.toCityId);
  }
  if (input.validateOnly) return { countryId: input.countryId, seed: input.seed, routes,
    unreachable: [], components: components(), metrics };
  const centers = new Map(cities.map(city => [city.id, {
    x: city.nodes.reduce((sum, n) => sum + n.x, 0) / Math.max(1, city.nodes.length),
    y: city.nodes.reduce((sum, n) => sum + n.y, 0) / Math.max(1, city.nodes.length),
  }]));
  const pairs = new Map<string, { a: IntercityRoadCity; b: IntercityRoadCity; distance: number; tie: string }>();
  const addPair = (city: IntercityRoadCity, other: IntercityRoadCity, length: number) => {
    const [a, b] = city.id < other.id ? [city, other] : [other, city];
    const id = `${a.id}/${b.id}`;
    pairs.set(id, { a, b, distance: length, tie: digest(`${input.seed}/${id}`) });
  };
  for (const city of cities) {
    const nearest = cities.filter(other => other.id !== city.id).map(other => ({ other, distance: distance(centers.get(city.id)!, centers.get(other.id)!) }))
      .sort((a, b) => a.distance - b.distance || a.other.id.localeCompare(b.other.id)).slice(0, 4);
    for (const { other, distance: length } of nearest) addPair(city, other, length);
  }
  // Prim's geometric MST adds at most N-1 candidate pairs. It joins separated
  // nearest-four clusters, but is NOT a road: every pair still requires dry A*.
  if (cities.length) {
    const selected = new Set([cities[0]!.id]);
    const closest = new Map(cities.slice(1).map(city => [city.id, { from: cities[0]!,
      distance: distance(centers.get(cities[0]!.id)!, centers.get(city.id)!) }]));
    while (selected.size < cities.length) {
      let next: IntercityRoadCity | undefined;
      for (const city of cities) if (!selected.has(city.id) && (!next
        || closest.get(city.id)!.distance < closest.get(next.id)!.distance)) next = city;
      const edge = closest.get(next!.id)!;
      addPair(edge.from, next!, edge.distance); selected.add(next!.id);
      for (const city of cities) if (!selected.has(city.id)) {
        const length = distance(centers.get(next!.id)!, centers.get(city.id)!);
        const previous = closest.get(city.id)!;
        if (length < previous.distance || length === previous.distance && next!.id < previous.from.id) {
          closest.set(city.id, { from: next!, distance: length });
        }
      }
    }
  }
  const candidates = [...pairs.values()].sort((a, b) => a.distance - b.distance || a.tie.localeCompare(b.tie));
  metrics.candidates = candidates.length;
  const failures: IntercityRoadFailure[] = [];
  for (const { a, b, tie } of candidates) {
    if (root(a.id) === root(b.id)) continue;
    const fail = (reason: IntercityRoadFailure["reason"]) => failures.push({ fromCityId: a.id, toCityId: b.id, reason });
    if (metrics.visited >= limits.maxTotalVisited || sampleBudgetExhausted) { fail("TOTAL_BUDGET"); continue; }
    metrics.attemptedRoutes++;
    const endpoints = (city: IntercityRoadCity, target: GridPoint) => [...city.nodes]
      .sort((x, y) => distance(x, target) - distance(y, target) || x.id.localeCompare(y.id))
      .slice(0, limits.maxEndpointNodes).filter(pointOpen);
    const starts = endpoints(a, centers.get(b.id)!), ends = endpoints(b, centers.get(a.id)!);
    if (sampleBudgetExhausted) { fail("TOTAL_BUDGET"); continue; }
    if (!starts.length || !ends.length) { fail("NO_ENDPOINT"); continue; }
    const bounds = { minX: Math.min(...starts.map(p => p.x), ...ends.map(p => p.x)) - limits.searchMarginCells,
      maxX: Math.max(...starts.map(p => p.x), ...ends.map(p => p.x)) + limits.searchMarginCells,
      minY: Math.min(...starts.map(p => p.y), ...ends.map(p => p.y)) - limits.searchMarginCells,
      maxY: Math.max(...starts.map(p => p.y), ...ends.map(p => p.y)) + limits.searchMarginCells };
    const goal = { minX: Math.min(...ends.map(p => p.x)), maxX: Math.max(...ends.map(p => p.x)),
      minY: Math.min(...ends.map(p => p.y)), maxY: Math.max(...ends.map(p => p.y)) };
    const goalAt = new Map(ends.map(p => [key(p), p]));
    const heuristic = (p: GridPoint) => Math.max(goal.minX - p.x, 0, p.x - goal.maxX) + Math.max(goal.minY - p.y, 0, p.y - goal.maxY);
    const open = new Frontier(), best = new Map<string, number>();
    const state = (p: SearchNode) => `${key(p)}:${p.heading}`;
    let order = 0, visited = 0, found: SearchNode | undefined;
    for (const point of starts) { const entry = { x: point.x, y: point.y, cost: 0, score: heuristic(point), order: order++, startId: point.id, heading: -1 };
      open.push(entry); best.set(state(entry), 0); }
    const directions = [[GRID, 0], [0, GRID], [-GRID, 0], [0, -GRID]] as const;
    const offset = Number.parseInt(tie.slice(0, 2), 16) % 4;
    while (open.size && visited < limits.maxVisitedPerRoute && metrics.visited < limits.maxTotalVisited && !sampleBudgetExhausted) {
      const current = open.pop(); if (best.get(state(current)) !== current.cost) continue;
      visited++; metrics.visited++;
      if (goalAt.has(key(current))) { found = current; break; }
      for (let i = 0; i < 4; i++) {
        const heading = (i + offset) % 4, [dx, dy] = directions[heading]!;
        const point = { x: current.x + dx, y: current.y + dy };
        if (!pointIn(point, bounds) || !edgeOpen(current, point)) continue;
        const cost = current.cost + GRID + (current.heading >= 0 && current.heading !== heading ? 2 : 0);
        const next: SearchNode = { ...point, heading, cost, score: cost + heuristic(point), order: order++, previous: current, startId: current.startId };
        if (cost >= (best.get(state(next)) ?? Infinity)) continue;
        best.set(state(next), cost); open.push(next);
      }
    }
    if (!found) { fail(sampleBudgetExhausted || metrics.visited >= limits.maxTotalVisited ? "TOTAL_BUDGET" : visited >= limits.maxVisitedPerRoute ? "ROUTE_BUDGET" : "NO_PATH"); continue; }
    const coarse: GridPoint[] = [];
    for (let at: SearchNode | undefined = found; at; at = at.previous) coarse.push({ x: at.x, y: at.y });
    coarse.reverse();
    const path: GridPoint[] = [coarse[0]!];
    for (let i = 1; i < coarse.length; i++) for (let step = 1; step <= GRID; step++) path.push({
      x: coarse[i - 1]!.x + Math.sign(coarse[i]!.x - coarse[i - 1]!.x) * step,
      y: coarse[i - 1]!.y + Math.sign(coarse[i]!.y - coarse[i - 1]!.y) * step,
    });
    if (path.length < 2) { fail("NO_PATH"); continue; }
    if (geometrySteps + path.length - 1 > limits.maxGeometrySteps) { fail("TOTAL_BUDGET"); continue; }
    geometrySteps += path.length - 1;
    const geometry = encodeOrthogonalRoadPath(path), toNodeId = goalAt.get(key(found))!.id;
    routes.push({ id: `intercity:${digest(JSON.stringify([input.countryId, input.seed, a.id, b.id, found.startId, toNodeId, geometry])).slice(0, 24)}`,
      fromCityId: a.id, toCityId: b.id, fromNodeId: found.startId, toNodeId, widthCells: 3, geometry });
    join(a.id, b.id);
  }
  const unreachable = failures.filter(failure => root(failure.fromCityId) !== root(failure.toCityId));
  return { countryId: input.countryId, seed: input.seed, routes, unreachable, components: components(), metrics };
}
