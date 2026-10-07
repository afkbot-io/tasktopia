import type { Cell } from "../shared/contracts";

const key = (cell: Cell) => `${cell.x},${cell.y}`;
const heading = (a: Cell, b: Cell) => b.x > a.x ? 1 : b.x < a.x ? 3 : b.y > a.y ? 2 : 0;

/** Compile one immutable topology once. Search keeps heading-aware reachability,
 * straight-first stable BFS order and the existing 8,000-state work ceiling.
 * Numeric states avoid coordinate strings and sorting at every visited edge. */
export function createMobilityRouteSearch(graph: ReadonlyMap<string, Cell>, edges: ReadonlyMap<string, readonly Cell[]>) {
  const cells = [...graph.values()];
  // Graph values can carry road metadata and signed zero; physical route
  // endpoints are plain coordinates, as in the original edge traversal.
  const routeCells = cells.map(cell => ({ x: cell.x || 0, y: cell.y || 0 }));
  const indices = new Map(cells.map((cell, index) => [key(cell), index]));
  const outgoing = cells.map(cell => (edges.get(key(cell)) ?? []).flatMap(next => {
    const index = indices.get(key(next));
    return index === undefined ? [] : [{ index, direction: heading(cell, next) }];
  }));
  const root = cells.length * 4;
  return (start: Cell, previous?: Cell) => {
    const startIndex = indices.get(key(start));
    if (startIndex === undefined) return { cells: [], routeTo: (): Cell[] => [] };
    const initialDirection = previous ? heading(previous, start) : -1;
    const first = initialDirection < 0 ? root : startIndex * 4 + initialDirection;
    const parents = new Int32Array(root + 1).fill(-1);
    const visited = new Uint8Array(root + 1);
    const reached = new Int32Array(cells.length).fill(-1);
    const queue = [first], order = [startIndex];
    visited[first] = 1; reached[startIndex] = first;
    for (let cursor = 0; cursor < queue.length && cursor < 8_000; cursor++) {
      const state = queue[cursor]!;
      const index = state === root ? startIndex : Math.floor(state / 4);
      const direction = state === root ? -1 : state % 4;
      // Same stable order as sorting straight first, without allocating an
      // array or comparator for each state. Initial heading has no straight.
      for (let pass = direction < 0 ? 1 : 0; pass < 2; pass++) for (const next of outgoing[index]!) {
        if ((next.direction === direction) !== (pass === 0)
          || direction >= 0 && next.direction === (direction + 2) % 4) continue;
        const nextState = next.index * 4 + next.direction;
        if (visited[nextState]) continue;
        visited[nextState] = 1; parents[nextState] = state;
        if (reached[next.index] === -1) { reached[next.index] = nextState; order.push(next.index); }
        queue.push(nextState);
      }
    }
    return {
      cells: order.map(index => cells[index]!),
      routeTo(target: Cell): Cell[] {
        const targetIndex = indices.get(key(target));
        if (targetIndex === undefined || reached[targetIndex] === -1) return [];
        const route: Cell[] = [];
        for (let state = reached[targetIndex]!; state >= 0; state = parents[state]!) {
          route.push(parents[state] === -1 ? start : routeCells[Math.floor(state / 4)]!);
        }
        return route.reverse();
      },
    };
  };
}
