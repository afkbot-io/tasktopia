import type { Cell } from "../shared/contracts";

export function agentCellKey(cell: Cell): string { return `${cell.x},${cell.y}`; }
const DIRECTIONS = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }] as const;
export type AgentEdges = ReadonlyMap<string, readonly Cell[]>;

function directedNeighbors(graph: ReadonlyMap<string, Cell>, cell: Cell, outgoing?: AgentEdges): Cell[] {
  return outgoing ? [...outgoing.get(agentCellKey(cell)) ?? []] : adjacentGraphCells(graph, cell);
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
