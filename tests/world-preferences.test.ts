import { afterEach, expect, it, vi } from "vitest";
import { parseWorldPreferences, readWorldPreferences, setWorldPreferences, subscribeWorldPreferences } from "../src/client/world-preferences";
import { readWorldLighting } from "../src/client/world-light-clock";
import { AdaptiveWorldQuality } from "../src/client/adaptive-world-quality";
afterEach(() => { setWorldPreferences({ cityLife:true, reduceMotion:false, quality:"AUTO" }); vi.useRealTimers(); });
it("validates persisted values and still works when storage is unavailable", () => {
  expect(parseWorldPreferences('{"lighting":"DAY","quality":"ECONOMY"}')).toEqual({ cityLife:true, reduceMotion:false, quality:"ECONOMY" });
  for (const raw of [null, "invalid", "{}", '{"quality":"LOW","lighting":42}'])
    expect(parseWorldPreferences(raw)).toEqual({ cityLife:true, reduceMotion:false, quality:"AUTO" });
  const changed = vi.fn(); const unsubscribe = subscribeWorldPreferences(changed);
  setWorldPreferences({ cityLife:false });
  expect(readWorldPreferences().cityLife).toBe(false);
  expect(changed).toHaveBeenCalledTimes(1);
  setWorldPreferences({ cityLife:false });
  expect(changed).toHaveBeenCalledTimes(1);
  unsubscribe();
});
it("keeps a single readable daylight policy regardless of the old lighting preference", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-15T21:00:00Z"));
  expect(readWorldLighting()).toMatchObject({ phase:"DAY",tint:0xffffff,lamps:0 });
  expect(parseWorldPreferences('{"lighting":"DAY","quality":"NORMAL"}')).toEqual(parseWorldPreferences('{"lighting":"REAL_TIME","quality":"NORMAL"}'));
});
const advance = (quality: AdaptiveWorldQuality, ms: number, frame: number) => {
  for (let time = 0; time < ms; time += frame) quality.sample(frame, true);
};
it("adapts only to sustained pressure, recovers slowly and ignores loading", () => {
  const quality = new AdaptiveWorldQuality();
  advance(quality, 12000, 16);
  quality.sample(240, true);
  advance(quality, 10000, 16);
  expect(quality.economy).toBe(false);
  advance(quality, 22000, 40);
  expect(quality.economy).toBe(true);
  advance(quality, 18000, 16);
  expect(quality.economy).toBe(true);
  advance(quality, 8000, 16);
  expect(quality.economy).toBe(false);
  for (let i = 0; i < 2000; i++) quality.sample(40, false);
  expect(quality.economy).toBe(false);
  quality.sample(300_000, true);
  advance(quality, 1400, 40);
  expect(quality.economy).toBe(false);
});
