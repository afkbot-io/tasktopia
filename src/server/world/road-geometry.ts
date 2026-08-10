import type { Cell, RoadCellDto } from "../../shared/contracts";
import { cellKey } from "./grid";

export type RoadWidthPolicy = Record<RoadCellDto["roadClass"], number>;

export function centeredRoadOffsets(width: number): number[] {
  if (!Number.isInteger(width) || width < 1) throw new Error(`Invalid road width: ${width}`);
  const start = -Math.floor(width / 2);
  return Array.from({ length: width }, (_, index) => start + index);
}

/**
 * Expands an orthogonal centerline into a canonical asphalt envelope.
 *
 * The operation deliberately ignores existing asphalt: callers union the
 * returned cells with the persisted network. This guarantees that a new arm
 * stamps its complete width through an existing street instead of collapsing
 * to the one-cell centerline at the junction.
 */
export function stampRoadCorridor(
  path: Cell[],
  roadClass: RoadCellDto["roadClass"],
  widths: RoadWidthPolicy,
): Cell[] {
  const offsets = centeredRoadOffsets(widths[roadClass]);
  const corridor = new Map<string, Cell>();
  const add = (cell: Cell) => corridor.set(cellKey(cell), cell);

  for (let index = 0; index < path.length; index += 1) {
    const cell = path[index]!;
    const previous = path[index - 1];
    const next = path[index + 1];
    const horizontal = Boolean(previous && previous.x !== cell.x || next && next.x !== cell.x);
    const vertical = Boolean(previous && previous.y !== cell.y || next && next.y !== cell.y);

    if (horizontal && vertical) {
      // A square turn envelope is the Chebyshev buffer of the centerline.
      // Without it, the inner corner becomes a one-cell notch with a curb.
      for (const offsetY of offsets) for (const offsetX of offsets) add({ x: cell.x + offsetX, y: cell.y + offsetY });
      continue;
    }
    if (horizontal) for (const offset of offsets) add({ x: cell.x, y: cell.y + offset });
    if (vertical) for (const offset of offsets) add({ x: cell.x + offset, y: cell.y });
    if (!horizontal && !vertical) add(cell);
  }
  return [...corridor.values()];
}

/** Cells that would make a newly stamped road lose part of its full profile. */
export function roadCorridorBlockers(
  path: Cell[],
  roadClass: RoadCellDto["roadClass"],
  widths: RoadWidthPolicy,
  blocked: ReadonlySet<string>,
  existing: ReadonlySet<string> = new Set(),
): Cell[] {
  return stampRoadCorridor(path, roadClass, widths)
    .filter((cell) => blocked.has(cellKey(cell)) && !existing.has(cellKey(cell)));
}
