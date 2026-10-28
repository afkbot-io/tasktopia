import type { Cell } from "../shared/contracts";
import { completePreparation, prepareCooperatively, type CooperativePreparationOptions } from "./cooperative-preparation";

export type MobilityRouteResult = { cells: Cell[]; routeTo(target: Cell): Cell[] };
export type MobilityRouteSearch = {
  (start: Cell, previous?: Cell, target?: Cell, maxCells?: number): MobilityRouteResult;
  steps(start: Cell, previous?: Cell, target?: Cell, maxCells?: number): Generator<void, MobilityRouteResult, void>;
  setBlocked(closedCells: ReadonlySet<string>): void;
};

const key = (cell: Cell) => `${cell.x},${cell.y}`;
const heading = (a: Cell, b: Cell) => b.x > a.x ? 1 : b.x < a.x ? 3 : b.y > a.y ? 2 : 0;

/** Compile one immutable topology once. Search keeps heading-aware reachability,
 * straight-first stable BFS order and the existing 8,000-state work ceiling.
 * Numeric states avoid coordinate strings and sorting at every visited edge. */
export function createMobilityRouteSearch(graph: ReadonlyMap<string, Cell>, edges: ReadonlyMap<string, readonly Cell[]>): MobilityRouteSearch {
  return completePreparation(createMobilityRouteSearchSteps(graph, edges));
}
export function createMobilityRouteSearchAsync(graph: ReadonlyMap<string, Cell>, edges: ReadonlyMap<string, readonly Cell[]>, options: CooperativePreparationOptions = {}): Promise<MobilityRouteSearch> {
  return prepareCooperatively(createMobilityRouteSearchSteps(graph, edges), options);
}
export function* createMobilityRouteSearchSteps(graph: ReadonlyMap<string, Cell>, edges: ReadonlyMap<string, readonly Cell[]>): Generator<void, MobilityRouteSearch, void> {
  const cells: Cell[] = [], indices = new Map<string, number>();
  const coordinates = new Float64Array(graph.size * 2);
  let edgeCapacity = 0;
  // Keep original metadata/iteration order, but snapshot route coordinates in
  // numeric storage instead of allocating a second city-sized Cell graph.
  for (const cell of graph.values()) {
    const id = key(cell), index = cells.length;
    indices.set(id, index); cells.push(cell);
    coordinates[index * 2] = cell.x || 0; coordinates[index * 2 + 1] = cell.y || 0;
    edgeCapacity += edges.get(id)?.length ?? 0; yield;
  }
  let hasNonlocalEdges = false, boundedDegree = true, edgeCount = 0;
  // CSR preserves every authored edge and its stable order, including custom
  // nonlocal/wide graphs. No per-node arrays or per-edge objects stay live.
  const offsets = new Uint32Array(cells.length + 1), targets = new Uint32Array(edgeCapacity), headings = new Uint8Array(edgeCapacity);
  for (let current = 0; current < cells.length; current++) {
    const cell = cells[current]!; offsets[current] = edgeCount;
    for (const next of edges.get(key(cell)) ?? []) {
      const index = indices.get(key(next));
      if (index !== undefined) {
        if (Math.abs(next.x - cell.x) + Math.abs(next.y - cell.y) > 1) hasNonlocalEdges = true;
        targets[edgeCount] = index; headings[edgeCount++] = heading(cell, next);
      }
      yield;
    }
    if (edgeCount - offsets[current]! > 4) boundedDegree = false;
    offsets[current + 1] = edgeCount; yield;
  }
  const routeCell = (index: number): Cell => ({ x: coordinates[index * 2]!, y: coordinates[index * 2 + 1]! });
  const root = cells.length * 4;
  const blocked = new Uint8Array(cells.length);
  let blockedIndices: number[] = [];
  function* searchSteps(start: Cell, previous?: Cell, target?: Cell, maxCells = Infinity): Generator<void, MobilityRouteResult, void> {
    // A grid state has at most four cheap edges. Check the outer time/abort
    // budget in small batches instead of spending its fallback operation cap
    // on each state and scheduling needless browser tasks between renders.
    // Custom graphs with a wider fan-out keep a checkpoint at every state.
    const batchSize = boundedDegree ? 64 : 1;
    let work = 0;
    const startIndex = indices.get(key(start));
    const targetIndex = target ? indices.get(key(target)) : undefined;
    if (startIndex === undefined || target && targetIndex === undefined || !(maxCells >= 1)) return { cells: [], routeTo: (): Cell[] => [] };
    // On a unit grid, even a perfectly straight trip needs distance+1 cells.
    // Distant visitors cannot arrive within the quota; avoid exploring the
    // entire local graph. Nonlocal/custom edges retain ordinary search.
    if (target && !hasNonlocalEdges && Math.abs(target.x - start.x) + Math.abs(target.y - start.y) + 1 > Math.ceil(maxCells))
      return { cells: [], routeTo: (): Cell[] => [] };
    const initialDirection = previous ? heading(previous, start) : -1;
    const first = initialDirection < 0 ? root : startIndex * 4 + initialDirection;
    if (maxCells < Infinity || targetIndex !== undefined) {
      // Short trips touch only a local part of a large topology. Sparse state
      // avoids zeroing megacity-sized buffers for every candidate curb. Each
      // result owns its parents, so later searches cannot invalidate a route.
      const parents = new Map([[first, -1]]), reached = new Map([[startIndex, first]]);
      const queue = [first], lengths = [1], order = [startIndex];
      search: for (let cursor = 0; cursor < queue.length && cursor < 8_000 && (targetIndex === undefined || !reached.has(targetIndex)); cursor++) {
        if (++work === batchSize) { work = 0; yield; }
        const state = queue[cursor]!;
        if (lengths[cursor]! >= maxCells) continue;
        const index = state === root ? startIndex : Math.floor(state / 4), direction = state === root ? -1 : state % 4;
        for (let pass = direction < 0 ? 1 : 0; pass < 2; pass++) for (let edge = offsets[index]!; edge < offsets[index + 1]!; edge++) {
          const nextIndex = targets[edge]!, nextDirection = headings[edge]!;
          if (blocked[nextIndex] || (nextDirection === direction) !== (pass === 0)
            || direction >= 0 && nextDirection === (direction + 2) % 4) continue;
          const nextState = nextIndex * 4 + nextDirection;
          if (parents.has(nextState)) continue;
          parents.set(nextState, state);
          if (!reached.has(nextIndex)) { reached.set(nextIndex, nextState); order.push(nextIndex); }
          queue.push(nextState); lengths.push(lengths[cursor]! + 1);
          if (nextIndex === targetIndex) break search;
        }
      }
      const reachableCells: Cell[] = [];
      for (const index of order) { reachableCells.push(cells[index]!); if (++work === batchSize) { work = 0; yield; } }
      if (work) yield;
      return {
        cells: reachableCells,
        routeTo(target: Cell): Cell[] {
          const index = indices.get(key(target));
          const firstState = index === undefined ? undefined : reached.get(index);
          if (firstState === undefined) return [];
          let state: number = firstState;
          const route: Cell[] = [];
          while (state >= 0) {
            const parent: number = parents.get(state)!;
            route.push(parent === -1 ? start : routeCell(Math.floor(state / 4)));
            state = parent;
          }
          return route.reverse();
        },
      };
    }
    const parents = new Int32Array(root + 1).fill(-1);
    const visited = new Uint8Array(root + 1);
    const reached = new Int32Array(cells.length).fill(-1);
    const queue = [first], order = [startIndex];
    visited[first] = 1; reached[startIndex] = first;
    for (let cursor = 0; cursor < queue.length && cursor < 8_000; cursor++) {
      if (++work === batchSize) { work = 0; yield; }
      const state = queue[cursor]!;
      const index = state === root ? startIndex : Math.floor(state / 4);
      const direction = state === root ? -1 : state % 4;
      // Same stable order as sorting straight first, without allocating an
      // array or comparator for each state. Initial heading has no straight.
      for (let pass = direction < 0 ? 1 : 0; pass < 2; pass++) for (let edge = offsets[index]!; edge < offsets[index + 1]!; edge++) {
        const nextIndex = targets[edge]!, nextDirection = headings[edge]!;
        if (blocked[nextIndex] || (nextDirection === direction) !== (pass === 0)
          || direction >= 0 && nextDirection === (direction + 2) % 4) continue;
        const nextState = nextIndex * 4 + nextDirection;
        if (visited[nextState]) continue;
        visited[nextState] = 1; parents[nextState] = state;
        if (reached[nextIndex] === -1) { reached[nextIndex] = nextState; order.push(nextIndex); }
        queue.push(nextState);
      }
    }
    const reachableCells: Cell[] = [];
    for (const index of order) { reachableCells.push(cells[index]!); if (++work === batchSize) { work = 0; yield; } }
    if (work) yield;
    return {
      cells: reachableCells,
      routeTo(target: Cell): Cell[] {
        const targetIndex = indices.get(key(target));
        if (targetIndex === undefined || reached[targetIndex] === -1) return [];
        const route: Cell[] = [];
        for (let state = reached[targetIndex]!; state >= 0; state = parents[state]!) {
          route.push(parents[state] === -1 ? start : routeCell(Math.floor(state / 4)));
        }
        return route.reverse();
      },
    };
  }
  const search = (start: Cell, previous?: Cell, target?: Cell, maxCells = Infinity) => completePreparation(searchSteps(start, previous, target, maxCells));
  return Object.assign(search, {
    steps: searchSteps,
    setBlocked(closedCells: ReadonlySet<string>): void {
      // Only changed closure cells are touched. The immutable topology and
      // earlier route results survive; a closed starting cell can still exit.
      for (const index of blockedIndices) blocked[index] = 0;
      blockedIndices = [];
      for (const id of closedCells) {
        const index = indices.get(id);
        if (index === undefined) continue;
        blocked[index] = 1; blockedIndices.push(index);
      }
    },
  });
}
