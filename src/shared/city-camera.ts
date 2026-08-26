import type { Rect } from "./contracts";

export const CITY_CAMERA_FRAME_WIDTH = 160;
export const CITY_CAMERA_FRAME_HEIGHT = 100;
export const CITY_CAMERA_MIN_SCALE = 0.8;

function frameAxis(center: number, min: number, max: number, size: number): [number, number] {
  const extent = max - min + 1;
  let start = Math.round(center) - Math.floor(size / 2);
  if (extent >= size) start = Math.max(min, Math.min(max - size + 1, start));
  return [start, start + size - 1];
}

/** A city always opens through the same world-space territory, even before it grows into it. */
export function cityDetailFocusBounds(center: { x: number; y: number }, bounds: Rect): Rect {
  const [minX, maxX] = frameAxis(center.x, bounds.minX, bounds.maxX, CITY_CAMERA_FRAME_WIDTH);
  const [minY, maxY] = frameAxis(center.y, bounds.minY, bounds.maxY, CITY_CAMERA_FRAME_HEIGHT);
  return { minX, minY, maxX, maxY };
}
