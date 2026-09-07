import type { Cell } from "../shared/contracts";

/** Semantic ownership, never the enclosing navigation rectangle. Coordinates
 * passed to this hit area are local map pixels, including negative cells. */
export function createDistrictTerritory(cells: readonly Cell[], cellSize: number) {
  const owned = new Map(cells.map(cell => [`${cell.x}:${cell.y}`, cell]));
  const cellAt = (x: number, y: number) => owned.get(`${Math.floor(x / cellSize)}:${Math.floor(y / cellSize)}`);
  return {
    contains: (x: number, y: number) => Boolean(cellAt(x, y)),
    anchorAt: (x: number, y: number): Cell | undefined => cellAt(x, y),
  };
}
