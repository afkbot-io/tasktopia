import { loadCitySceneWithTimeout } from "./city-scene-deadline";
import { CITY_SCENE_SCHEMA_VERSION, type CitySceneDto } from "../shared/city-scene-contract";
import type { CountryOverviewDto } from "../shared/country-overview-contract";
import { citySceneResponseMetrics, loadCitySceneResponse } from "./city-scene-response";
import { CITY_SCENE_DATA_BUDGET, estimateCitySceneDataWeight } from "../shared/city-scene-weight";
import type { RealtimeEvent } from "../shared/contracts";
import { countryOverviewEventImpact } from "../shared/country-overview-events";
import { eventInvalidation, mapInvalidationAffectsCity, mapInvalidationImpact } from "./map-invalidation";

/** Session-local, bounded data reuse. A revision is part of the key, not a TTL. */
export class RevisionCache<T> {
  private readonly values = new Map<string, T>();
  private readonly pending = new Map<string, Promise<T>>();
  private readonly weights=new Map<string,number>();
  constructor(private readonly capacity: number,private readonly budget?:{limit:number;weight:(value:T)=>number}) {}
  private retain(key:string,value:T):void {
    const weight=this.budget?.weight(value)??1;
    if(this.budget&&weight>this.budget.limit)return;
    this.values.delete(key);this.values.set(key,value);this.weights.set(key,weight);
    while(this.values.size>this.capacity||this.budget&&[...this.weights.values()].reduce((a,b)=>a+b,0)>this.budget.limit) {
      const oldest=this.values.keys().next().value!;this.values.delete(oldest);this.weights.delete(oldest);
    }
  }
  peek(key: string): T | undefined { return this.values.get(key); }
  clear(): void { this.values.clear(); this.pending.clear(); this.weights.clear(); }
  delete(key: string): void { this.values.delete(key); this.pending.delete(key); this.weights.delete(key); }
  keys(): string[] { return [...new Set([...this.values.keys(), ...this.pending.keys()])]; }
  hasPending(key: string): boolean { return this.pending.has(key); }
  promote(from: string, to: string): void {
    if (from === to) return;
    const value = this.values.get(from);
    const pending = this.pending.get(from);
    this.delete(from);
    if (value !== undefined || pending) this.delete(to);
    if (value !== undefined) {
      this.retain(to,value);
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
        this.retain(key,value);
      }
      return value;
    }).finally(() => { if (this.pending.get(key) === promise) this.pending.delete(key); });
    this.pending.set(key, promise);
    return promise;
  }
}

/** Conservative retained-heap estimate. Memoized by immutable DTO identity,
 * stops at the budget and avoids allocating a second full JSON string. */
const sceneWeights=new WeakMap<CitySceneDto,number>();
export function citySceneDataWeight(scene:CitySceneDto):number {
  const existing=sceneWeights.get(scene);if(existing!==undefined)return existing;
  const weight=citySceneResponseMetrics(scene)?.retainedWeight??estimateCitySceneDataWeight(scene);
  sceneWeights.set(scene,weight);return weight;
}
export const citySceneCache = new RevisionCache<CitySceneDto>(3,{limit:CITY_SCENE_DATA_BUDGET,weight:citySceneDataWeight});
export const countrySceneCache = new RevisionCache<CountryOverviewDto>(2);
type SceneReadIdentity = {
  countryId: string; cityId: string; worldVersion: number; sceneRevision: string;
  session: number; transport: number; dirty: number; snapshot: number; generation: number;
};
const successfulSceneReads = new WeakMap<CitySceneDto, SceneReadIdentity>();
const latestSceneReadGenerations = new Map<string, number>();
const countrySnapshotEpochs = new Map<string, number>();
let retainedCityScene: { scene: WeakRef<CitySceneDto>; identity: SceneReadIdentity; owner: symbol } | undefined;

const sceneScope = (countryId: string, cityId: string) => `${countryId}:${cityId}`;
const dirtySceneRevision = (countryId: string, cityId: string) => Math.max(
  dirtySceneRevisions.get(countryId) ?? 0, dirtySceneRevisions.get(sceneScope(countryId, cityId)) ?? 0,
);
function validSceneIdentity(scene: CitySceneDto, identity: SceneReadIdentity): boolean {
  return scene.sceneRevision === identity.sceneRevision && scene.city.id === identity.cityId
    && identity.session === sessionEpoch && identity.transport === transportEpoch
    && identity.worldVersion >= (latestCountryRevisions.get(identity.countryId) ?? 0)
    && identity.dirty === dirtySceneRevision(identity.countryId, identity.cityId)
    && identity.snapshot === (countrySnapshotEpochs.get(identity.countryId) ?? 0)
    && identity.generation === latestSceneReadGenerations.get(sceneScope(identity.countryId, identity.cityId));
}

/** Register data already owned by the retained canvas, without admitting it
 * to the bounded strong cache. The returned cleanup belongs to this owner. */
export function retainCityScene(scene: CitySceneDto): () => void {
  const identity = successfulSceneReads.get(scene);
  if (!identity || !validSceneIdentity(scene, identity)) return () => undefined;
  const owner = Symbol();
  retainedCityScene = { scene: new WeakRef(scene), identity, owner };
  return () => { if (retainedCityScene?.owner === owner) retainedCityScene = undefined; };
}
function retainedSceneFor(countryId: string, cityId: string, revision: number): CitySceneDto | undefined {
  const retained = retainedCityScene, scene = retained?.scene.deref();
  if (!retained) return;
  if (!scene || !validSceneIdentity(scene, retained.identity)) { retainedCityScene = undefined; return; }
  if (retained.identity.countryId === countryId && retained.identity.cityId === cityId && retained.identity.worldVersion === revision) return scene;
}

const latestCountryRevisions = new Map<string, number>();
const dirtySceneRevisions = new Map<string, number>();
let sessionEpoch = 0;
let transportEpoch = 0;
export function invalidateTransportSceneCaches(): void {
  transportEpoch += 1;
  citySceneCache.clear(); countrySceneCache.clear();
  retainedCityScene = undefined; latestSceneReadGenerations.clear();
}
export function rememberCountryRevision(countryId: string, revision: number): void {
  // A newer bootstrap can include mutations not yet replayed here. Only
  // advanceMapSceneCaches has enough event detail to promote a retained DTO.
  if (revision > (latestCountryRevisions.get(countryId) ?? 0)) {
    countrySnapshotEpochs.set(countryId, (countrySnapshotEpochs.get(countryId) ?? 0) + 1);
  }
  latestCountryRevisions.set(countryId, Math.max(revision, latestCountryRevisions.get(countryId) ?? 0));
}
export function clearMapSceneCaches(): void {
  sessionEpoch += 1;
  citySceneCache.clear(); countrySceneCache.clear();
  latestCountryRevisions.clear(); dirtySceneRevisions.clear();
  retainedCityScene = undefined; latestSceneReadGenerations.clear(); countrySnapshotEpochs.clear();
}
export function advanceMapSceneCaches(event: RealtimeEvent): void {
  const previousRevision = latestCountryRevisions.get(event.countryId) ?? 0;
  const unknownGap = previousRevision > 0 && event.worldVersion > previousRevision + 1;
  const invalidation = { ...eventInvalidation(event), ...(unknownGap ? { resync: true } : {}) };
  const visual = mapInvalidationImpact(invalidation) !== "NONE";
  const retained = retainedCityScene, retainedValue = retained?.scene.deref();
  const retainedWasValid = retained && retainedValue && validSceneIdentity(retainedValue, retained.identity);
  latestCountryRevisions.set(event.countryId, Math.max(event.worldVersion, latestCountryRevisions.get(event.countryId) ?? 0));
  if (visual) {
    const scope = !invalidation.cityId || mapInvalidationAffectsCity(invalidation, "__remote_city__")
      ? event.countryId : `${event.countryId}:${invalidation.cityId}`;
    dirtySceneRevisions.set(scope, Math.max(event.worldVersion, dirtySceneRevisions.get(scope) ?? 0));
  }
  if (retained?.identity.countryId === event.countryId) {
    if (!retainedWasValid || visual && mapInvalidationAffectsCity(invalidation, retained.identity.cityId)) retainedCityScene = undefined;
    else retained.identity.worldVersion = Math.max(retained.identity.worldVersion, event.worldVersion);
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
    if (unknownGap || countryOverviewEventImpact(event) !== "NONE") countrySceneCache.delete(key);
    else {
      const target = `${country}:${event.worldVersion}`;
      if (countrySceneCache.keys().includes(target)) countrySceneCache.delete(key);
      else countrySceneCache.promote(key, target);
    }
  }
}
export async function loadCityScene(countryId: string, cityId: string, revision: number, force = false,
  load = () => loadCitySceneWithTimeout(signal => loadCitySceneResponse(`/api/countries/${countryId}/cities/${cityId}/scene`,signal))): Promise<CitySceneDto> {
  const epoch = sessionEpoch;
  const dirtyRevision = () => dirtySceneRevision(countryId, cityId);
  for (;;) {
    const requestedRevision = Math.max(revision, latestCountryRevisions.get(countryId) ?? 0);
    const dirtyAtRequest = dirtyRevision(), transportAtRequest = transportEpoch;
    const snapshotAtRequest = countrySnapshotEpochs.get(countryId) ?? 0;
    const key = `${countryId}:${cityId}:${requestedRevision}`;
    const scope = sceneScope(countryId, cityId);
    let readGeneration = latestSceneReadGenerations.get(scope) ?? 0;
    if (force) {
      citySceneCache.delete(key); force = false;
      if (retainedCityScene?.identity.countryId === countryId && retainedCityScene.identity.cityId === cityId) retainedCityScene = undefined;
    }
    const retained = retainedSceneFor(countryId, cityId, requestedRevision);
    const scene = await (retained ? Promise.resolve(retained) : citySceneCache.read(key, async () => {
      const generation = (latestSceneReadGenerations.get(scope) ?? 0) + 1;
      readGeneration = generation;
      latestSceneReadGenerations.set(scope, generation);
      const scene = await load();
      if (scene.schemaVersion !== CITY_SCENE_SCHEMA_VERSION || scene.city.id !== cityId || scene.lod !== "DETAIL") throw new Error("Сервер вернул несовместимую сцену города");
      if (generation === latestSceneReadGenerations.get(scope) && epoch === sessionEpoch && transportAtRequest === transportEpoch
        && dirtyRevision() === dirtyAtRequest && snapshotAtRequest === (countrySnapshotEpochs.get(countryId) ?? 0)) {
        // The fences above allow only known unaffected events to have advanced
        // the country while this read was in flight; a bootstrap has its own epoch.
        successfulSceneReads.set(scene, { countryId, cityId, worldVersion: Math.max(requestedRevision, latestCountryRevisions.get(countryId) ?? 0), sceneRevision: scene.sceneRevision,
          session: epoch, transport: transportAtRequest, dirty: dirtyAtRequest, snapshot: snapshotAtRequest, generation });
      }
      return scene;
    }));
    if (epoch !== sessionEpoch) throw new DOMException("Map session changed", "AbortError");
    // The destination can change while a different retained city ACKs events.
    // Fence the transition result itself, not only publication into the cache.
    if (dirtyRevision() > dirtyAtRequest || transportAtRequest !== transportEpoch
      || snapshotAtRequest !== (countrySnapshotEpochs.get(countryId) ?? 0)
      || readGeneration !== (latestSceneReadGenerations.get(scope) ?? 0)) continue;
    return scene;
  }
}
