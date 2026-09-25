import { expect, it } from 'vitest';
import { compactPlanetCities } from '../src/client/planet-presentation';
import { projectPlanetAtlas, projectProjectedPlanetMap, type ProjectedPlanetAtlas } from '../src/shared/planet-atlas';

it('собирает ограниченную композицию вокруг настоящего центра, независимо от разброса районов', () => {
  const country = { id: 'c', cities: [{ id: 'town' }], cityAnchors: { town: { x: 100, y: 100 } }, districtIcons: Array.from({ length: 1000 }, (_, i) => ({ id: `d${i}`, cityId: 'town', point: { x: i * 40, y: i * 30 }, family: 'house', stage: 5 })) };
  const base = { hexRadius: 8, countries: [country] } as unknown as ProjectedPlanetAtlas;
  const compact = compactPlanetCities(base);
  const icons = compact.countries[0]!.districtIcons;
  expect(icons.length).toBeGreaterThanOrEqual(3);
  expect(icons.length).toBeLessThanOrEqual(12);
  expect(icons.every(icon => Math.hypot(icon.point.x - 100, icon.point.y - 100) < 16)).toBe(true);
  expect(new Set(icons.map(icon => `${icon.point.x}:${icon.point.y}`)).size).toBe(icons.length);
  expect(compact.countries[0]!.cityAnchors).toBe(country.cityAnchors);
  expect(base.countries[0]!.districtIcons).toHaveLength(1000);
  expect(compactPlanetCities({ ...base, countries: [{ ...base.countries[0]!, districtIcons: [...country.districtIcons].reverse() }] })).toEqual(compact);
});

it('кадр камеры не пересчитывает клетки рельефа при готовом растре', () => {
  const base = projectPlanetAtlas({ schemaVersion: 4, planetSeed: 12345, revision: 'test', countries: [] });
  base.coastCells = Array.from({ length: 1000 }, (_, i) => ({ id: `coast${i}`, q: i % 100, r: Math.floor(i / 100), terrain: 'coast' }));
  const camera = { panX: .4, panY: -.2, zoom: 8.5 };
  const full = projectProjectedPlanetMap(base, camera);
  const frame = projectProjectedPlanetMap(base, camera, { terrain: false });
  expect(frame.coastCells).toEqual([]);
  expect(frame.surface).toEqual(full.surface);
  expect(frame.clouds).toEqual(full.clouds);
  expect(frame.routes).toEqual(full.routes);
});
