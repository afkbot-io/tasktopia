import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { advanceMapSceneCaches, citySceneCache, clearMapSceneCaches, invalidateTransportSceneCaches,
  loadCityScene, rememberCountryRevision, retainCityScene } from "../src/client/map-scene-cache";
import * as weight from "../src/shared/city-scene-weight";
import { CITY_SCENE_SCHEMA_VERSION, type CitySceneDto } from "../src/shared/city-scene-contract";
import type { RealtimeEvent } from "../src/shared/contracts";

const scene = (revision: string, cityId = "city"): CitySceneDto => ({
  schemaVersion: CITY_SCENE_SCHEMA_VERSION, sceneRevision: revision, city: { id: cityId }, lod: "DETAIL", chunks: [],
} as unknown as CitySceneDto);
const event = (worldVersion: number, type: string, payload: RealtimeEvent["payload"]): RealtimeEvent => ({
  id: worldVersion, countryId: "country", worldVersion, type, payload, createdAt: "2026-10-28",
});
beforeEach(() => {
  clearMapSceneCaches();
  // Exercise the real oversize admission policy without allocating a second
  // huge DTO merely to establish its already-known retained weight.
  vi.spyOn(weight, "estimateCitySceneDataWeight").mockReturnValue(weight.CITY_SCENE_DATA_BUDGET + 1);
});
afterEach(() => { clearMapSceneCaches(); vi.restoreAllMocks(); });

describe("reuse of the one scene already held by the canvas", () => {
  it("serves initial plus three warm returns and twenty card/history returns with one scene read", async () => {
    const current = scene("current"), load = vi.fn().mockResolvedValue(current);
    expect(await loadCityScene("country", "city", 1, false, load)).toBe(current);
    const release = retainCityScene(current);
    for (let i = 0; i < 23; i++) expect(await loadCityScene("country", "city", 1, false, load)).toBe(current);
    expect(load).toHaveBeenCalledTimes(1);
    expect(citySceneCache.keys()).toEqual([]); // The48MiB strong cap is unchanged.
    release();
  });

  it("promotes only known unaffected events and reloads after a visual task status change", async () => {
    rememberCountryRevision("country", 1);
    const current = scene("current"), next = scene("status"), load = vi.fn().mockResolvedValueOnce(current).mockResolvedValue(next);
    await loadCityScene("country", "city", 1, false, load); retainCityScene(current);
    advanceMapSceneCaches(event(2, "task.comment_added", { cityId: "city", taskId: "t" }));
    advanceMapSceneCaches(event(3, "task.created", { cityId: "other", groundRoadTopologyChanged: false }));
    expect(await loadCityScene("country", "city", 3, false, load)).toBe(current);
    expect(load).toHaveBeenCalledTimes(1);
    advanceMapSceneCaches(event(4, "task.status_changed", { cityId: "city", taskId: "t", status: "TESTING", stage: 4, progress: 90, groundChanged: false }));
    retainCityScene(current); // An old effect cannot relabel it as version4.
    expect(await loadCityScene("country", "city", 4, false, load)).toBe(next);
    expect(load).toHaveBeenCalledTimes(2);
    retainCityScene(next);
    expect(await loadCityScene("country", "city", 4, false, load)).toBe(next);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not let an old owner's cleanup remove a replacement lease", async () => {
    const first = scene("first"), next = scene("next"), load = vi.fn().mockResolvedValueOnce(first).mockResolvedValue(next);
    await loadCityScene("country", "city", 1, false, load); const releaseFirst = retainCityScene(first);
    await loadCityScene("country", "city", 1, true, load); const releaseNext = retainCityScene(next);
    releaseFirst();
    expect(await loadCityScene("country", "city", 1, false, load)).toBe(next);
    expect(load).toHaveBeenCalledTimes(2);
    releaseNext();
    await loadCityScene("country", "city", 1, false, load);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it.each(["session", "transport", "bootstrap", "force", "resync"])("rejects an old lease after %s invalidation", async reason => {
    rememberCountryRevision("country", 1);
    const first = scene("first"), next = scene("next"), load = vi.fn().mockResolvedValueOnce(first).mockResolvedValue(next);
    await loadCityScene("country", "city", 1, false, load); retainCityScene(first);
    if (reason === "session") clearMapSceneCaches();
    if (reason === "transport") invalidateTransportSceneCaches();
    if (reason === "bootstrap") rememberCountryRevision("country", 2);
    if (reason === "resync") advanceMapSceneCaches(event(2, "world.resync_required", {}));
    expect(await loadCityScene("country", "city", reason === "bootstrap" || reason === "resync" ? 2 : 1, reason === "force", load)).toBe(next);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("never reuses a different city/country or an altered scene revision", async () => {
    const first = scene("first"), other = scene("other", "other"), fresh = scene("fresh");
    const load = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(other).mockResolvedValueOnce(fresh).mockResolvedValueOnce(fresh);
    await loadCityScene("country", "city", 1, false, load); retainCityScene(first);
    expect(await loadCityScene("country", "other", 1, false, load)).toBe(other);
    expect(await loadCityScene("foreign", "city", 1, false, load)).toBe(fresh);
    first.sceneRevision = "altered";
    expect(await loadCityScene("country", "city", 1, false, load)).toBe(fresh);
    expect(load).toHaveBeenCalledTimes(4);
  });

  it("does not let a late forced-out read replace the newer scene lease", async () => {
    const first = scene("late-old"), next = scene("fresh");
    let release!: (scene: CitySceneDto) => void;
    const load = vi.fn().mockImplementationOnce(() => new Promise<CitySceneDto>(done => { release = done; })).mockResolvedValue(next);
    const oldRequest = loadCityScene("country", "city", 1, false, load);
    expect(await loadCityScene("country", "city", 1, true, load)).toBe(next); retainCityScene(next);
    release(first); expect(await oldRequest).toBe(next);
    retainCityScene(first); // A late React effect has no authority to supersede it.
    expect(await loadCityScene("country", "city", 1, false, load)).toBe(next);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("never adopts an arbitrary scene or extends it across an unknown revision", async () => {
    const arbitrary = scene("not-loaded"), next = scene("from-server"), load = vi.fn().mockResolvedValue(next);
    retainCityScene(arbitrary);
    expect(await loadCityScene("country", "city", 1, false, load)).toBe(next); retainCityScene(next);
    expect(await loadCityScene("country", "city", 2, false, load)).toBe(next);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("retries an in-flight read after an unknown newer bootstrap revision", async () => {
    rememberCountryRevision("country", 1);
    const old = scene("old"), next = scene("next"); let release!: (scene: CitySceneDto) => void;
    const load = vi.fn().mockImplementationOnce(() => new Promise<CitySceneDto>(done => { release = done; })).mockResolvedValue(next);
    const opening = loadCityScene("country", "city", 1, false, load);
    rememberCountryRevision("country", 2); release(old);
    expect(await opening).toBe(next); retainCityScene(next);
    expect(await loadCityScene("country", "city", 2, false, load)).toBe(next);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("promotes an in-flight scene only across a known unaffected event", async () => {
    rememberCountryRevision("country", 1);
    const current = scene("current"); let release!: (scene: CitySceneDto) => void;
    const load = vi.fn().mockImplementationOnce(() => new Promise<CitySceneDto>(done => { release = done; })).mockResolvedValue(current);
    const opening = loadCityScene("country", "city", 1, false, load);
    advanceMapSceneCaches(event(2, "task.comment_added", { cityId: "city", taskId: "t" })); release(current);
    expect(await opening).toBe(current); retainCityScene(current);
    expect(await loadCityScene("country", "city", 2, false, load)).toBe(current);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("never promotes across a missing event even when the later event is a comment", async () => {
    rememberCountryRevision("country", 1);
    const current = scene("current"), fresh = scene("after-gap"), load = vi.fn().mockResolvedValueOnce(current).mockResolvedValue(fresh);
    await loadCityScene("country", "city", 1, false, load); retainCityScene(current);
    advanceMapSceneCaches(event(3, "task.comment_added", { cityId: "city", taskId: "t" }));
    expect(await loadCityScene("country", "city", 3, false, load)).toBe(fresh);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
