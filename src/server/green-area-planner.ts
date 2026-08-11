export type GreenAreaSize = [width: number, height: number];

const GREEN_AREA_SIZES: Readonly<Record<string, readonly (readonly [number, number])[]>> = {
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
export function greenAreaAccentCandidates(width: number, height: number): Array<{ x: number; y: number }> {
  const centerX = Math.floor((width - 1) / 2);
  const centerY = Math.floor((height - 1) / 2);
  const candidates: Array<{ x: number; y: number }> = [];
  for (let y = 1; y < height - 1; y += 2) {
    for (let x = 1; x < width - 1; x += 2) {
      if (x === centerX || y === centerY) continue;
      candidates.push({ x, y });
    }
  }
  return candidates;
}

/** Roughly one accent per ten cells, bounded to avoid both empty and noisy parks. */
export function greenAreaAccentTarget(width: number, height: number): number {
  return Math.min(12, Math.max(4, Math.floor((width * height) / 10)));
}
