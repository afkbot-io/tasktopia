import type { Cell, Rect } from "../../shared/contracts";

export const GRID_DIRECTIONS = [
  { x: 0, y: -1, bit: 1, opposite: 4 },
  { x: 1, y: 0, bit: 2, opposite: 8 },
  { x: 0, y: 1, bit: 4, opposite: 1 },
  { x: -1, y: 0, bit: 8, opposite: 2 },
] as const;

export function cellKey(cell: Cell): string {
  return `${cell.x},${cell.y}`;
}

function parseCellKey(value: string): Cell {
  const [x, y] = value.split(",").map(Number);
  if (!Number.isInteger(x) || !Number.isInteger(y)) throw new Error(`Invalid cell key: ${value}`);
  return { x: x!, y: y! };
}

function neighbor(cell: Cell, direction: number): Cell {
  const delta = GRID_DIRECTIONS[direction];
  if (!delta) throw new RangeError(`Invalid square-grid direction ${direction}`);
  return { x: cell.x + delta.x, y: cell.y + delta.y };
}

export function neighbors4(cell: Cell): Cell[] {
  return GRID_DIRECTIONS.map((delta) => ({ x: cell.x + delta.x, y: cell.y + delta.y }));
}

export function manhattan(a: Cell, b: Cell): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function floorDiv(value: number, divisor: number): number {
  return Math.floor(value / divisor);
}

export function floorMod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

export function contains(rect: Rect, cell: Cell): boolean {
  return cell.x >= rect.minX && cell.x <= rect.maxX && cell.y >= rect.minY && cell.y <= rect.maxY;
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function expandRect(rect: Rect, amount: number): Rect {
  return { minX: rect.minX - amount, minY: rect.minY - amount, maxX: rect.maxX + amount, maxY: rect.maxY + amount };
}

export function boundsOf(cells: Cell[]): Rect {
  if (cells.length === 0) throw new Error("Cannot calculate bounds of empty cells");
  const first = cells[0]!;
  const bounds = { minX: first.x, minY: first.y, maxX: first.x, maxY: first.y };
  for (let index = 1; index < cells.length; index += 1) {
    const cell = cells[index]!;
    if (cell.x < bounds.minX) bounds.minX = cell.x;
    if (cell.y < bounds.minY) bounds.minY = cell.y;
    if (cell.x > bounds.maxX) bounds.maxX = cell.x;
    if (cell.y > bounds.maxY) bounds.maxY = cell.y;
  }
  return bounds;
}

export function connected(cells: Cell[]): boolean {
  if (cells.length === 0) return false;
  const allowed = new Set(cells.map(cellKey));
  const reached = new Set<string>();
  const queue = [cells[0]!];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentKey = cellKey(current);
    if (reached.has(currentKey)) continue;
    reached.add(currentKey);
    for (const next of neighbors4(current)) if (allowed.has(cellKey(next)) && !reached.has(cellKey(next))) queue.push(next);
  }
  return reached.size === allowed.size;
}

export function rectangleFootprint(origin: Cell, width: number, height: number): Cell[] {
  const cells: Cell[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) cells.push({ x: origin.x + x, y: origin.y + y });
  }
  return cells;
}

export function perimeterSegments(cells: Cell[]): Array<{ cell: Cell; direction: number }> {
  const keys = new Set(cells.map(cellKey));
  const result: Array<{ cell: Cell; direction: number }> = [];
  for (const cell of cells) {
    for (let direction = 0; direction < GRID_DIRECTIONS.length; direction += 1) {
      if (!keys.has(cellKey(neighbor(cell, direction)))) result.push({ cell, direction });
    }
  }
  return result;
}

export function orthogonalPath(start: Cell, end: Cell, horizontalFirst: boolean): Cell[] {
  const result: Cell[] = [{ ...start }];
  let current = { ...start };
  const walkX = () => {
    while (current.x !== end.x) {
      current = { x: current.x + Math.sign(end.x - current.x), y: current.y };
      result.push(current);
    }
  };
  const walkY = () => {
    while (current.y !== end.y) {
      current = { x: current.x, y: current.y + Math.sign(end.y - current.y) };
      result.push(current);
    }
  };
  if (horizontalFirst) { walkX(); walkY(); } else { walkY(); walkX(); }
  return result;
}

type HeapEntry = { cell: Cell; priority: number };

class MinHeap {
  private readonly entries: HeapEntry[] = [];

  get size(): number { return this.entries.length; }

  push(entry: HeapEntry): void {
    this.entries.push(entry);
    let index = this.entries.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.entries[parent]!.priority <= entry.priority) break;
      this.entries[index] = this.entries[parent]!;
      index = parent;
    }
    this.entries[index] = entry;
  }

  pop(): HeapEntry | undefined {
    const first = this.entries[0];
    const last = this.entries.pop();
    if (!first || !last || this.entries.length === 0) return first;
    let index = 0;
    this.entries[0] = last;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.entries.length) break;
      let next = left;
      if (right < this.entries.length && this.entries[right]!.priority < this.entries[left]!.priority) next = right;
      if (this.entries[next]!.priority >= this.entries[index]!.priority) break;
      [this.entries[index], this.entries[next]] = [this.entries[next]!, this.entries[index]!];
      index = next;
    }
    return first;
  }
}

function searchAStarPath(
  start: Cell,
  ends: readonly Cell[],
  costAt: (cell: Cell) => number,
  searchMargin = 48,
  turnPenalty = 0,
): Cell[] {
  if (ends.length === 0) return [];
  const goalKeys = new Set(ends.map(cellKey));
  const bounds: Rect = {
    minX: Math.min(start.x, ...ends.map((cell) => cell.x)) - searchMargin,
    minY: Math.min(start.y, ...ends.map((cell) => cell.y)) - searchMargin,
    maxX: Math.max(start.x, ...ends.map((cell) => cell.x)) + searchMargin,
    maxY: Math.max(start.y, ...ends.map((cell) => cell.y)) + searchMargin,
  };
  const nearestGoalDistance = (cell: Cell) => ends.reduce(
    (best, goal) => Math.min(best, manhattan(cell, goal)),
    Number.POSITIVE_INFINITY,
  );
  const open = new MinHeap();
  const startKey = cellKey(start);
  const cameFrom = new Map<string, string>();
  const cost = new Map<string, number>([[startKey, 0]]);
  const closed = new Set<string>();
  // Every edge is clamped to at least 0.05 below. Scaling the heuristic by
  // that same lower bound keeps it admissible even when existing roads are
  // intentionally much cheaper than terrain.
  open.push({ cell: start, priority: nearestGoalDistance(start) * 0.05 });
  let visited = 0;
  while (open.size > 0 && visited < 750_000) {
    const current = open.pop()!.cell;
    const currentKey = cellKey(current);
    if (closed.has(currentKey)) continue;
    closed.add(currentKey);
    visited += 1;
    if (goalKeys.has(currentKey)) {
      const path: Cell[] = [current];
      let cursor = currentKey;
      while (cursor !== startKey) {
        const previous = cameFrom.get(cursor);
        if (!previous) break;
        path.push(parseCellKey(previous));
        cursor = previous;
      }
      return path.reverse();
    }
    for (const next of neighbors4(current)) {
      if (!contains(bounds, next)) continue;
      const nextKey = cellKey(next);
      const stepCost = costAt(next);
      if (!Number.isFinite(stepCost)) continue;
      const previousKey = cameFrom.get(currentKey);
      const previous = previousKey ? parseCellKey(previousKey) : undefined;
      const turns = previous
        && (current.x - previous.x !== next.x - current.x || current.y - previous.y !== next.y - current.y);
      const nextCost = cost.get(currentKey)! + Math.max(0.05, stepCost) + (turns ? turnPenalty : 0);
      if (nextCost >= (cost.get(nextKey) ?? Number.POSITIVE_INFINITY)) continue;
      cost.set(nextKey, nextCost);
      cameFrom.set(nextKey, currentKey);
      open.push({ cell: next, priority: nextCost + nearestGoalDistance(next) * 0.05 });
    }
  }
  return [];
}

export function aStarPath(
  start: Cell,
  end: Cell,
  costAt: (cell: Cell) => number,
  searchMargin = 48,
  turnPenalty = 0,
  fallbackToOrthogonal = true,
): Cell[] {
  const path = searchAStarPath(start, [end], costAt, searchMargin, turnPenalty);
  return path.length > 0 || !fallbackToOrthogonal
    ? path
    : orthogonalPath(start, end, Math.abs(end.x - start.x) >= Math.abs(end.y - start.y));
}

export function aStarPathToAny(
  start: Cell,
  ends: readonly Cell[],
  costAt: (cell: Cell) => number,
  searchMargin = 48,
  turnPenalty = 0,
): Cell[] {
  return searchAStarPath(start, ends, costAt, searchMargin, turnPenalty);
}
