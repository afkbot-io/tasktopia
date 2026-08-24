import type { Rect } from "./contracts";

export const COUNTRY_ATLAS_BASE_WIDTH_CELLS = 300;
export const COUNTRY_ATLAS_BASE_HEIGHT_CELLS = 169;
export const COUNTRY_ATLAS_LABEL_WIDTH_CELLS = 28;
export const COUNTRY_ATLAS_LABEL_HEIGHT_CELLS = 6;

export function fixedCountryAtlasLabelBounds(anchor: { x: number; y: number }, maxY: number): Rect {
  const minX = Math.round(anchor.x - COUNTRY_ATLAS_LABEL_WIDTH_CELLS / 2);
  return {
    minX,
    minY: maxY - COUNTRY_ATLAS_LABEL_HEIGHT_CELLS + 1,
    maxX: minX + COUNTRY_ATLAS_LABEL_WIDTH_CELLS - 1,
    maxY,
  };
}

function expandBoundsToMinimum(bounds: Rect, minimum?: { width: number; height: number }): Rect {
  if (!minimum) return bounds;
  const width = bounds.maxX - bounds.minX + 1;
  const height = bounds.maxY - bounds.minY + 1;
  const missingX = Math.max(0, minimum.width - width);
  const missingY = Math.max(0, minimum.height - height);
  return {
    minX: bounds.minX - Math.floor(missingX / 2),
    maxX: bounds.maxX + Math.ceil(missingX / 2),
    minY: bounds.minY - Math.floor(missingY / 2),
    maxY: bounds.maxY + Math.ceil(missingY / 2),
  };
}

/** Expand, never crop, an atlas view so its seeded ground fills the host. */
export function fitCountryAtlasBoundsToAspect(
  bounds: Rect,
  targetAspect: number,
  minimum?: { width: number; height: number },
): Rect {
  const expanded = expandBoundsToMinimum(bounds, minimum);
  if (!Number.isFinite(targetAspect) || targetAspect <= 0) return expanded;
  const width = expanded.maxX - expanded.minX + 1;
  const height = expanded.maxY - expanded.minY + 1;
  const currentAspect = width / height;
  if (Math.abs(currentAspect - targetAspect) < 0.005) return expanded;
  if (currentAspect > targetAspect) {
    const targetHeight = Math.ceil(width / targetAspect);
    const missing = targetHeight - height;
    return { ...expanded, minY: expanded.minY - Math.floor(missing / 2), maxY: expanded.maxY + Math.ceil(missing / 2) };
  }
  const targetWidth = Math.ceil(height * targetAspect);
  const missing = targetWidth - width;
  return { ...expanded, minX: expanded.minX - Math.floor(missing / 2), maxX: expanded.maxX + Math.ceil(missing / 2) };
}
