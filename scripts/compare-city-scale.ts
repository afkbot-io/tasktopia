/** Evidence-only comparison. Refuses changed fixtures, profiles or browsers. */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { assertSameColdMetricContract, assertColdMetricSamples, type ColdCityMetric } from "./city-scale-cold-metric";
import { CITY_SCALE_PROFILES, CITY_SCALE_SIZES, distribution, type CityScaleProfile } from "./city-scale-benchmark-contract";

type Report = { measurementContract?: unknown; completed: boolean; failure: string | null; browser: string; profile: string; parameters: unknown;
  sourceRevision: string; serverHash: string; clientHash: string; budgets: Record<string, number>;
  fixture: { tasks: number; geometryHash: string }; errors: string[]; budgetViolations: string[];
  results: { coldCityMs: number; legacyColdCityMs?: number; coldMetric?: ColdCityMetric; coldMetricInput?: unknown; warmCityMs: number; heapGrowthBytes: number | null;
    input: { p95: number | null }; frames: { p95: number | null }; coldLongTasks: { duration: number }[];
    longTasksAvailable: boolean; steadyLongTasks: unknown[];
    warmedResources: { views?: number; rgbaEstimateBytes?: number | null }; canonicalTasks: number;
    coldSceneRequests: number; panReads: string[]; warmSceneReads: string[]; legacyRequests: string[] }[] };
const root = process.env.CITY_SCALE_OUTPUT_ROOT ?? ".builder/world-perf-20261016";
const before = process.env.CITY_SCALE_BEFORE ?? "baseline", after = process.env.CITY_SCALE_AFTER ?? "candidate";
assert.match(before, /^[a-zA-Z0-9_-]+$/); assert.match(after, /^[a-zA-Z0-9_-]+$/);
const profiles = (process.env.CITY_SCALE_PROFILES ?? Object.keys(CITY_SCALE_PROFILES).join(",")).split(",") as CityScaleProfile[];
const sizes = (process.env.CITY_SCALE_SIZES ?? CITY_SCALE_SIZES.join(",")).split(",").map(Number);
assert.ok(profiles.length && profiles.every(profile => Object.hasOwn(CITY_SCALE_PROFILES, profile))
  && new Set(profiles).size === profiles.length, "Declare unique known comparison profiles");
assert.ok(sizes.length && sizes.every(size => CITY_SCALE_SIZES.includes(size as 200 | 1000))
  && new Set(sizes).size === sizes.length, "Declare unique known comparison sizes");
const rows = [], failures: string[] = [];
let measurementContractVersion: 1 | 2 | undefined;
for (const size of sizes) for (const profile of profiles) {
  const read = async (variant: string) => JSON.parse(await readFile(join(root, `${variant}-${size}-${profile}`, "report.json"), "utf8")) as Report;
  const baseline = await read(before), candidate = await read(after);
  const version = assertSameColdMetricContract(baseline.measurementContract, candidate.measurementContract);
  assert.ok(measurementContractVersion === undefined || measurementContractVersion === version,
    "Do not combine legacy and v2 pairs into one comparison");
  measurementContractVersion = version;
  assertColdMetricSamples(baseline.measurementContract, baseline.results);
  assertColdMetricSamples(candidate.measurementContract, candidate.results);
  assert.equal(baseline.completed, true); assert.equal(candidate.completed, true);
  assert.deepEqual(candidate.errors, []); assert.deepEqual(baseline.errors, []);
  assert.equal(baseline.fixture.geometryHash, candidate.fixture.geometryHash);
  assert.equal(candidate.fixture.tasks, size); assert.equal(baseline.fixture.tasks, size);
  assert.equal(baseline.browser, candidate.browser, "Pair must use the same installed browser");
  assert.deepEqual(baseline.parameters, candidate.parameters, "Pair must use the same layout and resource limits");
  assert.deepEqual(baseline.budgets, candidate.budgets, "Do not relax an optimization budget after seeing measurements");
  assert.equal(baseline.results.length, candidate.results.length, "Pair must use the same sample count");
  const median = (report: Report, metric: (value: Report["results"][number]) => number | null | undefined) => distribution(report.results.map(metric).filter((value): value is number => value != null)).p50;
  const coldBefore = median(baseline, value => value.coldCityMs)!, coldAfter = median(candidate, value => value.coldCityMs)!;
  const rgbaBefore = median(baseline, value => value.warmedResources.rgbaEstimateBytes), rgbaAfter = median(candidate, value => value.warmedResources.rgbaEstimateBytes);
  const violations = candidate.budgetViolations;
  failures.push(...violations.map(value => `${size}/${profile}: ${value}`));
  rows.push({ tasks: size, profile, measurementContractVersion: version,
    ...(version === 2 ? { legacyColdMedianBeforeMs: median(baseline, value => value.legacyColdCityMs),
      legacyColdMedianAfterMs: median(candidate, value => value.legacyColdCityMs),
      clockUncertaintyMedianBeforeMs: median(baseline, value => value.coldMetric?.clockUncertaintyMs),
      clockUncertaintyMedianAfterMs: median(candidate, value => value.coldMetric?.clockUncertaintyMs) } : {}),
    browser: candidate.browser, baselineSource: baseline.sourceRevision, candidateSource: candidate.sourceRevision,
    coldMedianBeforeMs: coldBefore, coldMedianAfterMs: coldAfter, coldDeltaPercent: 100 * (coldAfter / coldBefore - 1),
    warmMedianBeforeMs: median(baseline, value => value.warmCityMs), warmMedianAfterMs: median(candidate, value => value.warmCityMs),
    inputP95MedianBeforeMs: median(baseline, value => value.input.p95), inputP95MedianAfterMs: median(candidate, value => value.input.p95),
    rafP95MedianBeforeMs: median(baseline, value => value.frames.p95), rafP95MedianAfterMs: median(candidate, value => value.frames.p95),
    retainedHeapGrowthMedianBeforeBytes: median(baseline, value => value.heapGrowthBytes), retainedHeapGrowthMedianAfterBytes: median(candidate, value => value.heapGrowthBytes),
    warmDisplayViewsBefore: median(baseline, value => value.warmedResources.views), warmDisplayViewsAfter: median(candidate, value => value.warmedResources.views),
    trackedRgbaEstimateBeforeBytes: rgbaBefore, trackedRgbaEstimateAfterBytes: rgbaAfter,
    trackedRgbaDeltaPercent: rgbaBefore && rgbaAfter ? 100 * (rgbaAfter / rgbaBefore - 1) : null,
    canonicalTasksPreserved: candidate.results.every(value => value.canonicalTasks === size),
    sceneRequestBudgetPreserved: candidate.results.every(value => value.coldSceneRequests === 1 && !value.panReads.length && !value.warmSceneReads.length && !value.legacyRequests.length),
    candidateBudgetViolations: violations });
}
await mkdir(root, { recursive: true });
await writeFile(join(root, `${before}-vs-${after}.json`), JSON.stringify({ measurementContractVersion, targets: { sizes, profiles }, rows, failures,
  limits: "Paired browser emulation and local fixture data. RGBA estimate is not measured VRAM; unavailable heap/long-task APIs remain absent. Native device claims are excluded.", generatedAt: new Date().toISOString() }, null, 2) + "\n");
console.log(JSON.stringify({ compared: rows.length, failures: failures.length }));
if (process.env.CITY_SCALE_ENFORCE_BUDGETS === "true" && failures.length) process.exitCode = 1;
