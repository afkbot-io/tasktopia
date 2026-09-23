import type { ProjectedPlanetAtlas } from '../shared/planet-atlas';

/** Countries remain annotations of PLANET; there is no country map mode. */
export function planetLabelDetail(zoom: number): 'NONE' | 'COUNTRIES' | 'CITIES' {
  return zoom < 1.25 ? 'NONE' : zoom < 2.6 ? 'COUNTRIES' : 'CITIES';
}

/** Module units are measured against the immutable geographic cell, never
 * against screen zoom. Neighbor spacing bounds each icon without moving towns. */
export function planetMiniatureScales(atlas: ProjectedPlanetAtlas): Map<string, number> {
  const scales = new Map<string, number>();
  const cell = atlas.hexRadius * 2;
  for (const country of atlas.countries) {
    const buckets = new Map<string, typeof country.districtIcons>();
    for (const icon of country.districtIcons) {
      const key = `${Math.floor(icon.point.x / cell)}:${Math.floor(icon.point.y / cell)}`;
      const bucket = buckets.get(key) ?? [];
      bucket.push(icon); buckets.set(key, bucket);
    }
    for (const icon of country.districtIcons) {
      let spacing = Infinity;
      const x = Math.floor(icon.point.x / cell), y = Math.floor(icon.point.y / cell);
      // Only neighbors closer than half a cell can reduce the default size.
      // A spatial grid avoids comparing every city with every other city.
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        for (const other of buckets.get(`${x + dx}:${y + dy}`) ?? []) {
          if (other.id === icon.id) continue;
          const distance = Math.hypot(icon.point.x - other.point.x, icon.point.y - other.point.y);
          if (distance > .001) spacing = Math.min(spacing, distance);
        }
      }
      scales.set(icon.id, Math.min(cell / 40, spacing * .65 / 12));
    }
  }
  return scales;
}
