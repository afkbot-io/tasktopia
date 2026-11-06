import type { Cell, Rect } from "../shared/contracts";

type Footprint = { width: number; height: number };

/** Pixel position for a bottom-centre prop anchor. */
export function decorationWorldAnchor(kind: string, origin: Cell, footprint: Footprint, cellSize: number): Cell {
  return {
    x: origin.x * cellSize + footprint.width * cellSize / 2,
    y: origin.y * cellSize + footprint.height * cellSize - (kind.startsWith("tree-") ? cellSize / 2 : 0),
  };
}

/** Inclusive grid cells touched by the same unscaled sprite used for drawing. */
export function decorationSpriteCellBounds(kind: string, origin: Cell,
  metadata: { footprint: Footprint; size: Footprint; anchor: Cell }, cellSize: number): Rect {
  const anchor = decorationWorldAnchor(kind, origin, metadata.footprint, cellSize);
  const left = anchor.x - metadata.anchor.x, top = anchor.y - metadata.anchor.y;
  return { minX: Math.floor(left / cellSize), minY: Math.floor(top / cellSize),
    maxX: Math.ceil((left + metadata.size.width) / cellSize) - 1,
    maxY: Math.ceil((top + metadata.size.height) / cellSize) - 1 };
}
