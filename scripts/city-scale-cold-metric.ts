import assert from "node:assert/strict";

/** Версионированная граница локального измерения, не код приложения. */
export type ColdCityClockStart = {
  contractVersion: 2; token: string; expectedCityId: string;
  timeOrigin: number; clockStart: number;
};
export type ColdCityClockEnd = {
  contractVersion: 2; token: string; expectedCityId: string; inputCityId: string | null;
  timeOrigin: number; now: number; trustedEnter: boolean; inputAt: number | null; readyAt: number | null;
};
export type ColdCityMetricInput = {
  nodeStartedMs: number; nodeClockSampleDoneMs: number; nodeEndedMs: number;
  start: ColdCityClockStart; end: ColdCityClockEnd;
};
export type ColdCityMetric = {
  contractVersion: 2; lowerBoundMs: number; upperBoundMs: number;
  clockUncertaintyMs: number; legacyColdCityMs: number;
};
function finiteClock(value: unknown, field: string): asserts value is number {
  assert.ok(typeof value === "number" && Number.isFinite(value) && value >= 0,
    `${field} must be a finite non-negative clock`);
}

export function calculateColdCityMetric(input: ColdCityMetricInput): ColdCityMetric {
  assert.ok(input && typeof input === "object", "Cold clock observations required");
  const { start, end } = input;
  assert.ok(start && end, "Start and end clock observations required");
  assert.equal(start.contractVersion, 2, "Unknown cold start contract");
  assert.equal(end.contractVersion, 2, "Unknown cold end contract");
  assert.ok(typeof start.token === "string" && start.token.length > 0, "Cold token required");
  assert.ok(typeof start.expectedCityId === "string" && start.expectedCityId.length > 0, "Expected city required");
  assert.equal(end.token, start.token, "Cold token changed across document");
  assert.equal(end.expectedCityId, start.expectedCityId, "Expected city changed");
  assert.equal(end.inputCityId, start.expectedCityId, "Trusted Enter targeted another city");
  assert.equal(end.trustedEnter, true, "Trusted city Enter not observed");
  for (const [field, value] of Object.entries({ nodeStartedMs: input.nodeStartedMs,
    nodeClockSampleDoneMs: input.nodeClockSampleDoneMs, nodeEndedMs: input.nodeEndedMs,
    startTimeOrigin: start.timeOrigin, endTimeOrigin: end.timeOrigin, clockStart: start.clockStart,
    inputAt: end.inputAt, readyAt: end.readyAt, browserReadAt: end.now })) finiteClock(value, field);
  assert.equal(end.timeOrigin, start.timeOrigin, "Browser document time origin changed");
  assert.ok(input.nodeClockSampleDoneMs >= input.nodeStartedMs, "Reversed Node clock bracket");
  assert.ok(input.nodeEndedMs >= input.nodeClockSampleDoneMs, "Node end precedes clock bracket");
  assert.ok(end.inputAt! >= start.clockStart, "Enter precedes cold start");
  assert.ok(end.readyAt! >= end.inputAt!, "Readiness precedes Enter");
  assert.ok(end.now >= end.readyAt!, "Readiness follows browser read");
  const legacyColdCityMs = input.nodeEndedMs - input.nodeStartedMs;
  const lowerBoundMs = end.readyAt! - start.clockStart;
  // Browser clock sample lies somewhere inside the existing Node RPC bracket.
  // Use its full measured span, never a fixed polling subtraction or padding.
  const clockUncertaintyMs = input.nodeClockSampleDoneMs - input.nodeStartedMs;
  const upperBoundMs = lowerBoundMs + clockUncertaintyMs;
  for (const [field, value] of Object.entries({ legacyColdCityMs, lowerBoundMs,
    clockUncertaintyMs, upperBoundMs })) finiteClock(value, field);
  return { contractVersion: 2, lowerBoundMs, upperBoundMs, clockUncertaintyMs, legacyColdCityMs };
}

export const CITY_SCALE_MEASUREMENT_CONTRACT = {
  version: 2,
  coldMetric: "browser-first-atomic-transition-ready-upper-bound",
  start: "node-city-start-bracketed-by-existing-browser-clock-rpc",
  end: "first-observed-atomic-and-zero-map-level-transitions-after-trusted-city-enter",
  legacyColdMetric: "node-city-ready-await-return",
  ownership: "no-world-canvas-at-start-or-before-trusted-city-enter",
} as const;

function coldMetricContractVersion(value: unknown): 1 | 2 {
  if (value === undefined) return 1; // Exact historical reports had no version field.
  assert.deepEqual(value, CITY_SCALE_MEASUREMENT_CONTRACT, "Unknown cold measurement definition");
  return 2;
}

export function assertSameColdMetricContract(before: unknown, after: unknown): 1 | 2 {
  const version = coldMetricContractVersion(before);
  assert.equal(coldMetricContractVersion(after), version, "Do not compare mixed cold measurement contracts");
  return version;
}

export type ColdCitySample = {
  coldCityMs: unknown; legacyColdCityMs?: unknown; coldMetric?: unknown; coldMetricInput?: unknown;
};
export function assertColdMetricSamples(contract: unknown, samples: readonly ColdCitySample[]): void {
  const version = coldMetricContractVersion(contract);
  for (const sample of samples) {
    finiteClock(sample.coldCityMs, "Sample coldCityMs");
    if (version === 1) {
      assert.equal(sample.legacyColdCityMs, undefined, "Legacy report contains untagged v2 metrics");
      assert.equal(sample.coldMetric, undefined, "Legacy report contains untagged v2 bounds");
      assert.equal(sample.coldMetricInput, undefined, "Legacy report contains untagged v2 observations");
      continue;
    }
    const measured = calculateColdCityMetric(sample.coldMetricInput as ColdCityMetricInput);
    assert.deepEqual(sample.coldMetric, measured, "Stored cold metric does not match its observations");
    assert.equal(sample.coldCityMs, measured.upperBoundMs, "Cold budget must use the conservative upper bound");
    assert.equal(sample.legacyColdCityMs, measured.legacyColdCityMs, "Legacy Node elapsed was not preserved");
  }
}

export type ColdCityCaptureApi = {
  begin(token: string, expectedCityId: string): ColdCityClockStart;
  read(): ColdCityClockEnd;
};
/** Plain JavaScript transported verbatim; no TSX __name/import closure. */
export const CITY_SCALE_COLD_OBSERVER_SCRIPT = String.raw`(() => {
  let state = null;
  let observer = null;
  const sample = () => {
    if (!state || state.inputAt === null || state.readyAt !== null) return;
    const hosts = document.querySelectorAll(".world-canvas");
    if (hosts.length !== 1 || hosts[0].dataset.citySceneCommit !== "atomic" ||
        document.querySelectorAll(".map-level-transition").length !== 0) return;
    state.readyAt = performance.now();
    observer.disconnect();
    document.removeEventListener("keydown", onKeydown, true);
  };
  const onKeydown = event => {
    if (!state || state.inputAt !== null || event.key !== "Enter" || !event.isTrusted) return;
    const target = event.target;
    const city = target && typeof target.closest === "function"
      ? target.closest(".planet-city-targets [data-city-id]") : null;
    if (!city || city.dataset.cityId !== state.expectedCityId) return;
    if (document.querySelectorAll(".world-canvas").length !== 0) {
      state.invalidReason = "World canvas appeared before trusted cold input";
      observer.disconnect();
      document.removeEventListener("keydown", onKeydown, true);
      return;
    }
    state.inputAt = performance.now();
    state.inputCityId = city.dataset.cityId;
    state.trustedEnter = true;
    sample();
  };
  globalThis.__cityScaleCold = {
    begin(token, expectedCityId) {
      if (state) throw new Error("Cold capture already started in this document");
      if (document.querySelectorAll(".world-canvas").length !== 0)
        throw new Error("Cold capture requires no prior world canvas");
      if (typeof token !== "string" || !token || typeof expectedCityId !== "string" || !expectedCityId)
        throw new Error("Cold token and expected city required");
      const clockStart = performance.now();
      state = { contractVersion: 2, token, expectedCityId, clockStart, timeOrigin: performance.timeOrigin,
        trustedEnter: false, inputCityId: null, inputAt: null, readyAt: null, invalidReason: null };
      observer = new MutationObserver(sample);
      observer.observe(document.body, { subtree: true, childList: true, attributes: true,
        attributeFilter: ["class", "data-city-scene-commit"] });
      document.addEventListener("keydown", onKeydown, true);
      return { contractVersion: 2, token, expectedCityId, timeOrigin: state.timeOrigin, clockStart };
    },
    read() {
      if (!state) throw new Error("Cold capture was not started in this document");
      if (state.invalidReason) throw new Error(state.invalidReason);
      return { contractVersion: 2, token: state.token, expectedCityId: state.expectedCityId,
        inputCityId: state.inputCityId, timeOrigin: performance.timeOrigin, now: performance.now(),
        trustedEnter: state.trustedEnter, inputAt: state.inputAt, readyAt: state.readyAt };
    }
  };
})();`;
