import type { Cell, RoadCellDto } from "../shared/contracts";
import { roadBandRole } from "../shared/road-profile";

export const mobilityCellKey = (cell: Cell): string => `${cell.x},${cell.y}`;
export const MOBILITY_DIRECTIONS = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }] as const;
export type MobilityNetworkInput = {
  roads: ReadonlyMap<string, RoadCellDto>;
  walkGraph: ReadonlyMap<string, Cell>;
  crosswalks: ReadonlySet<string>;
  activityCells: ReadonlySet<string>;
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
};

export function mobilityNetworkSignature(input: MobilityNetworkInput): string {
  return JSON.stringify([
    [...input.roads].map(([key, cell]) => `${key}:${cell.roadClass}`).sort(),
    [...input.walkGraph.keys()].sort(), [...input.crosswalks].sort(), [...input.activityCells].sort(),
  ]);
}

/** Reachability includes heading: a route cannot bypass a first-edge ban with
 * A→B→A. One bounded search serves destination selection and path reconstruction. */
export function searchMobilityRoutes(graph: ReadonlyMap<string, Cell>, edges: ReadonlyMap<string, readonly Cell[]>, start: Cell, previous?: Cell) {
  const direction = (a: Cell, b: Cell) => b.x > a.x ? 1 : b.x < a.x ? 3 : b.y > a.y ? 2 : 0;
  type State = { cell: Cell; direction: number; previous: number };
  const initialDirection = previous ? direction(previous, start) : -1;
  const states: State[] = [{ cell: start, direction: initialDirection, previous: -1 }];
  const visited = new Set([`${mobilityCellKey(start)}:${initialDirection}`]);
  const reached = new Map<string, number>([[mobilityCellKey(start), 0]]);
  for (let index = 0; index < states.length && index < 8_000; index++) {
    const current = states[index]!;
    const candidates = [...edges.get(mobilityCellKey(current.cell)) ?? []].sort((a, b) =>
      Number(direction(current.cell, b) === current.direction) - Number(direction(current.cell, a) === current.direction));
    for (const cell of candidates) {
      const nextDirection = direction(current.cell, cell);
      if (current.direction >= 0 && nextDirection === (current.direction + 2) % 4) continue;
      const cellKey = mobilityCellKey(cell), stateKey = `${cellKey}:${nextDirection}`;
      if (!graph.has(cellKey) || visited.has(stateKey)) continue;
      visited.add(stateKey);
      if (!reached.has(cellKey)) reached.set(cellKey, states.length);
      states.push({ cell, direction: nextDirection, previous: index });
    }
  }
  return {
    cells: [...reached.keys()].map(key => graph.get(key)!),
    routeTo(target: Cell): Cell[] {
      const targetIndex = reached.get(mobilityCellKey(target));
      if (targetIndex === undefined) return [];
      let index: number = targetIndex;
      const route: Cell[] = [];
      while (index >= 0) { const state: State = states[index]!; route.push(state.cell); index = state.previous; }
      return route.reverse();
    },
  };
}

/** Pick stable narrow walking routes inside broad paved areas. Only redundant
 * boundary pixels of 2×2 patches are removed, with local four-connectivity
 * preserved. Actual crossings, curb paths and task access points are retained.
 * This is navigation geometry, not a modification of the rendered sidewalk. */
export function buildWalkingSpine(input: MobilityNetworkInput): Map<string, Cell> {
  const cells = new Map([...input.walkGraph].filter(([key]) => !input.roads.has(key) || input.crosswalks.has(key))
    .sort(([a], [b]) => a.localeCompare(b)));
  const originalCore = new Set(cells.keys());
  const coreDegrees = new Map([...cells].map(([cellKey, cell]) => [cellKey, MOBILITY_DIRECTIONS.filter(d => cells.has(`${cell.x + d.x},${cell.y + d.y}`)).length]));
  const tails = [...coreDegrees].filter(([, degree]) => degree < 2).map(([cellKey]) => cellKey);
  for (let i = 0; i < tails.length; i++) {
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
  const protectedCells = new Set([...input.crosswalks, ...input.activityCells]);
  for (const [cellKey, cell] of cells) if (MOBILITY_DIRECTIONS.some(d => input.roads.has(`${cell.x + d.x},${cell.y + d.y}`))) protectedCells.add(cellKey);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [cellKey, cell] of cells) {
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
  return cells;
}

/** Compile topology only when geography changes, never on an animation frame. */
export function buildMobilityNetwork(input: MobilityNetworkInput): MobilityNetwork {
  const orderedRoads = new Map([...input.roads].sort(([a], [b]) => a.localeCompare(b)));
  const roles = new Map([...orderedRoads].map(([key, cell]) => [key, roadBandRole(orderedRoads, cell)]));
  const carEdges = new Map<string, Cell[]>();
  const neighbors = (cell: Cell) => MOBILITY_DIRECTIONS.map(delta => ({ x: cell.x + delta.x, y: cell.y + delta.y }));
  for (const [key, cell] of orderedRoads) {
    const role = roles.get(key)!;
    if (role.kind !== "TRAVEL" && role.kind !== "JUNCTION") continue;
    carEdges.set(key, neighbors(cell).filter(next => {
      const nextRole = roles.get(mobilityCellKey(next));
      if (!nextRole || nextRole.kind !== "TRAVEL" && nextRole.kind !== "JUNCTION") return false;
      const dx = next.x - cell.x, dy = next.y - cell.y;
      return (role.kind === "JUNCTION" || role.dx === dx && role.dy === dy)
        && (nextRole.kind === "JUNCTION" || nextRole.dx === dx && nextRole.dy === dy);
    }));
  }
  // Trim true road tails; no car may be born with an inevitable graph dead end.
  const predecessors = new Map([...carEdges.keys()].map(key => [key, new Set<string>()]));
  for (const [key, next] of carEdges) for (const cell of next) predecessors.get(mobilityCellKey(cell))?.add(key);
  const queue = [...carEdges.keys()].filter(key => !carEdges.get(key)!.length || !predecessors.get(key)!.size);
  for (let index = 0; index < queue.length; index++) {
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
  const cars = new Map([...orderedRoads].filter(([key]) => carEdges.has(key)));
  const walkers = buildWalkingSpine(input);
  const walkerEdges = new Map([...walkers].map(([key, cell]) => [key, neighbors(cell).filter(next => walkers.has(mobilityCellKey(next)))]));
  // A one-cell-wide blind spur has no safe turnaround lane. Ambient walkers
  // use the connected walkable core; do not spawn them in inevitable dead ends.
  const walkTails = [...walkerEdges].filter(([, next]) => next.length < 2).map(([key]) => key);
  for (let index = 0; index < walkTails.length; index++) {
    const tail = walkTails[index]!;
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
  for (const [key, cell] of orderedRoads) if (roles.get(key)?.kind === "JUNCTION" || input.crosswalks.has(key)) conflict.set(key, cell);
  // The curb junction and pedestrian corner are part of the manoeuvre too.
  // Reserving only asphalt strands a turning person between through walkers:
  // the rotated body can no longer fit when reaching the unreserved curb.
  for (const [key, cell] of walkers) {
    const next = walkerEdges.get(key)!;
    const straight = next.length === 2 && next[0]!.x + next[1]!.x === cell.x * 2 && next[0]!.y + next[1]!.y === cell.y * 2;
    if (!straight) conflict.set(key, cell);
  }
  const visited = new Set<string>(), zones: MobilityZone[] = [], zoneByCell = new Map<string, MobilityZone>();
  for (const [seedKey, seed] of conflict) {
    if (visited.has(seedKey)) continue;
    const cells: Cell[] = [], pending = [seed];
    visited.add(seedKey);
    for (let index = 0; index < pending.length; index++) {
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
      const fromKey = mobilityCellKey(from);
      if (zoneCells.has(fromKey) || !carEdges.get(fromKey)?.some(next => next.x === cell.x && next.y === cell.y)) continue;
      incomingApproaches.add(cell.x > from.x ? "W" : cell.x < from.x ? "E" : cell.y > from.y ? "N" : "S");
    }
    const zone: MobilityZone = { id: `${minX},${minY}:${maxX},${maxY}`, cells: zoneCells, bounds,
      signalPosts: roadZone ? posts.filter(post => incomingApproaches.has(post.approach) && !input.roads.has(mobilityCellKey(post.origin))) : [] };
    zones.push(zone);
    for (const cell of cells) zoneByCell.set(mobilityCellKey(cell), zone);
  }
  return { signature: mobilityNetworkSignature(input), roads: orderedRoads, cars, walkers, carEdges, walkerEdges, zones, zoneByCell, activityCells: new Set(input.activityCells) };
}
