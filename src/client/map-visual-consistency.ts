import type { Rect } from "../shared/contracts";

/** Complete square cells approximate the planet's round silhouette. */
export function pixelPlanetRows(bounds: Rect, step = 8): Array<{ x: number; y: number; width: number; height: number }> {
  const cx = (bounds.minX + bounds.maxX) / 2, cy = (bounds.minY + bounds.maxY) / 2;
  const rx = (bounds.maxX - bounds.minX) / 2, ry = (bounds.maxY - bounds.minY) / 2;
  if (rx <= 0 || ry <= 0 || step <= 0) return [];
  const rows = [];
  for (let y = Math.ceil(bounds.minY / step) * step; y + step <= bounds.maxY; y += step) {
    const half = rx * Math.sqrt(Math.max(0, 1 - ((y + step / 2 - cy) / ry) ** 2));
    const x = Math.ceil((cx - half) / step) * step;
    const end = Math.floor((cx + half) / step) * step;
    if (end > x) rows.push({ x, y, width: end - x, height: step });
  }
  return rows;
}
