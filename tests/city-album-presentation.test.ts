import { expect, it } from 'vitest';
import { cityAlbumComparison } from '../src/client/city-album-presentation';
import type { CityDevelopmentFacts } from '../src/shared/city-album';
const before: CityDevelopmentFacts = { tasks: 10, buildings: 8, parks: 2, completedTasks: 4, occupiedBlocks: 2, activeDistricts: 1, completedDistricts: 0, readyServices: [{ role: 'EDUCATION', count: 1 }] };
it('compares real development deltas including opened and closed services, excluding unchanged facts', () => {
  expect(cityAlbumComparison(before, { ...before, completedTasks: 5, readyServices: [{ role: 'FIRE', count: 1 }] })).toEqual([
    { label: 'Завершено', before: 4, after: 5 }, { label: 'Школа / детский сад', before: 1, after: 0 }, { label: 'Пожарная часть', before: 0, after: 1 },
  ]);
  expect(cityAlbumComparison(before, before)).toEqual([]);
});
