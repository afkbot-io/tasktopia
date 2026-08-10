import type { Cell } from "../shared/contracts";

export function agentCellKey(cell: Cell): string { return `${cell.x},${cell.y}`; }

const DIRECTIONS = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }] as const;
export type AgentEdges = ReadonlyMap<string, readonly Cell[]>;
export type VehiclePresentation = {
  view: "horizontal" | "north" | "south";
  scaleX: number;
  scaleY: number;
};

/**
 * Vehicle source art has three authored directions: east, north and south.
 * West is the only mirrored direction. North and south are never flipped
 * because their front/rear silhouettes contain different information.
 * Keeping this mapping pure prevents render code and asset metadata from
 * silently disagreeing about which way a vehicle is facing.
 */
export function vehiclePresentation(current: Cell, next: Cell, scale = 0.9): VehiclePresentation {
  const horizontal = next.x !== current.x;
  return {
    view: horizontal ? "horizontal" : next.y < current.y ? "north" : "south",
    scaleX: horizontal && next.x < current.x ? -scale : scale,
    scaleY: scale,
  };
}

function rightHandLaneInset(from: Cell, to: Cell, inset: number): { x: number; y: number } {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  if (dx > 0) return { x: 0, y: -inset };
  if (dx < 0) return { x: 0, y: inset };
  if (dy > 0) return { x: inset, y: 0 };
  if (dy < 0) return { x: -inset, y: 0 };
  return { x: 0, y: 0 };
}

/** Pixel position on the inner half of a right-hand lane, blended at turns. */
export function vehicleLanePosition(
  current: Cell,
  next: Cell,
  progress: number,
  previous?: Cell,
  cellSize = 8,
  inset = 1,
): { x: number; y: number } {
  const clamped = Math.max(0, Math.min(1, progress));
  const startInset = previous ? rightHandLaneInset(previous, current, inset) : rightHandLaneInset(current, next, inset);
  const endInset = rightHandLaneInset(current, next, inset);
  return {
    x: (current.x + (next.x - current.x) * clamped) * cellSize + cellSize / 2
      + startInset.x * (1 - clamped) + endInset.x * clamped,
    y: (current.y + (next.y - current.y) * clamped) * cellSize + cellSize / 2
      + startInset.y * (1 - clamped) + endInset.y * clamped,
  };
}

export function isAgentEdgeAllowed(current: Cell, next: Cell, outgoing?: AgentEdges): boolean {
  return !outgoing || Boolean(outgoing.get(agentCellKey(current))?.some((candidate) => agentCellKey(candidate) === agentCellKey(next)));
}

function directedNeighbors(graph: ReadonlyMap<string, Cell>, cell: Cell, outgoing?: AgentEdges): Cell[] {
  return outgoing ? [...outgoing.get(agentCellKey(cell)) ?? []] : adjacentGraphCells(graph, cell);
}

function axisRun(graph: ReadonlyMap<string, Cell>, cell: Cell, dx: number, dy: number): number {
  let length = 0;
  for (const sign of [-1, 1]) {
    for (let step = 1; step <= 8; step += 1) {
      if (!graph.has(agentCellKey({ x: cell.x + dx * step * sign, y: cell.y + dy * step * sign }))) break;
      length += 1;
    }
  }
  return length;
}

function contiguousBand(graph: ReadonlyMap<string, Cell>, cell: Cell, horizontal: boolean): { min: number; max: number } {
  const coordinate = horizontal ? cell.y : cell.x;
  let min = coordinate;
  let max = coordinate;
  for (const sign of [-1, 1]) {
    for (let step = 1; step <= 6; step += 1) {
      const candidate = horizontal
        ? { x: cell.x, y: cell.y + step * sign }
        : { x: cell.x + step * sign, y: cell.y };
      if (!graph.has(agentCellKey(candidate))) break;
      if (sign < 0) min = coordinate - step;
      else max = coordinate + step;
    }
  }
  return { min, max };
}

type Lane = { axis: "H" | "V" | "J"; dx: number; dy: number };

export type TrafficArm = "N" | "E" | "S" | "W";
export type TrafficJunction = {
  id: string;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  cells: Cell[];
  arms: TrafficArm[];
  signalPosts: Array<{ origin: Cell; axis: "H" | "V"; approach: TrafficArm }>;
};
export type TrafficSignalPhase = { horizontal: "RED" | "GREEN"; vertical: "RED" | "GREEN" };

function directionalRun(graph: ReadonlyMap<string, Cell>, cell: Cell, dx: number, dy: number): number {
  let length = 0;
  for (let step = 1; step <= 12; step += 1) {
    if (!graph.has(agentCellKey({ x: cell.x + dx * step, y: cell.y + dy * step }))) break;
    length += 1;
  }
  return length;
}

/**
 * Collapse the asphalt overlap of every genuine T/X crossing into one logical
 * junction. Requiring a four-cell arm beyond the overlap deliberately rejects
 * both ordinary bends and the transverse thickness of a four-lane avenue.
 */
export function detectTrafficJunctions(graph: ReadonlyMap<string, Cell>): TrafficJunction[] {
  const seeds = new Map<string, Cell>();
  for (const cell of graph.values()) {
    const north = directionalRun(graph, cell, 0, -1);
    const east = directionalRun(graph, cell, 1, 0);
    const south = directionalRun(graph, cell, 0, 1);
    const west = directionalRun(graph, cell, -1, 0);
    const horizontalThrough = east >= 4 && west >= 4;
    const verticalThrough = north >= 4 && south >= 4;
    if (horizontalThrough && (north >= 4 || south >= 4) || verticalThrough && (east >= 4 || west >= 4)) {
      seeds.set(agentCellKey(cell), cell);
    }
  }

  const junctions: TrafficJunction[] = [];
  const visited = new Set<string>();
  for (const seed of seeds.values()) {
    if (visited.has(agentCellKey(seed))) continue;
    const queue = [seed];
    const cells: Cell[] = [];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor]!;
      const currentKey = agentCellKey(current);
      if (visited.has(currentKey) || !seeds.has(currentKey)) continue;
      visited.add(currentKey);
      cells.push(current);
      for (const direction of DIRECTIONS) {
        const next = { x: current.x + direction.x, y: current.y + direction.y };
        if (seeds.has(agentCellKey(next)) && !visited.has(agentCellKey(next))) queue.push(next);
      }
    }
    if (cells.length === 0) continue;
    const bounds = {
      minX: Math.min(...cells.map((cell) => cell.x)), minY: Math.min(...cells.map((cell) => cell.y)),
      maxX: Math.max(...cells.map((cell) => cell.x)), maxY: Math.max(...cells.map((cell) => cell.y)),
    };
    const hasRoad = (candidates: Cell[]) => candidates.some((cell) => graph.has(agentCellKey(cell)));
    const arms: TrafficArm[] = [];
    if (hasRoad(Array.from({ length: bounds.maxX - bounds.minX + 1 }, (_, index) => ({ x: bounds.minX + index, y: bounds.minY - 1 })))) arms.push("N");
    if (hasRoad(Array.from({ length: bounds.maxY - bounds.minY + 1 }, (_, index) => ({ x: bounds.maxX + 1, y: bounds.minY + index })))) arms.push("E");
    if (hasRoad(Array.from({ length: bounds.maxX - bounds.minX + 1 }, (_, index) => ({ x: bounds.minX + index, y: bounds.maxY + 1 })))) arms.push("S");
    if (hasRoad(Array.from({ length: bounds.maxY - bounds.minY + 1 }, (_, index) => ({ x: bounds.minX - 1, y: bounds.minY + index })))) arms.push("W");
    if (arms.length < 3) continue;
    const postsByArm: Record<TrafficArm, { origin: Cell; axis: "H" | "V"; approach: TrafficArm }> = {
      N: { origin: { x: bounds.minX - 1, y: bounds.minY - 1 }, axis: "V", approach: "N" },
      E: { origin: { x: bounds.maxX + 1, y: bounds.minY - 1 }, axis: "H", approach: "E" },
      S: { origin: { x: bounds.maxX + 1, y: bounds.maxY + 1 }, axis: "V", approach: "S" },
      W: { origin: { x: bounds.minX - 1, y: bounds.maxY + 1 }, axis: "H", approach: "W" },
    };
    const signalPosts = arms.map((arm) => postsByArm[arm]).filter((post) => !graph.has(agentCellKey(post.origin)));
    junctions.push({ id: `${bounds.minX},${bounds.minY}:${bounds.maxX},${bounds.maxY}`, bounds, cells, arms, signalPosts });
  }
  return junctions;
}

export function trafficSignalPhase(junction: TrafficJunction, elapsedMs: number): TrafficSignalPhase {
  const cycleMs = 8_000;
  const offset = Math.abs((junction.bounds.minX * 73_856_093) ^ (junction.bounds.minY * 19_349_663)) % cycleMs;
  const phase = (elapsedMs + offset) % cycleMs;
  if (phase < 3_400) return { horizontal: "GREEN", vertical: "RED" };
  if (phase < 4_000) return { horizontal: "RED", vertical: "RED" };
  if (phase < 7_400) return { horizontal: "RED", vertical: "GREEN" };
  return { horizontal: "RED", vertical: "RED" };
}

export function mustYieldAtTrafficSignal(
  current: Cell,
  next: Cell,
  junctions: readonly TrafficJunction[],
  elapsedMs: number,
): boolean {
  const junction = junctions.find((candidate) => {
    const insideCurrent = current.x >= candidate.bounds.minX && current.x <= candidate.bounds.maxX
      && current.y >= candidate.bounds.minY && current.y <= candidate.bounds.maxY;
    const insideNext = next.x >= candidate.bounds.minX && next.x <= candidate.bounds.maxX
      && next.y >= candidate.bounds.minY && next.y <= candidate.bounds.maxY;
    return !insideCurrent && insideNext;
  });
  if (!junction) return false;
  const axis = next.x !== current.x ? "horizontal" : "vertical";
  return trafficSignalPhase(junction, elapsedMs)[axis] === "RED";
}

function laneAt(graph: ReadonlyMap<string, Cell>, cell: Cell): Lane {
  const horizontalRun = axisRun(graph, cell, 1, 0);
  const verticalRun = axisRun(graph, cell, 0, 1);
  if (horizontalRun >= 4 && verticalRun >= 4) return { axis: "J", dx: 0, dy: 0 };
  if (horizontalRun >= verticalRun) {
    const band = contiguousBand(graph, cell, true);
    return { axis: "H", dx: cell.y > (band.min + band.max) / 2 ? 1 : -1, dy: 0 };
  }
  const band = contiguousBand(graph, cell, false);
  return { axis: "V", dx: 0, dy: cell.x <= (band.min + band.max) / 2 ? 1 : -1 };
}

/**
 * Build a directed road graph for right-hand traffic. Ordinary road bands are
 * one-way per lane; intersections temporarily allow turns, but a car may only
 * leave them through a lane whose direction matches the movement.
 */
export function buildDirectedCarEdges(graph: ReadonlyMap<string, Cell>): Map<string, Cell[]> {
  const lanes = new Map([...graph].map(([key, cell]) => [key, laneAt(graph, cell)]));
  const edges = new Map<string, Cell[]>();
  for (const cell of graph.values()) {
    const lane = lanes.get(agentCellKey(cell))!;
    const candidates = adjacentGraphCells(graph, cell).filter((next) => {
      const dx = next.x - cell.x;
      const dy = next.y - cell.y;
      const nextLane = lanes.get(agentCellKey(next))!;
      if (lane.axis !== "J" && (dx !== lane.dx || dy !== lane.dy)) return false;
      return nextLane.axis === "J" || dx === nextLane.dx && dy === nextLane.dy;
    });
    edges.set(agentCellKey(cell), candidates);
  }
  return edges;
}

/**
 * Retain only the directed core that has both an entrance and an exit. Re-run
 * until stable so streamed road tails and dead ends cannot host an agent that
 * will inevitably stop at the edge of the resident graph.
 */
export function directedTrafficCore(outgoing: AgentEdges): Set<string> {
  const active = new Set(outgoing.keys());
  const successors = new Map<string, Set<string>>([...active].map((key) => [key, new Set()]));
  const predecessors = new Map<string, Set<string>>([...active].map((key) => [key, new Set()]));
  for (const key of active) {
    for (const candidate of outgoing.get(key) ?? []) {
      const candidateKey = agentCellKey(candidate);
      if (!active.has(candidateKey)) continue;
      successors.get(key)!.add(candidateKey);
      predecessors.get(candidateKey)!.add(key);
    }
  }
  const queue = [...active].filter((key) => successors.get(key)!.size === 0 || predecessors.get(key)!.size === 0);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const key = queue[cursor]!;
    if (!active.delete(key)) continue;
    for (const successor of successors.get(key)!) {
      predecessors.get(successor)!.delete(key);
      if (active.has(successor) && (predecessors.get(successor)!.size === 0 || successors.get(successor)!.size === 0)) queue.push(successor);
    }
    for (const predecessor of predecessors.get(key)!) {
      successors.get(predecessor)!.delete(key);
      if (active.has(predecessor) && (predecessors.get(predecessor)!.size === 0 || successors.get(predecessor)!.size === 0)) queue.push(predecessor);
    }
  }
  return active;
}

export function walkerInteractionPairs(
  walkers: ReadonlyArray<{ id: string; current: Cell; pauseMs: number; socialCooldownMs: number }>,
  maximumPairs = 2,
): Array<[string, string]> {
  const available = walkers.filter((walker) => walker.pauseMs <= 0 && walker.socialCooldownMs <= 0);
  const used = new Set<string>();
  const pairs: Array<[string, string]> = [];
  for (let left = 0; left < available.length && pairs.length < maximumPairs; left += 1) {
    const first = available[left]!;
    if (used.has(first.id)) continue;
    for (let right = left + 1; right < available.length; right += 1) {
      const second = available[right]!;
      if (used.has(second.id)) continue;
      const distance = Math.abs(first.current.x - second.current.x) + Math.abs(first.current.y - second.current.y);
      if (distance > 1) continue;
      used.add(first.id); used.add(second.id); pairs.push([first.id, second.id]);
      break;
    }
  }
  return pairs;
}

export function nextSeededRandom(state: number): { state: number; value: number } {
  let next = state | 0;
  next ^= next << 13;
  next ^= next >>> 17;
  next ^= next << 5;
  const normalized = (next >>> 0) / 0x1_0000_0000;
  return { state: next || 0x6d2b79f5, value: normalized };
}

export function adjacentGraphCells(graph: ReadonlyMap<string, Cell>, cell: Cell): Cell[] {
  return DIRECTIONS
    .map((direction) => graph.get(agentCellKey({ x: cell.x + direction.x, y: cell.y + direction.y })))
    .filter((candidate): candidate is Cell => Boolean(candidate));
}

/** Bounded BFS. Route includes start and target and never jumps between cells. */
export function shortestAgentRoute(
  graph: ReadonlyMap<string, Cell>,
  start: Cell,
  target: Cell,
  maximumVisited = 8_000,
  outgoing?: AgentEdges,
  avoidFirst?: Cell,
): Cell[] {
  const startKey = agentCellKey(start);
  const targetKey = agentCellKey(target);
  if (!graph.has(startKey) || !graph.has(targetKey)) return [];
  if (startKey === targetKey) return [start];
  type RouteState = { cell: Cell; direction: number; steps: number; turns: number; stateKey: string };
  type BestState = { steps: number; turns: number; previous: string | null };
  const stateKey = (cell: Cell, direction: number) => `${agentCellKey(cell)}:${direction}`;
  const queue: RouteState[] = [{ cell: start, direction: -1, steps: 0, turns: 0, stateKey: stateKey(start, -1) }];
  const best = new Map<string, BestState>([[stateKey(start, -1), { steps: 0, turns: 0, previous: null }]]);
  let targetSteps = Number.POSITIVE_INFINITY;
  let targetState: RouteState | undefined;
  for (let cursor = 0; cursor < queue.length && cursor < maximumVisited; cursor += 1) {
    const current = queue[cursor]!;
    if (current.steps > targetSteps) break;
    if (agentCellKey(current.cell) === targetKey) {
      if (!targetState || current.turns < targetState.turns) targetState = current;
      targetSteps = current.steps;
      continue;
    }
    for (const next of directedNeighbors(graph, current.cell, outgoing)) {
      if (current.steps === 0 && avoidFirst && agentCellKey(next) === agentCellKey(avoidFirst)) continue;
      const dx = next.x - current.cell.x;
      const dy = next.y - current.cell.y;
      const direction = dx > 0 ? 1 : dx < 0 ? 3 : dy > 0 ? 2 : 0;
      const steps = current.steps + 1;
      const turns = current.turns + (current.direction < 0 || current.direction === direction ? 0 : 1);
      const nextStateKey = stateKey(next, direction);
      const known = best.get(nextStateKey);
      if (known && (known.steps < steps || known.steps === steps && known.turns <= turns)) continue;
      best.set(nextStateKey, { steps, turns, previous: current.stateKey });
      queue.push({ cell: next, direction, steps, turns, stateKey: nextStateKey });
    }
  }
  if (!targetState) return [];
  const route: Cell[] = [];
  let trace: string | null = targetState.stateKey;
  while (trace) {
    const separator = trace.lastIndexOf(":");
    const cell = graph.get(trace.slice(0, separator));
    if (cell) route.push(cell);
    trace = best.get(trace)?.previous ?? null;
  }
  return route.reverse();
}

/**
 * Pick several session-random distant destinations and return the longest
 * reachable route. Planning is called only at route boundaries, never per RAF.
 */
export function planAgentRoute(
  graph: ReadonlyMap<string, Cell>,
  start: Cell,
  randomState: number,
  sampleCount = 12,
  avoidFirst?: Cell,
  outgoing?: AgentEdges,
): { route: Cell[]; randomState: number } {
  const startKey = agentCellKey(start);
  if (graph.size < 2 || !graph.has(startKey)) return { route: [start], randomState };
  const queue = [start];
  const previous = new Map<string, string | null>([[startKey, null]]);
  for (let cursor = 0; cursor < queue.length && cursor < 8_000; cursor += 1) {
    const current = queue[cursor]!;
    for (const next of directedNeighbors(graph, current, outgoing)) {
      const nextKey = agentCellKey(next);
      if (cursor === 0 && avoidFirst && nextKey === agentCellKey(avoidFirst)) continue;
      if (previous.has(nextKey)) continue;
      previous.set(nextKey, agentCellKey(current));
      queue.push(next);
    }
  }
  if (queue.length < 2) return avoidFirst
    ? planAgentRoute(graph, start, randomState, sampleCount, undefined, outgoing)
    : { route: [start], randomState };
  let state = randomState;
  let target = queue[1]!;
  let bestDistance = 1;
  for (let index = 0; index < Math.min(sampleCount, queue.length - 1); index += 1) {
    const random = nextSeededRandom(state);
    state = random.state;
    const candidateIndex = 1 + Math.floor(random.value * (queue.length - 1));
    if (candidateIndex > bestDistance) {
      target = queue[candidateIndex]!;
      bestDistance = candidateIndex;
    }
  }
  const route = shortestAgentRoute(graph, start, target, 8_000, outgoing, avoidFirst);
  return { route, randomState: state };
}

export function nextWithoutUTurn(graph: ReadonlyMap<string, Cell>, current: Cell, previous?: Cell, outgoing?: AgentEdges): Cell {
  const candidates = directedNeighbors(graph, current, outgoing);
  return candidates.find((candidate) => !previous || agentCellKey(candidate) !== agentCellKey(previous))
    ?? (outgoing ? undefined : previous)
    ?? current;
}

export function connectShortWalkGaps(base: Map<string, Cell>, availableGround: Map<string, Cell>, maxGapCells = 2): Map<string, Cell> {
  const connected = new Map(base);
  for (const origin of base.values()) {
    for (const direction of DIRECTIONS) {
      for (let gap = 1; gap <= maxGapCells; gap += 1) {
        const target = { x: origin.x + direction.x * (gap + 1), y: origin.y + direction.y * (gap + 1) };
        if (!base.has(agentCellKey(target))) continue;
        const intermediate: Cell[] = [];
        for (let step = 1; step <= gap; step += 1) intermediate.push({ x: origin.x + direction.x * step, y: origin.y + direction.y * step });
        if (intermediate.every((cell) => availableGround.has(agentCellKey(cell)))) {
          for (const cell of intermediate) connected.set(agentCellKey(cell), availableGround.get(agentCellKey(cell))!);
        }
        break;
      }
    }
  }
  return connected;
}

export function mustYieldAtCrosswalk(next: Cell, crosswalks: Set<string>, walkers: ReadonlyArray<{ current: Cell; next: Cell }>): boolean {
  const nextKey = agentCellKey(next);
  if (!crosswalks.has(nextKey)) return false;
  return walkers.some((walker) => agentCellKey(walker.current) === nextKey || agentCellKey(walker.next) === nextKey);
}
