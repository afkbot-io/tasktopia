import type { Cell, CellRunDto, Rect } from "../shared/contracts";

type Span = [number, number];
export type DistrictOutlineSegment = { from: Cell; to: Cell };

function merge(spans: readonly Span[]): Span[] {
  const result: Span[] = [];
  for (const [start, end] of [...spans].sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    const last = result.at(-1);
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else result.push([start, end]);
  }
  return result;
}

function subtract(source: readonly Span[], cover: readonly Span[]): Span[] {
  const result: Span[] = [];
  let index = 0;
  for (const [start, end] of source) {
    let cursor = start;
    while (index < cover.length && cover[index]![1] < cursor) index++;
    for (let next = index; next < cover.length && cover[next]![0] <= end; next++) {
      const [left, right] = cover[next]!;
      if (left > cursor) result.push([cursor, Math.min(end, left - 1)]);
      cursor = Math.max(cursor, right + 1);
      if (cursor > end) break;
    }
    if (cursor <= end) result.push([cursor, end]);
  }
  return result;
}

/** Immutable source runs keep district interiors out of the renderer heap.
 * The small mutable addition seam is used only while building blocked masks. */
export class DevelopmentCellIndex {
  private readonly rows = new Map<number, Span[]>();
  private boundaryCache?: Cell[];
  private outlineCache?: DistrictOutlineSegment[];
  private cellsCache?: Cell[];
  size = 0;

  constructor(runs: Iterable<CellRunDto>) {
    const add = (y: number, start: number, end: number) => {
      let row = this.rows.get(y);
      if (!row) { row = []; this.rows.set(y, row); }
      row.push([start, end]);
    };
    for (const run of runs) {
      const x1 = run.start.x, y1 = run.start.y, x2 = run.end.x, y2 = run.end.y;
      if (x1 !== x2 && y1 !== y2) throw new Error("World cell runs must be axis aligned");
      if (y1 === y2) add(y1, Math.min(x1, x2), Math.max(x1, x2));
      else for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) add(y, x1, x1);
    }
    for (const [y, spans] of this.rows) {
      const row = merge(spans); this.rows.set(y, row);
      for (const [start, end] of row) this.size += end - start + 1;
    }
  }

  private firstEndingAt(row: readonly Span[], x: number): number {
    let left = 0, right = row.length;
    while (left < right) { const middle = (left + right) >>> 1; if (row[middle]![1] < x) left = middle + 1; else right = middle; }
    return left;
  }

  has(x: number, y: number): boolean {
    const row = this.rows.get(y); if (!row) return false;
    const span = row[this.firstEndingAt(row, x)];
    return !!span && span[0] <= x;
  }

  addCell({ x, y }: Cell): void {
    if (this.has(x, y)) return;
    let row = this.rows.get(y);
    if (!row) { row = []; this.rows.set(y, row); }
    const index = this.firstEndingAt(row, x - 1), next = row[index];
    if (next && next[0] <= x + 1) {
      next[0] = Math.min(next[0], x); next[1] = Math.max(next[1], x);
      const following = row[index + 1];
      if (following && following[0] <= next[1] + 1) { next[1] = Math.max(next[1], following[1]); row.splice(index + 1, 1); }
    } else row.splice(index, 0, [x, x]);
    this.size++; this.boundaryCache = undefined; this.outlineCache = undefined; this.cellsCache = undefined;
  }

  intersects(bounds: Rect): boolean {
    for (const [y, row] of this.rows) {
      if (y < bounds.minY || y > bounds.maxY) continue;
      const span = row[this.firstEndingAt(row, bounds.minX)];
      if (span && span[0] <= bounds.maxX) return true;
    }
    return false;
  }

  cells(): Cell[] {
    if (!this.cellsCache) {
      this.cellsCache = [];
      for (const [y, row] of [...this.rows].sort((a, b) => a[0] - b[0]))
        for (const [start, end] of row) for (let x = start; x <= end; x++) this.cellsCache.push({ x, y });
    }
    return this.cellsCache;
  }

  boundary(): readonly Cell[] {
    if (!this.boundaryCache) {
      this.boundaryCache = [];
      for (const [y, row] of [...this.rows].sort((a, b) => a[0] - b[0])) {
        const spans = merge([...row.flatMap(([start, end]): Span[] => [[start, start], [end, end]]),
          ...subtract(row, this.rows.get(y - 1) ?? []), ...subtract(row, this.rows.get(y + 1) ?? [])]);
        for (const [start, end] of spans) for (let x = start; x <= end; x++) this.boundaryCache.push({ x, y });
      }
    }
    return this.boundaryCache;
  }

  outline(): readonly DistrictOutlineSegment[] {
    if (!this.outlineCache) {
      const horizontal = new Map<number, Span[]>(), vertical = new Map<number, Span[]>();
      const add = (target: Map<number, Span[]>, axis: number, spans: Span[]) => {
        const existing = target.get(axis); if (existing) existing.push(...spans); else target.set(axis, spans);
      };
      for (const [y, row] of this.rows) {
        add(horizontal, y, subtract(row, this.rows.get(y - 1) ?? []));
        add(horizontal, y + 1, subtract(row, this.rows.get(y + 1) ?? []));
        for (const [start, end] of row) { add(vertical, start, [[y, y]]); add(vertical, end + 1, [[y, y]]); }
      }
      this.outlineCache = [];
      for (const [y, spans] of [...horizontal].sort((a, b) => a[0] - b[0])) for (const [start, end] of merge(spans))
        this.outlineCache.push({ from: { x: start, y }, to: { x: end + 1, y } });
      for (const [x, spans] of [...vertical].sort((a, b) => a[0] - b[0])) for (const [start, end] of merge(spans))
        this.outlineCache.push({ from: { x, y: start }, to: { x, y: end + 1 } });
    }
    return this.outlineCache;
  }
}
