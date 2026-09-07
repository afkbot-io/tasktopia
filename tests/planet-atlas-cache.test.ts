import { afterEach, expect, it, vi } from "vitest";
import { clearPlanetAtlasCache, loadPlanetAtlas, peekPlanetAtlas, watchPlanetAtlas } from "../src/client/planet-atlas-cache";
import { PLANET_ATLAS_SCHEMA_VERSION, type PlanetAtlasDto } from "../src/shared/planet-atlas-contract";
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); clearPlanetAtlasCache(); });

it("shares warm revision requests, isolates users and clears authentication data", async () => {
  clearPlanetAtlasCache();
  const dto = { schemaVersion: PLANET_ATLAS_SCHEMA_VERSION } as PlanetAtlasDto;
  const load = vi.fn(async () => dto);
  await Promise.all([loadPlanetAtlas("user", 1, load), loadPlanetAtlas("user", 1, load)]);
  expect(peekPlanetAtlas("user", 1)).toBe(dto);
  await loadPlanetAtlas("user", 1, load);
  expect(load).toHaveBeenCalledTimes(1);
  expect(peekPlanetAtlas("other-user", 1)).toBeUndefined();
  await loadPlanetAtlas("user", 2, load);
  expect(load).toHaveBeenCalledTimes(2);
  clearPlanetAtlasCache();
  expect(peekPlanetAtlas("user", 2)).toBeUndefined();
});

it("refreshes an expired revision once, sharing its in-flight request", async () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  clearPlanetAtlasCache();
  const dto = { schemaVersion: PLANET_ATLAS_SCHEMA_VERSION, revision: "first" } as PlanetAtlasDto;
  let resolve!: (value: PlanetAtlasDto) => void;
  const load = vi.fn().mockResolvedValueOnce(dto).mockImplementationOnce(() => new Promise<PlanetAtlasDto>(done => { resolve = done; }));
  await loadPlanetAtlas("user", 1, load);
  vi.setSystemTime(29_999);
  await loadPlanetAtlas("user", 1, load);
  expect(load).toHaveBeenCalledTimes(1);
  vi.setSystemTime(30_000);
  const pending = loadPlanetAtlas("user", 1, load);
  const shared = loadPlanetAtlas("user", 1, load);
  expect(load).toHaveBeenCalledTimes(2);
  expect(peekPlanetAtlas("user", 1)).toBe(dto);
  resolve({ ...dto, revision: "fresh" });
  expect((await pending).revision).toBe("fresh");
  expect(await shared).toBe(await pending);
});

it("stops background refresh while hidden and unsubscribed, refreshing expired data on visibility", async () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const document = Object.assign(new EventTarget(), { hidden: false });
  vi.stubGlobal("document", document);
  const dto = { schemaVersion: PLANET_ATLAS_SCHEMA_VERSION, revision: "first" } as PlanetAtlasDto;
  const load = vi.fn(async () => dto);
  const received = vi.fn();
  const stop = watchPlanetAtlas("user", 1, received, vi.fn(), load);
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledTimes(1);
  document.hidden = true; document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(load).toHaveBeenCalledTimes(1);
  document.hidden = false; document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(load).toHaveBeenCalledTimes(3);
  stop();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(load).toHaveBeenCalledTimes(3);
});
