import type { Cell } from "../shared/contracts";

/** Centered ground interpolation for static-pose animals; pedestrians use their mobility path position. */
export function residentGroundPosition(
  current: Cell,
  next: Cell,
  progress: number,
  cellSize: number,
): { x: number; y: number } {
  const clamped = Math.max(0, Math.min(1, progress));
  return {
    x: (current.x + (next.x - current.x) * clamped) * cellSize + cellSize / 2,
    y: (current.y + (next.y - current.y) * clamped) * cellSize + cellSize / 2,
  };
}
