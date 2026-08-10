import type { Cell } from "../shared/contracts";

export function agentCellKey(cell: Cell): string { return `${cell.x},${cell.y}`; }

const DIRECTIONS = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }] as const;
export type AgentEdges = ReadonlyMap<string, readonly Cell[]>;

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
): Cell[] {
  const startKey = agentCellKey(start);
  const targetKey = agentCellKey(target);
  if (!graph.has(startKey) || !graph.has(targetKey)) return [];
  if (startKey === targetKey) return [start];
  const queue = [start];
  const previous = new Map<string, string | null>([[startKey, null]]);
  for (let cursor = 0; cursor < queue.length && cursor < maximumVisited; cursor += 1) {
    const current = queue[cursor]!;
    for (const next of directedNeighbors(graph, current, outgoing)) {
      const nextKey = agentCellKey(next);
      if (previous.has(nextKey)) continue;
      previous.set(nextKey, agentCellKey(current));
      if (nextKey === targetKey) {
        const route: Cell[] = [next];
        let trace: string | null = agentCellKey(current);
        while (trace) {
          route.push(graph.get(trace) ?? start);
          trace = previous.get(trace) ?? null;
        }
        return route.reverse();
      }
      queue.push(next);
    }
  }
  return [];
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
  const route: Cell[] = [target];
  let trace = previous.get(agentCellKey(target)) ?? null;
  while (trace) {
    route.push(graph.get(trace) ?? start);
    trace = previous.get(trace) ?? null;
  }
  route.reverse();
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
