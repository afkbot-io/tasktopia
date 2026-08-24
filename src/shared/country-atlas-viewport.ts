import type { Rect } from "./contracts";

/** Expand, never crop, an atlas view so its seeded ground fills the host. */
export function fitCountryAtlasBoundsToAspect(bounds: Rect, targetAspect: number): Rect {
  if (!Number.isFinite(targetAspect) || targetAspect <= 0) return bounds;
  const width = bounds.maxX - bounds.minX + 1;
  const height = bounds.maxY - bounds.minY + 1;
  const currentAspect = width / height;
  if (Math.abs(currentAspect - targetAspect) < 0.001) return bounds;
  if (currentAspect > targetAspect) {
    const targetHeight = Math.ceil(width / targetAspect);
    const missing = targetHeight - height;
    return { ...bounds, minY: bounds.minY - Math.floor(missing / 2), maxY: bounds.maxY + Math.ceil(missing / 2) };
  }
  const targetWidth = Math.ceil(height * targetAspect);
  const missing = targetWidth - width;
  return { ...bounds, minX: bounds.minX - Math.floor(missing / 2), maxX: bounds.maxX + Math.ceil(missing / 2) };
}
