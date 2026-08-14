export type GreenAreaSize = [width: number, height: number];

/**
 * Desired ambient green areas for a developed district. The first area is
 * mandatory; subsequent parks follow the visible workload at roughly one
 * area per six occupied task lots. The cap keeps parks meaningful without
 * replacing the task city with greenery.
 */
export function greenAreaTarget(taskLotCount: number): number {
  if (taskLotCount <= 0) return 1;
  return Math.min(4, 1 + Math.floor(taskLotCount / 6));
}

const GREEN_AREA_SIZES: Readonly<Record<string, readonly (readonly [number, number])[]>> = {
  "urban-formal": [[18, 10], [16, 9], [14, 8]],
  "urban-community": [[16, 10], [14, 9], [12, 8]],
  "urban-central": [[12, 10], [10, 9], [8, 7]],
  "urban-botanical": [[10, 9], [8, 8], [7, 6]],
  "urban-amusement": [[10, 8], [8, 7], [7, 5]],
  "urban-grove": [[8, 7], [7, 6], [6, 5]],
  "urban-park": [[7, 6], [6, 5], [5, 4]],
};

/** Largest-first policy with compact fallbacks for already dense districts. */
export function greenAreaSizeCandidates(assetKey: string): GreenAreaSize[] {
  return (GREEN_AREA_SIZES[assetKey] ?? GREEN_AREA_SIZES["urban-park"]!).map(([width, height]) => [width, height]);
}

/**
 * Interior cells available to size-aware decor. The central cross is reserved
 * for pedestrian paths, while a one-cell perimeter keeps props off the border.
 */
export function greenAreaAccentCandidates(width: number, height: number, assetKey = "urban-park"): Array<{ x: number; y: number }> {
  const footprint = Array.from({ length: width * height }, (_, index) => ({ x: index % width, y: Math.floor(index / width) }));
  const pathCells = new Set(greenAreaPathCells(footprint, assetKey).map((cell) => `${cell.x},${cell.y}`));
  const candidates: Array<{ x: number; y: number }> = [];
  for (let y = 1; y < height - 1; y += 2) {
    for (let x = 1; x < width - 1; x += 2) {
      if (pathCells.has(`${x},${y}`)) continue;
      candidates.push({ x, y });
    }
  }
  return candidates;
}

/** Roughly one accent per ten cells, bounded to avoid both empty and noisy parks. */
export function greenAreaAccentTarget(width: number, height: number): number {
  const area = width * height;
  return Math.min(20, Math.max(4, Math.floor(area / (area >= 64 ? 8 : 10))));
}
import { greenAreaPathCells } from "../shared/green-area";
