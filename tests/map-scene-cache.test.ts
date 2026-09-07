import { describe, expect, it, vi } from "vitest";
import { advanceMapSceneCaches, citySceneCache, countrySceneCache, clearMapSceneCaches, loadCityScene, RevisionCache } from "../src/client/map-scene-cache";
import { CITY_SCENE_SCHEMA_VERSION, type CitySceneDto } from "../src/shared/city-scene-contract";
import type { RealtimeEvent } from "../src/shared/contracts";

describe("bounded revision scene cache", () => {
  it("shares in-flight reads and reuses a completed exact revision", async () => {
    const cache = new RevisionCache<number>(2);
    const load = vi.fn(async () => 42);
    expect(await Promise.all([cache.read("country:city:1", load), cache.read("country:city:1", load)])).toEqual([42, 42]);
    expect(await cache.read("country:city:1", load)).toBe(42);
    expect(load).toHaveBeenCalledTimes(1);
    await cache.read("country:city:2", load);
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("evicts LRU entries, retries failures and never restores an old session", async () => {
    const cache = new RevisionCache<number>(2);
    await cache.read("a", async () => 1);
    await cache.read("b", async () => 2);
    await cache.read("a", async () => 9);
    await cache.read("c", async () => 3);
    expect(cache.peek("b")).toBeUndefined();
    await expect(cache.read("failed", async () => { throw new Error("offline"); })).rejects.toThrow("offline");
    expect(await cache.read("failed", async () => 4)).toBe(4);
    let resolve!: (value: number) => void;
    const pending = cache.read("old-user", () => new Promise<number>((done) => { resolve = done; }));
    cache.clear();
    resolve(5);
    await pending;
    expect(cache.peek("old-user")).toBeUndefined();
  });
  it("moves an unchanged pending revision without reviving invalidated data", async () => {
    const cache = new RevisionCache<number>(2);
    let resolve!: (value: number) => void;
    const pending = cache.read("old", () => new Promise<number>(done => { resolve = done; }));
    cache.promote("old", "new");
    const next = cache.read("new", async () => 9);
    resolve(7);
    expect(await next).toBe(7);
    await pending;
    expect(cache.peek("old")).toBeUndefined();
    expect(cache.peek("new")).toBe(7);
    cache.delete("new");
    expect(await cache.read("new", async () => 8)).toBe(8);
  });
  it("keeps metadata and foreign-city scenes warm, but invalidates the changed city and overview", async () => {
    clearMapSceneCaches();
    const scene = {} as Awaited<ReturnType<typeof citySceneCache.read>>;
    const overview = {} as Awaited<ReturnType<typeof countrySceneCache.read>>;
    await citySceneCache.read("country:a:1", async () => scene);
    await citySceneCache.read("country:b:1", async () => scene);
    await countrySceneCache.read("country:1", async () => overview);
    advanceMapSceneCaches({ countryId: "country", id: 2, worldVersion: 2, createdAt: "2026-09-05", type: "task.comment_added", payload: { taskId: "task" } } as RealtimeEvent);
    expect(citySceneCache.peek("country:a:2")).toBe(scene);
    expect(countrySceneCache.peek("country:2")).toBe(overview);
    advanceMapSceneCaches({ countryId: "country", id: 3, worldVersion: 3, createdAt: "2026-09-05", type: "task.status_changed", payload: { cityId: "a", taskId: "task", status: "TESTING", stage: 4, progress: 90, groundChanged: false } } as RealtimeEvent);
    expect(citySceneCache.peek("country:a:3")).toBeUndefined();
    expect(citySceneCache.peek("country:b:3")).toBe(scene);
    expect(countrySceneCache.peek("country:3")).toBeUndefined();
    clearMapSceneCaches();
  });
  it("never commits an in-flight destination snapshot invalidated before its response", async () => {
    clearMapSceneCaches();
    const old = { schemaVersion: CITY_SCENE_SCHEMA_VERSION, city: { id: "a" }, lod: "DETAIL", sceneRevision: "old" } as CitySceneDto;
    const next = { ...old, sceneRevision: "fresh" };
    let resolve!: (scene: CitySceneDto) => void;
    const load = vi.fn().mockImplementationOnce(() => new Promise<CitySceneDto>(done => { resolve = done; })).mockResolvedValue(next);
    const opening = loadCityScene("country", "a", 1, false, load);
    advanceMapSceneCaches({ countryId: "country", id: 2, worldVersion: 2, createdAt: "2026-09-05", type: "task.created", payload: { cityId: "a" } });
    resolve(old);
    expect(await opening).toBe(next);
    expect(load).toHaveBeenCalledTimes(2);
    expect(citySceneCache.peek("country:a:2")).toBe(next);
    clearMapSceneCaches();
  });
  it("does not replace an already cached newer revision when older entries are promoted", async () => {
    clearMapSceneCaches();
    const old = { sceneRevision: "old" } as CitySceneDto;
    const fresh = { sceneRevision: "fresh" } as CitySceneDto;
    await citySceneCache.read("country:a:3", async () => fresh);
    await citySceneCache.read("country:a:1", async () => old);
    advanceMapSceneCaches({ countryId: "country", id: 3, worldVersion: 3, createdAt: "2026-09-05", type: "task.comment_added", payload: {} });
    expect(citySceneCache.peek("country:a:3")).toBe(fresh);
    clearMapSceneCaches();
  });

  it("does not promote another city's obsolete exit after a canonical country-road change", async () => {
    clearMapSceneCaches();
    const old = { sceneRevision: "before-road" } as CitySceneDto;
    await citySceneCache.read("country:a:1", async () => old);
    await citySceneCache.read("country:b:1", async () => old);
    await citySceneCache.read("other:c:1", async () => old);
    advanceMapSceneCaches({ countryId: "country", id: 2, worldVersion: 2, createdAt: "2026-09-07", type: "task.created",
      payload: { cityId: "b", groundRoadTopologyChanged: false } });
    expect(citySceneCache.peek("country:a:2")).toBe(old);
    advanceMapSceneCaches({ countryId: "country", id: 3, worldVersion: 3, createdAt: "2026-09-07", type: "task.created",
      payload: { cityId: "b", groundRoadTopologyChanged: true } });
    expect(citySceneCache.peek("country:a:3")).toBeUndefined();
    expect(citySceneCache.peek("country:a:2")).toBeUndefined();
    expect(citySceneCache.peek("country:a:1")).toBeUndefined();
    expect(citySceneCache.peek("country:b:2")).toBeUndefined();
    expect(citySceneCache.peek("other:c:1")).toBe(old);
    clearMapSceneCaches();
  });

  it("refetches an in-flight destination when a different city creates its connecting road", async () => {
    clearMapSceneCaches();
    const old = { schemaVersion: CITY_SCENE_SCHEMA_VERSION, city: { id: "a" }, lod: "DETAIL", sceneRevision: "old" } as CitySceneDto;
    const fresh = { ...old, sceneRevision: "connected" };
    let resolve!: (value: CitySceneDto) => void;
    const load = vi.fn().mockImplementationOnce(() => new Promise<CitySceneDto>(done => { resolve = done; })).mockResolvedValue(fresh);
    const opening = loadCityScene("country", "a", 1, false, load);
    advanceMapSceneCaches({ countryId: "country", id: 2, worldVersion: 2, createdAt: "2026-09-07", type: "task.created",
      payload: { cityId: "b", groundRoadTopologyChanged: true } });
    resolve(old);
    expect(await opening).toBe(fresh);
    expect(load).toHaveBeenCalledTimes(2);
    expect(citySceneCache.peek("country:a:2")).toBe(fresh);
    clearMapSceneCaches();
  });
});
