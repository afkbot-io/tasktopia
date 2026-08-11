import type { Cell } from "./contracts";

function cellKey(cell: Cell): string {
  return `${cell.x},${cell.y}`;
}

/** Visible and navigable park paths: perimeter plus a central cross in large areas. */
export function greenAreaPathCells(footprint: Cell[]): Cell[] {
  if (footprint.length === 0) return [];
  const occupied = new Set(footprint.map(cellKey));
  const minX = Math.min(...footprint.map((cell) => cell.x));
  const maxX = Math.max(...footprint.map((cell) => cell.x));
  const minY = Math.min(...footprint.map((cell) => cell.y));
  const maxY = Math.max(...footprint.map((cell) => cell.y));
  const centerX = Math.floor((minX + maxX) / 2);
  const centerY = Math.floor((minY + maxY) / 2);
  const hasInteriorPaths = maxX - minX >= 6 && maxY - minY >= 5;
  return footprint.filter((cell) => {
    const boundary = [
      { x: cell.x, y: cell.y - 1 },
      { x: cell.x + 1, y: cell.y },
      { x: cell.x, y: cell.y + 1 },
      { x: cell.x - 1, y: cell.y },
    ].some((neighbor) => !occupied.has(cellKey(neighbor)));
    return boundary || hasInteriorPaths && (cell.x === centerX || cell.y === centerY);
  });
}
