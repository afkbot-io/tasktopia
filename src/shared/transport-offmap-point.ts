import type { Cell, Rect } from "./contracts";

/** A foreign airport has no coordinates in this country's CITY space. Preserve
 * its atlas bearing and put the remote end safely beyond the local viewport. */
export function transportOffmapPoint(local: Cell, atlasLocal: Cell, atlasRemote: Cell, bounds: Rect): Cell {
  const dx = atlasRemote.x - atlasLocal.x, dy = atlasRemote.y - atlasLocal.y;
  const length = Math.hypot(dx, dy);
  const distance = Math.max(160, bounds.maxX - bounds.minX + 1, bounds.maxY - bounds.minY + 1) * 3;
  return length > 0 ? { x: local.x + dx / length * distance, y: local.y + dy / length * distance }
    : { x: local.x + distance, y: local.y };
}
