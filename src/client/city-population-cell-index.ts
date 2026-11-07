import type { Cell, Rect } from '../shared/contracts';

export type PopulationCellIndex = { query: (view: Rect, excluded?: Rect) => { cells: Cell[]; buckets: number; visited: number } };
/** Static safe spawn samples. Closures and live body clearance are checked
 * again by mobility; this index never owns or moves an actor. */
export function* populationCellIndexSteps(cells: Iterable<Cell | undefined>, accept: (cell: Cell) => boolean,
  options: { fullSampling?: boolean } = {}): Generator<void, PopulationCellIndex, void> {
  const buckets = new Map<string, { fallback: Cell; cells: Cell[] }>();
  for (const cell of cells) {
    yield;
    if (!cell || !Number.isFinite(cell.x + cell.y) || !accept(cell)) continue;
    const key = `${Math.floor(cell.x / 16)},${Math.floor(cell.y / 16)}`;
    let bucket = buckets.get(key); if (!bucket) { bucket = { fallback: cell, cells: [] }; buckets.set(key, bucket); }
    // A quarter-grid sample covers the whole16×16 bucket instead of retaining
    // only its first rows. A short isolated path still keeps one fallback.
    if ((options.fullSampling || ((Math.imul(cell.x, 73856093) ^ Math.imul(cell.y, 19349663)) & 3) === 0) && bucket.cells.length < 64) bucket.cells.push(cell);
  }
  return {
    query(view, excluded) {
      const cells: Cell[] = []; let queried = 0, visited = 0;
      if (!Object.values(view).every(Number.isFinite) || view.maxX < view.minX || view.maxY < view.minY) return { cells, buckets: queried, visited };
      const cx = (view.minX + view.maxX) / 2, cy = (view.minY + view.maxY) / 2;
      if (excluded && !Object.values(excluded).every(Number.isFinite)) return { cells, buckets: queried, visited };
      const ranges = excluded ? [
        { ...view, maxX: Math.min(view.maxX, Math.ceil(excluded.minX) - 1) },
        { ...view, minX: Math.max(view.minX, Math.floor(excluded.maxX) + 1) },
        { minX: Math.max(view.minX, excluded.minX), maxX: Math.min(view.maxX, excluded.maxX), minY: view.minY, maxY: Math.min(view.maxY, Math.ceil(excluded.minY) - 1) },
        { minX: Math.max(view.minX, excluded.minX), maxX: Math.min(view.maxX, excluded.maxX), minY: Math.max(view.minY, Math.floor(excluded.maxY) + 1), maxY: view.maxY },
      ] : [view];
      const coordinates = new Map<string, { x: number; y: number }>();
      for (const range of ranges) {
        if (range.minX > range.maxX || range.minY > range.maxY) continue;
        const rx = (range.minX + range.maxX) / 2, ry = (range.minY + range.maxY) / 2;
        const minX = Math.max(Math.floor(range.minX / 16), Math.floor(rx / 16) - 8), minY = Math.max(Math.floor(range.minY / 16), Math.floor(ry / 16) - 8);
        const maxX = Math.min(Math.floor(range.maxX / 16), minX + 15), maxY = Math.min(Math.floor(range.maxY / 16), minY + 15);
        for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) coordinates.set(`${x},${y}`, { x, y });
      }
      const local = [...coordinates.values()];
      local.sort((a, b) => Math.abs(a.x * 16 + 8 - cx) + Math.abs(a.y * 16 + 8 - cy)
        - Math.abs(b.x * 16 + 8 - cx) - Math.abs(b.y * 16 + 8 - cy) || a.y - b.y || a.x - b.x);
      const samples: Cell[][] = [];
      for (const bucket of local.slice(0, 256)) {
        queried++;
        const found = buckets.get(`${bucket.x},${bucket.y}`);
        if (found) samples.push(found.cells.length ? found.cells : [found.fallback]);
      }
      const layers = Math.max(0, ...samples.map(sample => sample.length));
      outer: for (let layer = 0; layer < layers; layer++) for (const sample of samples) {
          const cell = sample[layer]; if (!cell) continue;
          visited++;
          if (cell.x >= view.minX && cell.x <= view.maxX && cell.y >= view.minY && cell.y <= view.maxY
            && (!excluded || cell.x < excluded.minX || cell.x > excluded.maxX || cell.y < excluded.minY || cell.y > excluded.maxY)) cells.push(cell);
          if (cells.length >= 512 || visited >= 2048) break outer;
      }
      cells.sort((a, b) => Math.abs(a.x - cx) + Math.abs(a.y - cy) - Math.abs(b.x - cx) - Math.abs(b.y - cy) || a.y - b.y || a.x - b.x);
      return { cells, buckets: queried, visited };
    },
  };
}
