import type { Cell, Rect } from '../shared/contracts';
import { completePreparation, prepareCooperatively, type CooperativePreparationOptions } from '../shared/cooperative-preparation';

export type CityEventSiteIndex<T> = { query: (view: Rect) => { items: T[]; visited: number; buckets: number } };
export function* cityEventSiteIndexSteps<T>(sites: Iterable<T>, anchor: (site: T) => Cell, identity: (site: T) => string): Generator<void, CityEventSiteIndex<T>, void> {
  const buckets = new Map<string, Array<{ site: T; at: Cell; id: string }>>();
  for (const site of sites) {
    yield;
    const at = anchor(site); if (!Number.isFinite(at.x + at.y)) continue;
    const key = `${Math.floor(at.x / 64)},${Math.floor(at.y / 64)}`;
    let bucket = buckets.get(key); if (!bucket) { bucket = []; buckets.set(key, bucket); }
    if (bucket.length < 64) bucket.push({ site, at: { ...at }, id: identity(site) });
  }
  return {
    query(view) {
      let visited = 0, queried = 0;
      if (!Object.values(view).every(Number.isFinite) || view.maxX < view.minX || view.maxY < view.minY) return { items: [], visited, buckets: queried };
      const cx = (view.minX + view.maxX) / 2, cy = (view.minY + view.maxY) / 2;
      const minX = Math.max(Math.floor(view.minX / 64), Math.floor(cx / 64) - 4), minY = Math.max(Math.floor(view.minY / 64), Math.floor(cy / 64) - 4);
      const maxX = Math.min(Math.floor(view.maxX / 64), minX + 7), maxY = Math.min(Math.floor(view.maxY / 64), minY + 7);
      const found: Array<{ site: T; at: Cell; id: string }> = [];
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        queried++;
        for (const record of buckets.get(`${x},${y}`) ?? []) {
          visited++;
          if (record.at.x >= view.minX && record.at.x <= view.maxX && record.at.y >= view.minY && record.at.y <= view.maxY) found.push(record);
        }
      }
      found.sort((a, b) => Math.abs(a.at.x - cx) + Math.abs(a.at.y - cy) - Math.abs(b.at.x - cx) - Math.abs(b.at.y - cy) || a.id.localeCompare(b.id));
      return { items: found.slice(0, 128).map(record => record.site), visited, buckets: queried };
    },
  };
}
export function createCityEventSiteIndex<T>(sites: Iterable<T>, anchor: (site: T) => Cell, identity: (site: T) => string): CityEventSiteIndex<T> {
  return completePreparation(cityEventSiteIndexSteps(sites, anchor, identity));
}
export function prepareCityEventSiteIndexAsync<T>(sites: Iterable<T>, anchor: (site: T) => Cell, identity: (site: T) => string,
  options: CooperativePreparationOptions = {}): Promise<CityEventSiteIndex<T>> {
  return prepareCooperatively(cityEventSiteIndexSteps(sites, anchor, identity), options);
}
