import { loadMapWithTimeout } from "./map-load-timeout";
import { CITY_SCENE_SCHEMA_VERSION, type CitySceneDto } from "../shared/city-scene-contract";
import type { CountryOverviewDto } from "../shared/country-overview-contract";
import { api } from "./api";
import type { RealtimeEvent } from "../shared/contracts";
import { countryOverviewEventImpact } from "../shared/country-overview-events";
import { eventInvalidation, mapInvalidationAffectsCity, mapInvalidationImpact } from "./map-invalidation";

/** Session-local, bounded data reuse. A revision is part of the key, not a TTL. */
export class RevisionCache<T> {
  private readonly values = new Map<string, T>();
  private readonly pending = new Map<string, Promise<T>>();
  constructor(private readonly capacity: number) {}
  peek(key: string): T | undefined { return this.values.get(key); }
  clear(): void { this.values.clear(); this.pending.clear(); }
  delete(key: string): void { this.values.delete(key); this.pending.delete(key); }
  keys(): string[] { return [...new Set([...this.values.keys(), ...this.pending.keys()])]; }
  hasPending(key: string): boolean { return this.pending.has(key); }
  promote(from: string, to: string): void {
    if (from === to) return;
    const value = this.values.get(from);
    const pending = this.pending.get(from);
    this.delete(from);
    if (value !== undefined || pending) this.delete(to);
    if (value !== undefined) {
      this.values.set(to, value);
      while (this.values.size > this.capacity) this.values.delete(this.values.keys().next().value!);
    } else if (pending) {
      // A new identity owns publication; clearing either session cannot restore
      // the old key when its original HTTP request eventually completes.
      void this.read(to, () => pending).catch(() => undefined);
    }
  }
  read(key: string, load: () => Promise<T>): Promise<T> {
    const cached = this.values.get(key);
    if (cached !== undefined) {
      this.values.delete(key); this.values.set(key, cached);
      return Promise.resolve(cached);
    }
    const existing = this.pending.get(key);
    if (existing) return existing;
    const promise = load().then((value) => {
      if (this.pending.get(key) === promise) {
        this.values.set(key, value);
        while (this.values.size > this.capacity) this.values.delete(this.values.keys().next().value!);
      }
      return value;
    }).finally(() => { if (this.pending.get(key) === promise) this.pending.delete(key); });
    this.pending.set(key, promise);
    return promise;
  }
}

export const citySceneCache = new RevisionCache<CitySceneDto>(3);
export const countrySceneCache = new RevisionCache<CountryOverviewDto>(2);
const latestCountryRevisions = new Map<string, number>();
const dirtySceneRevisions = new Map<string, number>();
let sessionEpoch = 0;
export function rememberCountryRevision(countryId: string, revision: number): void {
  latestCountryRevisions.set(countryId, Math.max(revision, latestCountryRevisions.get(countryId) ?? 0));
}
export function clearMapSceneCaches(): void {
  sessionEpoch += 1;
  citySceneCache.clear(); countrySceneCache.clear();
  latestCountryRevisions.clear(); dirtySceneRevisions.clear();
}
export function advanceMapSceneCaches(event: RealtimeEvent): void {
  const invalidation = eventInvalidation(event);
  const visual = mapInvalidationImpact(invalidation) !== "NONE";
  rememberCountryRevision(event.countryId, event.worldVersion);
  if (visual) {
    const scope = !invalidation.cityId || mapInvalidationAffectsCity(invalidation, "__remote_city__")
      ? event.countryId : `${event.countryId}:${invalidation.cityId}`;
    dirtySceneRevisions.set(scope, Math.max(event.worldVersion, dirtySceneRevisions.get(scope) ?? 0));
  }
  const byRevision = (a: string, b: string) => Number(b.split(":").at(-1)) - Number(a.split(":").at(-1));
  for (const key of citySceneCache.keys().sort(byRevision)) {
    const [country, city, revision] = key.split(":");
    if (country !== event.countryId || Number(revision) >= event.worldVersion) continue;
    if (visual && mapInvalidationAffectsCity(invalidation, city)) citySceneCache.delete(key);
    else {
      const target = `${country}:${city}:${event.worldVersion}`;
      if (citySceneCache.keys().includes(target)) citySceneCache.delete(key);
      else citySceneCache.promote(key, target);
    }
  }
  for (const key of countrySceneCache.keys().sort(byRevision)) {
    const [country, revision] = key.split(":");
    if (country !== event.countryId || Number(revision) >= event.worldVersion) continue;
    if (countryOverviewEventImpact(event) !== "NONE") countrySceneCache.delete(key);
    else {
      const target = `${country}:${event.worldVersion}`;
      if (countrySceneCache.keys().includes(target)) countrySceneCache.delete(key);
      else countrySceneCache.promote(key, target);
    }
  }
}
export async function loadCityScene(countryId: string, cityId: string, revision: number, force = false,
  load = () => loadMapWithTimeout(signal => api<CitySceneDto>(`/api/countries/${countryId}/cities/${cityId}/scene`, {
      signal, cache: "no-cache", headers: { accept: `application/vnd.tasktopia.city-scene+json; version=${CITY_SCENE_SCHEMA_VERSION}` },
  }))): Promise<CitySceneDto> {
  const epoch = sessionEpoch;
  const dirtyRevision = () => Math.max(dirtySceneRevisions.get(countryId) ?? 0, dirtySceneRevisions.get(`${countryId}:${cityId}`) ?? 0);
  for (;;) {
    const requestedRevision = Math.max(revision, latestCountryRevisions.get(countryId) ?? 0);
    const dirtyAtRequest = dirtyRevision();
    const key = `${countryId}:${cityId}:${requestedRevision}`;
    if (force) { citySceneCache.delete(key); force = false; }
    const scene = await citySceneCache.read(key, async () => {
      const scene = await load();
      if (scene.schemaVersion !== CITY_SCENE_SCHEMA_VERSION || scene.city.id !== cityId || scene.lod !== "DETAIL") throw new Error("Сервер вернул несовместимую сцену города");
      return scene;
    });
    if (epoch !== sessionEpoch) throw new DOMException("Map session changed", "AbortError");
    // The destination can change while a different retained city ACKs events.
    // Fence the transition result itself, not only publication into the cache.
    if (dirtyRevision() > dirtyAtRequest) continue;
    return scene;
  }
}
