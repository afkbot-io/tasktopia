import assert from "node:assert/strict";

export const CITY_SCALE_BASELINE = "053e061d84dbcafdeaf1841010f9bd2286c9c5f8";
export const CITY_SCALE_SIZES = [200, 1000] as const;
export type CityScaleSize = typeof CITY_SCALE_SIZES[number];
export type CityScaleFixture = {
  schemaVersion: 1; tasks: CityScaleSize; districts: number; seed: number;
  countryId: string; cityId: string; email: string; createdAt: string;
  geometryHash: string; statusCounts: Record<string, number>; chunks: number;
  auditViolations: number; sourceRevision: string;
};
export const CITY_SCALE_PROFILES = {
  "desktop-chromium": { engine: "chromium", viewport: { width: 1440, height: 1000 }, dpr: 1, touch: false, cpu: 1, network: false },
  "desktop-firefox": { engine: "firefox", viewport: { width: 1440, height: 1000 }, dpr: 1, touch: false, cpu: 1, network: false },
  "desktop-webkit": { engine: "webkit", viewport: { width: 1440, height: 1000 }, dpr: 1, touch: false, cpu: 1, network: false },
  "pixel-chromium": { engine: "chromium", viewport: { width: 393, height: 851 }, dpr: 2.75, touch: true, cpu: 4, network: true },
  // Chromium supplies comparable CPU/network limits; this is an iPhone-sized
  // layout workload, not evidence about Safari or a physical iPhone processor.
  "iphone-chromium": { engine: "chromium", viewport: { width: 390, height: 844 }, dpr: 3, touch: true, cpu: 4, network: true },
  // Playwright WebKit cannot apply CDP CPU/network limits. Keep it a distinct
  // touch compatibility/response sample, never label it CPU4 or Safari hardware.
  "iphone-webkit": { engine: "webkit", viewport: { width: 390, height: 844 }, dpr: 3, touch: true, cpu: 1, network: false },
} as const;
export type CityScaleProfile = keyof typeof CITY_SCALE_PROFILES;

export function cityScaleSize(value: unknown): CityScaleSize {
  const count = Number(value);
  assert.ok(CITY_SCALE_SIZES.includes(count as CityScaleSize), "Use an exact 200 or 1000 task fixture");
  return count as CityScaleSize;
}
export function localCityScaleUrl(value: string, protocol: "http:" | "postgres:"): URL {
  const url = new URL(value);
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "City scale benchmarks are local-only");
  assert.equal(url.protocol, protocol, "Unexpected local benchmark protocol");
  assert.equal(url.hash, "", "URL fragments are not accepted");
  return url;
}
export function cityScaleDatabase(value: string, count: CityScaleSize): URL {
  const url = localCityScaleUrl(value, "postgres:");
  assert.match(url.pathname, new RegExp(`^/world_perf_[0-9]{8}_${count}$`), "Use a dedicated size-specific benchmark database");
  assert.equal(url.search, "", "Use a dedicated database, not a shared search_path");
  return url;
}
export function distribution(values: readonly number[]) {
  if (!values.length) return { count: 0, p50: null, p95: null, max: null };
  const ordered = [...values].sort((a, b) => a - b);
  assert.ok(ordered.every(Number.isFinite), "Metrics must be finite");
  return { count: ordered.length, p50: ordered[Math.ceil(ordered.length * .5) - 1]!,
    // Loading runs normally have three samples: report their range, not a
    // statistically unsupported p95. RAF/input rings have enough observations.
    p95: ordered.length >= 20 ? ordered[Math.ceil(ordered.length * .95) - 1]! : null,
    max: ordered.at(-1)! };
}
export function cityScaleBudgets(size: CityScaleSize, profile: CityScaleProfile) {
  const slow = CITY_SCALE_PROFILES[profile].cpu > 1;
  return { coldCityMs: slow ? size === 200 ? 6000 : 12000 : size === 200 ? 1500 : 3000,
    warmCityMs: slow ? 750 : 500, inputP95Ms: slow ? 200 : 100,
    frameP95Ms: slow ? 34 : 20, steadyLongTasks: 0, retainedHeapBytes: 8 * 1024 * 1024,
    coldSceneRequests: 1, panSceneRequests: 0, legacyRequests: 0, errors: 0 };
}
