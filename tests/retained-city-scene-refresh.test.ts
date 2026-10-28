import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RetainedCitySceneRefresh } from "../src/client/retained-city-scene-refresh";
import { advanceMapSceneCaches, citySceneCache, clearMapSceneCaches, invalidateTransportSceneCaches, loadCityScene, rememberCountryRevision,
  retainCityScene } from "../src/client/map-scene-cache";
import * as weight from "../src/shared/city-scene-weight";
import { CITY_SCENE_SCHEMA_VERSION, type CitySceneDto } from "../src/shared/city-scene-contract";
import type { RealtimeEvent } from "../src/shared/contracts";

const scene = (revision: string, cityId = "city") => ({ schemaVersion: CITY_SCENE_SCHEMA_VERSION,
  sceneRevision: revision, city: { id: cityId }, lod: "DETAIL", chunks: [] } as unknown as CitySceneDto);
const event = (version: number): RealtimeEvent => ({ id: version, countryId: "country", worldVersion: version,
  type: "task.created", payload: { cityId: "city", taskId: "t", groundRoadTopologyChanged: false }, createdAt: "2026-10-28" });
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
beforeEach(() => {
  clearMapSceneCaches(); rememberCountryRevision("country", 1);
  vi.spyOn(weight, "estimateCitySceneDataWeight").mockReturnValue(weight.CITY_SCENE_DATA_BUDGET + 1);
});
afterEach(() => { clearMapSceneCaches(); vi.restoreAllMocks(); vi.useRealTimers(); });

it("reuses a committed MCP refresh on three warm and twenty card returns without another oversized scene GET", async () => {
  const initial = scene("initial"), updated = scene("updated");
  const load = vi.fn().mockResolvedValueOnce(initial).mockResolvedValue(updated);
  let prepared: CitySceneDto | undefined = await loadCityScene("country", "city", 1, false, load);
  const releaseInitial = retainCityScene(prepared);
  const owner = new RetainedCitySceneRefresh("country", "city", 1, value => { prepared = value; });
  advanceMapSceneCaches(event(2));
  let installed = initial;
  await owner.request(value => { installed = value; }, load);
  releaseInitial(); // The previous App effect cannot revoke the canvas lease.
  expect(prepared).toBe(updated); expect(installed).toBe(updated);
  for (let i = 0; i < 23; i++) expect(await loadCityScene("country", "city", 2, false, load)).toBe(updated);
  expect(load).toHaveBeenCalledTimes(2);
  expect(citySceneCache.keys()).toEqual([]);
  owner.dispose();
});

it.each(["cancel", "dispose"] as const)("never commits or leases a late transport after %s, and permits a fresh read", async kind => {
  const old = scene("cancelled"), fresh = scene("fresh"), waiting = deferred<CitySceneDto>();
  const load = vi.fn().mockReturnValueOnce(waiting.promise).mockResolvedValue(fresh);
  const committed = vi.fn(), install = vi.fn();
  const owner = new RetainedCitySceneRefresh("country", "city", 1, committed);
  const pending = owner.request(install, load);
  const failed = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await Promise.resolve();
  owner[kind]();
  await failed;
  waiting.resolve(old);
  await vi.waitFor(() => expect(citySceneCache.keys()).toEqual([]));
  expect(install).not.toHaveBeenCalled(); expect(committed).not.toHaveBeenCalled();
  expect(await loadCityScene("country", "city", 1, false, load)).toBe(fresh);
  expect(load).toHaveBeenCalledTimes(2);
  owner.dispose();
});

it.each(["dirty", "bootstrap", "transport"])("re-reads instead of installing a response invalidated by %s while in flight", async reason => {
  const old = scene("old"), fresh = scene("fresh"), waiting = deferred<CitySceneDto>();
  const load = vi.fn().mockReturnValueOnce(waiting.promise).mockResolvedValue(fresh);
  const install = vi.fn(), committed = vi.fn();
  const owner = new RetainedCitySceneRefresh("country", "city", 1, committed);
  const pending = owner.request(install, load); await Promise.resolve();
  if (reason === "dirty") advanceMapSceneCaches(event(2));
  if (reason === "bootstrap") rememberCountryRevision("country", 2);
  if (reason === "transport") invalidateTransportSceneCaches();
  waiting.resolve(old); await pending;
  expect(install.mock.calls).toEqual([[fresh]]); expect(committed.mock.calls).toEqual([[fresh]]);
  expect(await loadCityScene("country", "city", 1, false, load)).toBe(fresh);
  expect(load).toHaveBeenCalledTimes(2); owner.dispose();
});

it("rejects the old country/session read and never revokes the replacement owner's lease", async () => {
  const old = scene("old-country"), fresh = scene("new-country"), waiting = deferred<CitySceneDto>();
  const load = vi.fn().mockReturnValueOnce(waiting.promise).mockResolvedValue(fresh);
  const install = vi.fn(), committed = vi.fn();
  const owner = new RetainedCitySceneRefresh("country", "city", 1, committed);
  const pending = owner.request(install, load); await Promise.resolve();
  const failed = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  clearMapSceneCaches(); rememberCountryRevision("foreign", 1);
  const replacement = new RetainedCitySceneRefresh("foreign", "city", 1);
  await replacement.request(() => undefined, load);
  waiting.resolve(old); await failed;
  expect(install).not.toHaveBeenCalled(); expect(committed).not.toHaveBeenCalled();
  owner.dispose();
  expect(await loadCityScene("foreign", "city", 1, false, load)).toBe(fresh);
  expect(load).toHaveBeenCalledTimes(2);
  replacement.dispose();
  await loadCityScene("foreign", "city", 1, false, load); expect(load).toHaveBeenCalledTimes(3);
});

it("retains the existing scheduler's one trailing read and publishes only successfully installed scenes", async () => {
  const first = scene("first"), fresh = scene("fresh"), waiting = deferred<CitySceneDto>();
  const load = vi.fn().mockReturnValueOnce(waiting.promise).mockResolvedValue(fresh);
  const install = vi.fn(), committed = vi.fn();
  const owner = new RetainedCitySceneRefresh("country", "city", 1, committed);
  const pending = owner.request(install, load);
  expect(owner.request(install, load)).toBe(pending); expect(owner.request(install, load)).toBe(pending);
  await Promise.resolve(); waiting.resolve(first); await pending;
  expect(install.mock.calls).toEqual([[first], [fresh]]); expect(committed.mock.calls).toEqual([[first], [fresh]]);
  expect(await loadCityScene("country", "city", 1, false, load)).toBe(fresh);
  expect(load).toHaveBeenCalledTimes(2); owner.dispose();

  const rejected = new RetainedCitySceneRefresh("country", "city", 1, committed);
  committed.mockClear();
  await rejected.request(() => false, load);
  expect(committed).not.toHaveBeenCalled();
  await loadCityScene("country", "city", 1, false, load); expect(load).toHaveBeenCalledTimes(4);
  rejected.dispose();
});

it("aborts a hung refresh at the existing30s deadline and can retry", async () => {
  vi.useFakeTimers();
  let signal!: AbortSignal;
  const committed = vi.fn(), owner = new RetainedCitySceneRefresh("country", "city", 1, committed);
  const pending = owner.request(() => undefined, current => { signal = current; return new Promise<CitySceneDto>(() => undefined); });
  const failed = expect(pending).rejects.toThrow("слишком долго");
  await vi.advanceTimersByTimeAsync(30_001); await failed;
  expect(signal.aborted).toBe(true); expect(committed).not.toHaveBeenCalled();
  const fresh = scene("retry"), load = vi.fn().mockResolvedValue(fresh);
  await owner.request(() => undefined, load);
  expect(committed.mock.calls).toEqual([[fresh]]); expect(vi.getTimerCount()).toBe(0);
  owner.dispose();
});
