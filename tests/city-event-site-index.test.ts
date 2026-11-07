import { expect, it } from 'vitest';
import { createCityEventSiteIndex, prepareCityEventSiteIndexAsync } from '../src/client/city-event-site-index';

const view = { minX: -20, minY: -20, maxX: 20, maxY: 20 };
it('reads local event sites without revisiting ten thousand remote sites', () => {
  const sites = Array.from({ length: 10_000 }, (_, i) => ({ id: `far:${i}`, anchor: { x: 10_000 + i * 64, y: 0 } }));
  sites.push({ id: 'near', anchor: { x: -1, y: -1 } });
  const index = createCityEventSiteIndex(sites, s => s.anchor, s => s.id);
  sites[Symbol.iterator] = () => { throw new Error('full city scan'); };
  expect(index.query(view).items.map(s => s.id)).toEqual(['near']);
  expect(index.query(view).visited).toBe(1);expect(index.query(view).buckets).toBe(4);
  const huge = index.query({ minX: -100_000, minY: -100_000, maxX: 100_000, maxY: 100_000 });
  expect(huge.visited).toBeLessThanOrEqual(4096);expect(huge.buckets).toBeLessThanOrEqual(64);
});

it('prepares the site index cooperatively and cancels before publication', async () => {
  const sites = Array.from({ length: 20_000 }, (_, i) => ({ id: `site:${i}`, anchor: { x: i, y: 0 } }));
  let turns = 0;
  const index = await prepareCityEventSiteIndexAsync(sites, s => s.anchor, s => s.id, { now: () => 0, yieldTask: async () => { turns++; } });
  expect(turns).toBeGreaterThan(1);expect(index.query(view)).toEqual(createCityEventSiteIndex(sites, s => s.anchor, s => s.id).query(view));
  const abort = new AbortController();
  await expect(prepareCityEventSiteIndexAsync(sites, s => s.anchor, s => s.id, { signal: abort.signal, now: () => 0,
    yieldTask: async () => { abort.abort(); } })).rejects.toMatchObject({ name: 'AbortError' });
});
