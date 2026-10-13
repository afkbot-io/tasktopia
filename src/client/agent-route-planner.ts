import type { Cell } from "../shared/contracts";
import { agentCellKey, nextSeededRandom } from "./agent-routing";

const DIRECTIONS = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }] as const;
const VISIT_LIMIT = 8_000;

/** Compile immutable undirected animal ground once per network replacement.
 * Numeric searches preserve the legacy BFS order, seed consumption and
 * shortest-route/fewest-turn tie breaking without per-edge strings/objects. */
export function createAgentRoutePlanner(graph: ReadonlyMap<string, Cell>) {
  const cells = [...graph.values()];
  const indices = new Map(cells.map((cell, index) => [agentCellKey(cell), index]));
  const root = cells.length * 4;
  const neighbors = new Int32Array(root).fill(-1);
  for (let index = 0; index < cells.length; index++) {
    const cell = cells[index]!;
    for (let direction = 0; direction < DIRECTIONS.length; direction++) {
      const d = DIRECTIONS[direction]!;
      neighbors[index * 4 + direction] = indices.get(`${cell.x + d.x},${cell.y + d.y}`) ?? -1;
    }
  }

  const shortest = (start: Cell, startIndex: number, targetIndex: number, avoidIndex: number | undefined): Cell[] => {
    if (startIndex === targetIndex) return [start];
    const steps = new Int32Array(root + 1).fill(-1), turns = new Int32Array(root + 1);
    const parents = new Int32Array(root + 1).fill(-1);
    const queue = [root], lengths = [0], turnCounts = [0];
    steps[root] = 0;
    let targetSteps = Infinity, targetState: number | undefined, targetTurns = Infinity;
    for (let cursor = 0; cursor < queue.length && cursor < VISIT_LIMIT; cursor++) {
      const state = queue[cursor]!, length = lengths[cursor]!, turnCount = turnCounts[cursor]!;
      if (length > targetSteps) break;
      const index = state === root ? startIndex : Math.floor(state / 4), direction = state === root ? -1 : state % 4;
      if (index === targetIndex) {
        if (targetState === undefined || turnCount < targetTurns) { targetState = state; targetTurns = turnCount; }
        targetSteps = length;
        continue;
      }
      for (let nextDirection = 0; nextDirection < DIRECTIONS.length; nextDirection++) {
        const next = neighbors[index * 4 + nextDirection]!;
        if (next < 0 || length === 0 && next === avoidIndex) continue;
        const nextState = next * 4 + nextDirection, nextSteps = length + 1;
        const nextTurns = turnCount + (direction < 0 || direction === nextDirection ? 0 : 1);
        if (steps[nextState]! >= 0 && (steps[nextState]! < nextSteps || steps[nextState] === nextSteps && turns[nextState]! <= nextTurns)) continue;
        steps[nextState] = nextSteps; turns[nextState] = nextTurns; parents[nextState] = state;
        queue.push(nextState); lengths.push(nextSteps); turnCounts.push(nextTurns);
      }
    }
    if (targetState === undefined) return [];
    const route: Cell[] = [];
    for (let state = targetState; state >= 0; state = parents[state]!) route.push(state === root ? start : cells[Math.floor(state / 4)]!);
    return route.reverse();
  };

  const plan = (start: Cell, randomState: number, sampleCount = 12, avoidFirst?: Cell): { route: Cell[]; randomState: number } => {
    const startIndex = indices.get(agentCellKey(start));
    if (cells.length < 2 || startIndex === undefined) return { route: [start], randomState };
    const avoidIndex = avoidFirst ? indices.get(agentCellKey(avoidFirst)) : undefined;
    const visited = new Uint8Array(cells.length), queue = [startIndex];
    visited[startIndex] = 1;
    for (let cursor = 0; cursor < queue.length && cursor < VISIT_LIMIT; cursor++) {
      for (let direction = 0; direction < DIRECTIONS.length; direction++) {
        const next = neighbors[queue[cursor]! * 4 + direction]!;
        if (next < 0 || cursor === 0 && next === avoidIndex || visited[next]) continue;
        visited[next] = 1; queue.push(next);
      }
    }
    if (queue.length < 2) return avoidFirst ? plan(start, randomState, sampleCount) : { route: [start], randomState };
    let state = randomState, target = queue[1]!, bestDistance = 1;
    for (let index = 0; index < Math.min(sampleCount, queue.length - 1); index++) {
      const random = nextSeededRandom(state); state = random.state;
      const candidate = 1 + Math.floor(random.value * (queue.length - 1));
      if (candidate > bestDistance) { target = queue[candidate]!; bestDistance = candidate; }
    }
    return { route: shortest(start, startIndex, target, avoidIndex), randomState: state };
  };
  return plan;
}
