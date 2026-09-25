import type { ProjectedPlanetAtlas } from '../shared/planet-atlas';

/** Cartographic city glyphs, not a second world layout. Only display icons
 * move: canonical city anchors, terrain, airports and routes stay untouched. */
export function compactPlanetCities(atlas: ProjectedPlanetAtlas): ProjectedPlanetAtlas {
  const step = atlas.hexRadius * 2 * .38;
  return { ...atlas, countries: atlas.countries.map(country => {
    const byCity = new Map<string, typeof country.districtIcons>();
    for (const icon of country.districtIcons) {
      const group = byCity.get(icon.cityId) ?? [];
      group.push(icon); byCity.set(icon.cityId, group);
    }
    const districtIcons = country.cities.flatMap(city => {
      const anchor = country.cityAnchors[city.id]!;
      const source = (byCity.get(city.id) ?? []).sort((a, b) => a.id.localeCompare(b.id));
      const count = Math.min(12, Math.max(3, source.length));
      const columns = Math.ceil(Math.sqrt(count)), rows = Math.ceil(count / columns);
      return Array.from({ length: count }, (_, index) => {
        const row = Math.floor(index / columns), inRow = Math.min(columns, count - row * columns);
        const original = source[index % Math.max(1, source.length)];
        return { id: `${city.id}:miniature:${index}`, cityId: city.id,
          family: original?.family, stage: original?.stage ?? 0,
          point: { x: anchor.x + (index % columns - (inRow - 1) / 2) * step,
            y: anchor.y + (row - (rows - 1) / 2) * step } };
      });
    });
    return { ...country, districtIcons };
  }) };
}

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
      scales.set(icon.id, Math.min(cell / 32, spacing * .8 / 12));
    }
  }
  return scales;
}
