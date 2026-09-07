import type { Cell } from "./contracts";
import { hashCoordinate } from "./world-terrain";

/** Conservative projected envelope for all reviewed 12x14px trees, 8px cells. */
export function compactTreeCover(origin: Cell): Cell[] {
  return Array.from({ length: 9 }, (_, i) => ({
    x: origin.x + i % 3 - 1, y: origin.y + Math.floor(i / 3) - 2,
  }));
}

/** Local-minimum thinning has no mutable neighbour state or chunk-order bias. */
export function compactTreeCandidate(seed: number, cell: Cell, woodland = false): boolean {
  // Forests allow adjacent trunks on integer cells: 12×14 crowns overlap at
  // 8px spacing. An independent hash breaks the old regular two-cell lattice;
  // grove density supplies clearings/falloff. No mutable neighbour exclusion.
  if (woodland) return hashCoordinate(seed, cell.x, cell.y, 761) < .64;
  const priority = hashCoordinate(seed, cell.x, cell.y, 701);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (dx === 0 && dy === 0) continue;
    const other = hashCoordinate(seed, cell.x + dx, cell.y + dy, 701);
    if (other < priority || other === priority && (dy < 0 || dy === 0 && dx < 0)) return false;
  }
  return true;
}
