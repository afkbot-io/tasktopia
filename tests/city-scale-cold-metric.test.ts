import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { calculateColdCityMetric, assertSameColdMetricContract, assertColdMetricSamples,
  CITY_SCALE_MEASUREMENT_CONTRACT, CITY_SCALE_COLD_OBSERVER_SCRIPT,
  type ColdCityMetricInput, type ColdCityCaptureApi } from "../scripts/city-scale-cold-metric";

const input = (): ColdCityMetricInput => ({
  nodeStartedMs: 1000, nodeClockSampleDoneMs: 1004, nodeEndedMs: 2561,
  start: { contractVersion: 2, token: "cold-200-0", expectedCityId: "city-200", timeOrigin: 100000, clockStart: 200 },
  end: { contractVersion: 2, token: "cold-200-0", expectedCityId: "city-200", inputCityId: "city-200",
    timeOrigin: 100000, now: 1765, trustedEnter: true, inputAt: 215, readyAt: 1463 },
});

describe("city cold metric browser-clock boundary", () => {
  it("keeps the Node start bracket, includes input delivery and preserves the old Node result", () => {
    expect(calculateColdCityMetric(input())).toEqual({ contractVersion: 2,
      lowerBoundMs: 1263, upperBoundMs: 1267, clockUncertaintyMs: 4, legacyColdCityMs: 1561 });
  });
  it("uses actual clock uncertainty without fixed poll subtraction or budget padding", () => {
    const sample = input(); sample.nodeClockSampleDoneMs = 1001.25;
    sample.end.readyAt = 1699.5;
    expect(calculateColdCityMetric(sample)).toMatchObject({ lowerBoundMs: 1499.5, upperBoundMs: 1500.75,
      clockUncertaintyMs: 1.25, legacyColdCityMs: 1561 });
  });
});

describe("city cold metric fail-closed observations", () => {
  const invalid = () => {
    const a = input();
    return [
      ["missing readiness", { ...a, end: { ...a.end, readyAt: null } }],
      ["missing Enter", { ...a, end: { ...a.end, inputAt: null } }],
      ["untrusted Enter", { ...a, end: { ...a.end, trustedEnter: false } }],
      ["another input city", { ...a, end: { ...a.end, inputCityId: "another-city" } }],
      ["another expected city", { ...a, end: { ...a.end, expectedCityId: "another-city" } }],
      ["another token", { ...a, end: { ...a.end, token: "another-cold" } }],
      ["another document", { ...a, end: { ...a.end, timeOrigin: 200000 } }],
      ["unknown version", { ...a, end: { ...a.end, contractVersion: 3 } }],
      ["missing fields", {}],
      ["non-finite Node clock", { ...a, nodeClockSampleDoneMs: NaN }],
      ["negative Node clock", { ...a, nodeStartedMs: -1 }],
      ["reversed RPC bracket", { ...a, nodeClockSampleDoneMs: 999 }],
      ["Node end before bracket", { ...a, nodeEndedMs: 1003 }],
      ["non-finite browser clock", { ...a, start: { ...a.start, clockStart: Infinity } }],
      ["negative browser clock", { ...a, start: { ...a.start, clockStart: -1 } }],
      ["readiness before start", { ...a, end: { ...a.end, readyAt: 199 } }],
      ["readiness before Enter", { ...a, end: { ...a.end, readyAt: 214 } }],
      ["readiness after read", { ...a, end: { ...a.end, readyAt: 1766 } }],
      ["empty token", { ...a, start: { ...a.start, token: "" }, end: { ...a.end, token: "" } }],
    ] as const;
  };
  it.each(invalid())("rejects %s rather than falling back to Node cold", (_name, sample) => {
    expect(() => calculateColdCityMetric(sample as ColdCityMetricInput)).toThrow();
  });
});


describe("cold metric report contract", () => {
  it("keeps unversioned historical pairs as legacy1", () => {
    expect(assertSameColdMetricContract(undefined, undefined)).toBe(1);
  });
  it("accepts only matching explicit v2 contracts", () => {
    expect(assertSameColdMetricContract(CITY_SCALE_MEASUREMENT_CONTRACT,
      { ...CITY_SCALE_MEASUREMENT_CONTRACT })).toBe(2);
  });
  it.each([
    [undefined, CITY_SCALE_MEASUREMENT_CONTRACT],
    [CITY_SCALE_MEASUREMENT_CONTRACT, undefined],
    [{ ...CITY_SCALE_MEASUREMENT_CONTRACT, version: 3 }, { ...CITY_SCALE_MEASUREMENT_CONTRACT, version: 3 }],
    [null, null],
    [{ ...CITY_SCALE_MEASUREMENT_CONTRACT, end: "first-frame-mark" }, CITY_SCALE_MEASUREMENT_CONTRACT],
  ])("rejects mixed, missing or unknown measurement definitions", (before, after) => {
    expect(() => assertSameColdMetricContract(before, after)).toThrow();
  });
});


const v2sample = () => {
  const raw = input(), metric = calculateColdCityMetric(raw);
  return { coldCityMs: metric.upperBoundMs, legacyColdCityMs: metric.legacyColdCityMs,
    coldMetric: metric, coldMetricInput: raw };
};
describe("stored cold sample contract", () => {
  it("checks a complete v2 sample and still accepts untouched legacy reports", () => {
    expect(() => assertColdMetricSamples(CITY_SCALE_MEASUREMENT_CONTRACT, [v2sample()])).not.toThrow();
    expect(() => assertColdMetricSamples(undefined, [{ coldCityMs: 1448 }])).not.toThrow();
  });
  it.each([
    { ...v2sample(), coldCityMs: 1200 },
    { ...v2sample(), legacyColdCityMs: 1200 },
    { ...v2sample(), coldMetricInput: undefined },
    { ...v2sample(), coldMetric: undefined },
    { coldCityMs: 1448 },
  ])("rejects a partial, mixed or tampered v2 sample", sample => {
    expect(() => assertColdMetricSamples(CITY_SCALE_MEASUREMENT_CONTRACT, [sample])).toThrow();
  });
  it("rejects v2 fields when a report lost its contract tag", () => {
    expect(() => assertColdMetricSamples(undefined, [v2sample()])).toThrow();
  });
});

type EnterEvent = { key: string; isTrusted: boolean; target: { closest: (selector: string) => { dataset: { cityId: string } } } };
function observerHarness() {
  let clock = 100, atomic = false, transitions = 0, hostExists = false;
  const listeners = new Map<string, Set<(event: EnterEvent) => void>>();
  const observers = new Set<{ callback: () => void }>();
  const scope = {
    performance: { timeOrigin: 100000, now: () => clock },
    MutationObserver: class {
      constructor(public callback: () => void) { observers.add(this); }
      observe() { /* Controlled public observer delivery, no application mock. */ }
      disconnect() { observers.delete(this); }
    },
    document: {
      body: {},
      addEventListener(type: string, listener: (event: EnterEvent) => void) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(listener);
      },
      removeEventListener(type: string, listener: (event: EnterEvent) => void) { listeners.get(type)?.delete(listener); },
      querySelectorAll(selector: string) {
        if (selector === ".world-canvas") return hostExists ? [{ dataset: { citySceneCommit: atomic ? "atomic" : "pending" } }] : [];
        if (selector === ".map-level-transition") return Array.from({ length: transitions });
        throw new Error(`Unexpected extra readiness predicate: ${selector}`);
      },
    },
  };
  runInNewContext(CITY_SCALE_COLD_OBSERVER_SCRIPT, scope);
  const api = (scope as typeof scope & { __cityScaleCold: ColdCityCaptureApi }).__cityScaleCold;
  return { api, observers,
    setClock(value: number) { clock = value; },
    enter(city = "city-200", trusted = true) {
      for (const listener of [...(listeners.get("keydown") ?? [])]) listener({ key: "Enter", isTrusted: trusted,
        target: { closest: () => ({ dataset: { cityId: city } }) } });
    },
    mutate(nextAtomic: boolean, nextTransitions: number) {
      hostExists = true; atomic = nextAtomic; transitions = nextTransitions;
      for (const observer of [...observers]) observer.callback();
    },
  };
}

describe("transported browser first-ready observer", () => {
  it("keeps the clock-start anchor, arms on the expected trusted Enter, then captures the exact old predicates", () => {
    const h = observerHarness();
    expect(h.api.begin("cold-0", "city-200").clockStart).toBe(100);
    h.setClock(115); h.enter();
    h.setClock(1400); h.mutate(true, 1);
    expect(h.api.read().readyAt).toBeNull();
    h.setClock(1463); h.mutate(true, 0);
    expect(h.api.read()).toMatchObject({ inputAt: 115, readyAt: 1463, trustedEnter: true, inputCityId: "city-200" });
  });
});

describe("first-ready observer lifecycle", () => {
  it("ignores another city and untrusted input before arming the fresh cold scene", () => {
    const h = observerHarness(); h.api.begin("cold-0", "city-200");
    h.enter("another-city"); h.enter("city-200", false);
    expect(h.api.read()).toMatchObject({ readyAt: null, inputAt: null, trustedEnter: false });
    h.setClock(120); h.enter(); h.setClock(140); h.mutate(true, 0);
    expect(h.api.read()).toMatchObject({ readyAt: 140, inputAt: 120 });
  });
  it("rejects any prior world canvas at cold start, including a pending canvas", () => {
    const h = observerHarness(); h.mutate(false, 0);
    expect(() => h.api.begin("cold-0", "city-200")).toThrow();
  });
  it("invalidates capture when an atomic canvas appeared before the trusted input handler", () => {
    const h = observerHarness(); h.api.begin("cold-0", "city-200");
    h.mutate(true, 0); h.setClock(120); h.enter();
    expect(() => h.api.read()).toThrow();
    expect(h.observers.size).toBe(0);
  });
  it("keeps exactly the first ready observation and releases its listener/observer", () => {
    const h = observerHarness(); h.api.begin("cold-0", "city-200"); h.enter();
    h.setClock(200); h.mutate(true, 0);
    expect(h.observers.size).toBe(0);
    const copy = h.api.read(); copy.readyAt = 999;
    h.setClock(300); h.mutate(false, 1); h.enter(); h.mutate(true, 0);
    expect(h.api.read().readyAt).toBe(200);
  });
  it("rejects reading a new document without a cold start and repeated capture in one document", () => {
    const h = observerHarness(); expect(() => h.api.read()).toThrow();
    h.api.begin("cold-0", "city-200");
    expect(() => h.api.begin("another-token", "city-200")).toThrow();
  });
});
