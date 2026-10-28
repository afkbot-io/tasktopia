import { createMobilityRouteSearch } from "./mobility-route-search";
import { completePreparation, prepareCooperatively, stableSortPreparation, type CooperativePreparationOptions } from "./cooperative-preparation";
import type { CityParkingPlan } from "./city-parking";
import type { Cell, RoadCellDto } from "../shared/contracts";
import { roadBandRole } from "../shared/road-profile";

export const mobilityCellKey = (cell: Cell): string => `${cell.x},${cell.y}`;
// Local cheap loops cooperate in bounded batches; delegated sorts retain
// their own checkpoints, so native sort runs are never multiplied here.
const NETWORK_CHECKPOINT_BATCH = 16;
export const MOBILITY_DIRECTIONS = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }] as const;
export type MobilityNetworkInput = {
  parking?: readonly CityParkingPlan[];
  roads: ReadonlyMap<string, RoadCellDto>;
  walkGraph: ReadonlyMap<string, Cell>;
  crosswalks: ReadonlySet<string>;
  activityCells: ReadonlySet<string>;
  buildingEntrances?: ReadonlySet<string>;
  /** Authored outdoor doors/gangways allow a physical turnaround after waiting. */
  transferCells?: ReadonlySet<string>;
};
export type MobilityZone = {
  id: string;
  cells: ReadonlySet<string>;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  signalPosts: Array<{ origin: Cell; axis: "H" | "V"; approach: "N" | "E" | "S" | "W" }>;
};
export type MobilityNetwork = {
  signature: string;
  roads: ReadonlyMap<string, RoadCellDto>;
  cars: Map<string, Cell>;
  walkers: Map<string, Cell>;
  carEdges: Map<string, Cell[]>;
  walkerEdges: Map<string, Cell[]>;
  zones: MobilityZone[];
  zoneByCell: Map<string, MobilityZone>;
  activityCells: ReadonlySet<string>;
  buildingEntrances: ReadonlySet<string>;
  transferCells: ReadonlySet<string>;
  parkingBays: ReadonlySet<string>;
};

export function mobilityNetworkSignature(input: MobilityNetworkInput): string {
  return completePreparation(mobilityNetworkSignatureSteps(input));
}
function* mobilityNetworkSignatureSteps(input: MobilityNetworkInput): Generator<void, string, void> {
  const roadKeys: string[] = [];
  for (const [key, cell] of input.roads) { roadKeys.push(`${key}:${cell.roadClass}`); yield; }
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  const roads = yield* stableSortPreparation(roadKeys, compare);
  const walking = yield* stableSortPreparation(input.walkGraph.keys(), compare);
  const crossings = yield* stableSortPreparation(input.crosswalks, compare);
  const activities = yield* stableSortPreparation(input.activityCells, compare);
  const parking: unknown[] = [];
  for (const plan of input.parking ?? []) { parking.push([plan.id, plan.route, plan.bay]); yield; }
  const entrances = yield* stableSortPreparation(input.buildingEntrances ?? [], compare);
  const transfers = yield* stableSortPreparation(input.transferCells ?? [], compare);
  return JSON.stringify([roads, walking, crossings, activities, parking, entrances, transfers]);
}

/** One-shot utility; the live controller retains the compiled topology. */
export function searchMobilityRoutes(graph: ReadonlyMap<string, Cell>, edges: ReadonlyMap<string, readonly Cell[]>, start: Cell, previous?: Cell) {
  return createMobilityRouteSearch(graph, edges)(start, previous);
}

/** Pick stable narrow walking routes inside broad paved areas. Only redundant
 * boundary pixels of 2×2 patches are removed, with local four-connectivity
 * preserved. Actual crossings, curb paths and task access points are retained.
 * This is navigation geometry, not a modification of the rendered sidewalk. */
export function buildWalkingSpine(input: MobilityNetworkInput): Map<string, Cell> {
  return completePreparation(buildWalkingSpineSteps(input));
}
function* buildWalkingSpineSteps(input: MobilityNetworkInput): Generator<void, Map<string, Cell>, void> {
  let work = 0;
  const entries: Array<[string, Cell]> = [];
  for (const entry of input.walkGraph) { if (!input.roads.has(entry[0]) || input.crosswalks.has(entry[0])) entries.push(entry); if (++work === NETWORK_CHECKPOINT_BATCH) { work = 0; yield; } }
  const ordered = yield* stableSortPreparation(entries, ([a], [b]) => a.localeCompare(b));
  const cells = new Map<string, Cell>();
  for (const [id, cell] of ordered) { cells.set(id, cell); if (++work === NETWORK_CHECKPOINT_BATCH) { work = 0; yield; } }
  const originalCore = new Set<string>(), coreDegrees = new Map<string, number>(), tails: string[] = [];
  for (const [cellKey, cell] of cells) {
    originalCore.add(cellKey);
    const degree = MOBILITY_DIRECTIONS.filter(d => cells.has(`${cell.x + d.x},${cell.y + d.y}`)).length;
    coreDegrees.set(cellKey, degree); if (degree < 2) tails.push(cellKey); if (++work === NETWORK_CHECKPOINT_BATCH) { work = 0; yield; }
  }
  for (let i = 0; i < tails.length; i++) {
    if (++work === NETWORK_CHECKPOINT_BATCH) { work = 0; yield; }
    const cellKey = tails[i]!;
    if (!originalCore.delete(cellKey)) continue;
    const cell = cells.get(cellKey)!;
    for (const delta of MOBILITY_DIRECTIONS) {
      const nextKey = `${cell.x + delta.x},${cell.y + delta.y}`;
      if (!originalCore.has(nextKey)) continue;
      const degree = coreDegrees.get(nextKey)! - 1;
      coreDegrees.set(nextKey, degree); if (degree < 2) tails.push(nextKey);
    }
  }
  const protectedCells = new Set<string>();
  for (const source of [input.crosswalks, input.activityCells, input.buildingEntrances ?? [], input.transferCells ?? []]) for (const id of source) { protectedCells.add(id); if (++work === NETWORK_CHECKPOINT_BATCH) { work = 0; yield; } }
  for (const [cellKey, cell] of cells) { if (MOBILITY_DIRECTIONS.some(d => input.roads.has(`${cell.x + d.x},${cell.y + d.y}`))) protectedCells.add(cellKey); if (++work === NETWORK_CHECKPOINT_BATCH) { work = 0; yield; } }
  let changed = true;
  while (changed) {
    changed = false;
    for (const [cellKey, cell] of cells) {
      if (++work === NETWORK_CHECKPOINT_BATCH) { work = 0; yield; }
      if (protectedCells.has(cellKey)) continue;
      const neighbors = MOBILITY_DIRECTIONS.map(d => ({ x: cell.x + d.x, y: cell.y + d.y })).filter(c => cells.has(mobilityCellKey(c)));
      if (neighbors.length < 2 || neighbors.length === 4) continue;
      // Do not collapse a usable walking loop into a blind spur: ambient
      // routes cannot reverse on a one-cell lane, so their two-core matters.
      if (originalCore.has(cellKey) && neighbors.some(next => originalCore.has(mobilityCellKey(next))
        && MOBILITY_DIRECTIONS.filter(d => { const k = `${next.x + d.x},${next.y + d.y}`; return originalCore.has(k) && cells.has(k); }).length < 3)) continue;
      const square = [-1, 1].some(dx => [-1, 1].some(dy => cells.has(`${cell.x + dx},${cell.y}`)
        && cells.has(`${cell.x},${cell.y + dy}`) && cells.has(`${cell.x + dx},${cell.y + dy}`)));
      if (!square) continue;
      const reached = new Set([mobilityCellKey(neighbors[0]!)]), pending = [neighbors[0]!];
      for (let i = 0; i < pending.length; i++) for (const delta of MOBILITY_DIRECTIONS) {
        const next = { x: pending[i]!.x + delta.x, y: pending[i]!.y + delta.y }, nextKey = mobilityCellKey(next);
        if (nextKey === cellKey || Math.abs(next.x - cell.x) > 1 || Math.abs(next.y - cell.y) > 1 || reached.has(nextKey) || !cells.has(nextKey)) continue;
        reached.add(nextKey); pending.push(next);
      }
      if (!neighbors.every(next => reached.has(mobilityCellKey(next)))) continue;
      cells.delete(cellKey); changed = true;
    }
  }
  // The caller starts another bounded loop. Flush a partial child batch so
  // its remaining work cannot be added to the parent's next sixteen cells.
  if (work) yield;
  return cells;
}

/** Compile topology only when geography changes, never on an animation frame. */
export function buildMobilityNetwork(input: MobilityNetworkInput): MobilityNetwork {
  return completePreparation(buildMobilityNetworkSteps(input));
}
export function buildMobilityNetworkAsync(input: MobilityNetworkInput, options: CooperativePreparationOptions = {}): Promise<MobilityNetwork> {
  return prepareCooperatively(buildMobilityNetworkSteps(input), options);
}
/** Shared canonical steps also prepare the live controller's route indexes. */
export function* buildMobilityNetworkSteps(input: MobilityNetworkInput): Generator<void, MobilityNetwork, void> {
  let work = 0;
  const ordered = yield* stableSortPreparation(input.roads, ([a], [b]) => a.localeCompare(b));
  const orderedRoads = new Map<string, RoadCellDto>();
  for (const [id, cell] of ordered) { orderedRoads.set(id, cell); if (++work === NETWORK_CHECKPOINT_BATCH) { work = 0; yield; } }
  const roles = new Map<string, ReturnType<typeof roadBandRole>>();
  for (const [id, cell] of orderedRoads) { roles.set(id, roadBandRole(orderedRoads, cell)); if (++work === NETWORK_CHECKPOINT_BATCH) { work = 0; yield; } }
  const carEdges = new Map<string, Cell[]>();
  const neighbors = (cell: Cell) => MOBILITY_DIRECTIONS.map(delta => ({ x: cell.x + delta.x, y: cell.y + delta.y }));
  // Generated adjacency targets are immutable plain coordinates. Share each
  // retained point across incoming edges without aliasing authored DTOs or
  // retaining a second coordinate index in the completed network.
  const adjacencyPoints = new Map<string, Cell>();
  const shareNeighbor = (cell: Cell): Cell => {
    const id = mobilityCellKey(cell), existing = adjacencyPoints.get(id);
    if (existing) return existing;
    adjacencyPoints.set(id, cell); return cell;
  };
  for (const [key, cell] of orderedRoads) {
    if (++work === NETWORK_CHECKPOINT_BATCH) { work = 0; yield; }
    const role = roles.get(key)!;
    if (role.kind !== "TRAVEL" && role.kind !== "JUNCTION") continue;
    carEdges.set(key, neighbors(cell).filter(next => {
      const nextRole = roles.get(mobilityCellKey(next));
      if (!nextRole || nextRole.kind !== "TRAVEL" && nextRole.kind !== "JUNCTION") return false;
      const dx = next.x - cell.x, dy = next.y - cell.y;
      return (role.kind === "JUNCTION" || role.dx === dx && role.dy === dy)
        && (nextRole.kind === "JUNCTION" || nextRole.dx === dx && nextRole.dy === dy);
    }).map(shareNeighbor));
  }
  const carCells = new Map<string, Cell>();
  for (const [id, cell] of orderedRoads) { carCells.set(id, cell); if (++work === NETWORK_CHECKPOINT_BATCH) { work = 0; yield; } }
  const parkingBays=new Set<string>();
  for(const plan of input.parking??[]) {
    if (++work === NETWORK_CHECKPOINT_BATCH) { work = 0; yield; }
    if(!carEdges.has(mobilityCellKey(plan.route[0]!))||!carEdges.has(mobilityCellKey(plan.route.at(-1)!)))continue;
    parkingBays.add(mobilityCellKey(plan.bay));
    for(let i=0;i<plan.route.length-1;i++) {
      if (++work === NETWORK_CHECKPOINT_BATCH) { work = 0; yield; }
      const cell=plan.route[i]!,next=plan.route[i+1]!,id=mobilityCellKey(cell);
      carCells.set(id,cell);
      carEdges.set(id,[...(carEdges.get(id)??[]),next]);
    }
  }
  // Trim true road tails; no car may be born with an inevitable graph dead end.
  const predecessors = new Map<string, Set<string>>();
  for (const id of carEdges.keys()) { predecessors.set(id, new Set()); if (++work === NETWORK_CHECKPOINT_BATCH) { work = 0; yield; } }
  for (const [key, next] of carEdges) for (const cell of next) { predecessors.get(mobilityCellKey(cell))?.add(key); if (++work === NETWORK_CHECKPOINT_BATCH) { work = 0; yield; } }
  const queue: string[] = [];
  for (const id of carEdges.keys()) { if (!carEdges.get(id)!.length || !predecessors.get(id)!.size) queue.push(id); if (++work === NETWORK_CHECKPOINT_BATCH) { work = 0; yield; } }
  for (let index = 0; index < queue.length; index++) {
    if (++work === NETWORK_CHECKPOINT_BATCH) { work = 0; yield; }
    const key = queue[index]!;
    if (!carEdges.has(key)) continue;
    for (const cell of carEdges.get(key)!) {
      const next = mobilityCellKey(cell);
      predecessors.get(next)?.delete(key);
      if (carEdges.has(next) && !predecessors.get(next)!.size) queue.push(next);
    }
    carEdges.delete(key);
    for (const previous of predecessors.get(key) ?? []) {
      if (!carEdges.has(previous)) continue;
      const remaining = carEdges.get(previous)!.filter(cell => mobilityCellKey(cell) !== key);
      carEdges.set(previous, remaining);
      if (!remaining.length) queue.push(previous);
    }
  }
  const cars = new Map<string, Cell>();
  for (const [id, cell] of carCells) { if (carEdges.has(id)) cars.set(id, cell); if (++work === NETWORK_CHECKPOINT_BATCH) { work = 0; yield; } }
  for (const bay of parkingBays) { if (!cars.has(bay)) parkingBays.delete(bay); if (++work === NETWORK_CHECKPOINT_BATCH) { work = 0; yield; } }
  const walkingInput = new Map<string, Cell>();
  for (const [id, cell] of input.walkGraph) { if (!parkingBays.has(id)) walkingInput.set(id, cell); if (++work === NETWORK_CHECKPOINT_BATCH) { work = 0; yield; } }
  if (work) { work = 0; yield; }
  const walkers = yield* buildWalkingSpineSteps({ ...input, walkGraph: walkingInput });
  const walkerEdges = new Map<string, Cell[]>();
  for (const [id, cell] of walkers) { walkerEdges.set(id, neighbors(cell).filter(next => walkers.has(mobilityCellKey(next))).map(shareNeighbor)); if (++work === NETWORK_CHECKPOINT_BATCH) { work = 0; yield; } }
  adjacencyPoints.clear();
  const buildingEntrances = new Set<string>(), transferCells = new Set<string>();
  for (const id of input.buildingEntrances ?? []) { if (walkers.has(id) && !input.roads.has(id) && !input.crosswalks.has(id)) buildingEntrances.add(id); if (++work === NETWORK_CHECKPOINT_BATCH) { work = 0; yield; } }
  for (const id of input.transferCells ?? []) { if (walkers.has(id) && !input.roads.has(id) && !input.crosswalks.has(id)) transferCells.add(id); if (++work === NETWORK_CHECKPOINT_BATCH) { work = 0; yield; } }
  // A one-cell-wide blind spur has no safe turnaround lane. Ambient walkers
  // use the connected walkable core; do not spawn them in inevitable dead ends.
  const walkTails: string[] = [];
  for (const [id, next] of walkerEdges) { if (next.length < 2) walkTails.push(id); if (++work === NETWORK_CHECKPOINT_BATCH) { work = 0; yield; } }
  for (let index = 0; index < walkTails.length; index++) {
    if (++work === NETWORK_CHECKPOINT_BATCH) { work = 0; yield; }
    const tail = walkTails[index]!;
    // A real building is a destination with an indoor turnaround, not an
    // unusable blind alley. Preserve its approach all the way to the core.
    if (buildingEntrances.has(tail) || transferCells.has(tail)) continue;
    if (!walkerEdges.has(tail)) continue;
    for (const cell of walkerEdges.get(tail)!) {
      const neighbor = mobilityCellKey(cell), remaining = (walkerEdges.get(neighbor) ?? []).filter(cell => mobilityCellKey(cell) !== tail);
      if (walkerEdges.has(neighbor)) { walkerEdges.set(neighbor, remaining); if (remaining.length < 2) walkTails.push(neighbor); }
    }
    walkerEdges.delete(tail); walkers.delete(tail);
  }
  // Connected junction/crosswalk cells are ONE conflict resource. A crossing
  // touching a box cannot issue independent, contradictory admission permits.
  const conflict = new Map<string, Cell>();
  for (const [key, cell] of orderedRoads) { if (roles.get(key)?.kind === "JUNCTION" || input.crosswalks.has(key)) conflict.set(key, cell); if (++work === NETWORK_CHECKPOINT_BATCH) { work = 0; yield; } }
  // The curb junction and pedestrian corner are part of the manoeuvre too.
  // Reserving only asphalt strands a turning person between through walkers:
  // the rotated body can no longer fit when reaching the unreserved curb.
  for (const [key, cell] of walkers) {
    if (++work === NETWORK_CHECKPOINT_BATCH) { work = 0; yield; }
    const next = walkerEdges.get(key)!;
    const straight = next.length === 2 && next[0]!.x + next[1]!.x === cell.x * 2 && next[0]!.y + next[1]!.y === cell.y * 2;
    if (!straight && !transferCells.has(key) && !(next.length === 1 && buildingEntrances.has(key))) conflict.set(key, cell);
  }
  // The same reservations guard both curb crossings and the parking aisle.
  // A bay is a safe destination outside the entrance/exit conflict resources.
  for(const plan of input.parking??[])for(const cell of plan.route) {
    if (++work === NETWORK_CHECKPOINT_BATCH) { work = 0; yield; }
    const id=mobilityCellKey(cell);
    if(cars.has(id)&&!parkingBays.has(id))conflict.set(id,cell);
  }
  const visited = new Set<string>(), zones: MobilityZone[] = [], zoneByCell = new Map<string, MobilityZone>();
  for (const [seedKey, seed] of conflict) {
    if (++work === NETWORK_CHECKPOINT_BATCH) { work = 0; yield; }
    if (visited.has(seedKey)) continue;
    const cells: Cell[] = [], pending = [seed];
    visited.add(seedKey);
    for (let index = 0; index < pending.length; index++) {
      if (++work === NETWORK_CHECKPOINT_BATCH) { work = 0; yield; }
      const cell = pending[index]!; cells.push(cell);
      for (const next of neighbors(cell)) {
        const key = mobilityCellKey(next);
        if (conflict.has(key) && !visited.has(key)) { visited.add(key); pending.push(next); }
      }
    }
    const bounds = { minX: Math.min(...cells.map(c => c.x)), minY: Math.min(...cells.map(c => c.y)), maxX: Math.max(...cells.map(c => c.x)), maxY: Math.max(...cells.map(c => c.y)) };
    const { minX, minY, maxX, maxY } = bounds;
    const posts: MobilityZone["signalPosts"] = [
      { origin: { x: minX - 1, y: minY - 1 }, axis: "V", approach: "N" },
      { origin: { x: maxX + 1, y: minY - 1 }, axis: "H", approach: "E" },
      { origin: { x: maxX + 1, y: maxY + 1 }, axis: "V", approach: "S" },
      { origin: { x: minX - 1, y: maxY + 1 }, axis: "H", approach: "W" },
    ];
    const roadZone = cells.some(cell => input.roads.has(mobilityCellKey(cell)));
    const zoneCells = new Set(cells.map(mobilityCellKey));
    const incomingApproaches = new Set<MobilityZone["signalPosts"][number]["approach"]>();
    // Presentation follows actual directed entrances, not the four corners of
    // an arbitrary bounding box. A straight crossing has only two approaches.
    for (const cell of cells) for (const from of neighbors(cell)) {
      if (++work === NETWORK_CHECKPOINT_BATCH) { work = 0; yield; }
      const fromKey = mobilityCellKey(from);
      if (zoneCells.has(fromKey) || !carEdges.get(fromKey)?.some(next => next.x === cell.x && next.y === cell.y)) continue;
      incomingApproaches.add(cell.x > from.x ? "W" : cell.x < from.x ? "E" : cell.y > from.y ? "N" : "S");
    }
    const zone: MobilityZone = { id: `${minX},${minY}:${maxX},${maxY}`, cells: zoneCells, bounds,
      signalPosts: roadZone ? posts.filter(post => incomingApproaches.has(post.approach) && !input.roads.has(mobilityCellKey(post.origin))) : [] };
    zones.push(zone);
    for (const cell of cells) { zoneByCell.set(mobilityCellKey(cell), zone); if (++work === NETWORK_CHECKPOINT_BATCH) { work = 0; yield; } }
  }
  if (work) { work = 0; yield; }
  const signature = yield* mobilityNetworkSignatureSteps(input);
  yield; // Signature serialization is its own atomic phase, before activity cells.
  const activityCells = new Set<string>();
  for (const id of input.activityCells) { activityCells.add(id); if (++work === NETWORK_CHECKPOINT_BATCH) { work = 0; yield; } }
  return { signature, roads: orderedRoads, cars, walkers, carEdges, walkerEdges, zones, zoneByCell, activityCells, buildingEntrances, transferCells, parkingBays };
}
