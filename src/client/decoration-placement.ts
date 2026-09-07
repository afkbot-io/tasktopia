import type { Cell } from "../shared/contracts";

type Footprint = { width: number; height: number };

/** Pixel position for a bottom-centre prop anchor. */
export function decorationWorldAnchor(kind: string, origin: Cell, footprint: Footprint, cellSize: number): Cell {
  return {
    x: origin.x * cellSize + footprint.width * cellSize / 2,
    y: origin.y * cellSize + footprint.height * cellSize - (kind.startsWith("tree-") ? cellSize / 2 : 0),
  };
}
