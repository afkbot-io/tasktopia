import { describe, expect, it } from "vitest";
import { City10000RequestCancellation } from "../scripts/city-10000-request-cancellation";

const endpoint = "http://127.0.0.1:5355/api/plan/cities/fixture-city/districts";
const started = { url: endpoint, method: "GET", resourceType: "fetch" };
const raw = { phase: "retained-churn", path: "/api/plan/cities/fixture-city/districts", error: "net::ERR_ABORTED" };
const confirmed = { planetReady: true, ownerInactive: true, navigationAbsent: true };

describe("managed CITY exit request cancellation evidence", () => {
  for (const delivery of ["before confirmation", "after confirmation"]) it(`classifies only an already pending owned read (${delivery})`, () => {
    const ledger = new City10000RequestCancellation<object>(endpoint), request = {};
    ledger.started(request, started);
    const exit = ledger.beginExit("retained-churn");
    if (delivery === "before confirmation") ledger.failed(request, raw);
    ledger.confirmExit(exit, confirmed);
    if (delivery === "after confirmation") ledger.failed(request, raw);
    const result = ledger.snapshot();
    expect(result.expectedCancellations).toHaveLength(1);
    expect(result.unexpectedFailures).toEqual([]);
    expect(result.classifiedFailures[0]).toMatchObject({ ...raw, exitId: exit, exitPhase: "retained-churn", classification: "expected-owned-cancellation" });
    const witness = result.classifiedFailures[0]!;
    expect(witness.startedSeq).toBeLessThan(witness.exitStartedSeq!);
    expect(witness.exitStartedSeq).toBeLessThan(witness.failedSeq);
    expect(witness.exitConfirmedSeq).toBeGreaterThan(witness.exitStartedSeq!);
    expect(result.truncated).toBe(false);
  });

  it("keeps a late old-request delivery scoped to its exit and rejects the new entry read", () => {
    const ledger = new City10000RequestCancellation<object>(endpoint), oldRequest = {}, newRequest = {};
    ledger.started(oldRequest, started);
    const exit = ledger.beginExit("retained-churn"); ledger.confirmExit(exit, confirmed);
    ledger.started(newRequest, started);
    ledger.failed(newRequest, raw); ledger.failed(oldRequest, raw);
    const result = ledger.snapshot();
    expect(result.expectedCancellations).toHaveLength(1);
    expect(result.expectedCancellations[0]!.exitId).toBe(exit);
    expect(result.unexpectedFailures).toHaveLength(1);
    expect(result.unexpectedFailures[0]!.exitId).toBeNull();
  });

  it("does not excuse failures outside a known pending-before-intent request", () => {
    for (const state of ["never-started", "failed-before-intent", "completed", "new-after-intent"]) {
      const ledger = new City10000RequestCancellation<object>(endpoint), request = {};
      if (state !== "never-started" && state !== "new-after-intent") ledger.started(request, started);
      if (state === "completed") ledger.finished(request);
      if (state === "failed-before-intent") ledger.failed(request, raw);
      const exit = ledger.beginExit("retained-churn"); ledger.confirmExit(exit, confirmed);
      if (state === "new-after-intent") ledger.started(request, started);
      if (state !== "failed-before-intent") ledger.failed(request, raw);
      expect(ledger.snapshot().expectedCancellations, state).toEqual([]);
      expect(ledger.snapshot().unexpectedFailures, state).toHaveLength(1);
    }
  });

  it("requires all three real exit confirmations", () => {
    for (const missing of ["planetReady", "ownerInactive", "navigationAbsent"] as const) {
      const ledger = new City10000RequestCancellation<object>(endpoint), request = {};
      ledger.started(request, started); const exit = ledger.beginExit("retained-churn");
      ledger.confirmExit(exit, { ...confirmed, [missing]: false }); ledger.failed(request, raw);
      expect(ledger.snapshot().expectedCancellations).toEqual([]);
      expect(ledger.snapshot().unexpectedFailures).toHaveLength(1);
    }
  });

  it("rejects other origins, cities, endpoints, queries, methods, resource types and failure kinds", () => {
    const variants = [
      { ...started, url: endpoint.replace("127.0.0.1", "localhost") },
      { ...started, url: endpoint.replace("fixture-city", "foreign-city") },
      { ...started, url: endpoint.replace("/districts", "/scene") },
      { ...started, url: endpoint + "?limit=1000" },
      { ...started, url: "http://127.0.0.1:5355/api/auth/logout" },
      { ...started, method: "POST" }, { ...started, resourceType: "document" },
    ];
    for (const value of variants) {
      const ledger = new City10000RequestCancellation<object>(endpoint), request = {};
      ledger.started(request, value); const exit = ledger.beginExit("retained-churn");
      ledger.confirmExit(exit, confirmed); ledger.failed(request, raw);
      expect(ledger.snapshot().expectedCancellations).toEqual([]);
      expect(ledger.snapshot().unexpectedFailures).toHaveLength(1);
    }
    for (const error of ["net::ERR_FAILED", "net::ERR_CONNECTION_RESET", "unknown"]) {
      const ledger = new City10000RequestCancellation<object>(endpoint), request = {};
      ledger.started(request, started); const exit = ledger.beginExit("retained-churn");
      ledger.confirmExit(exit, confirmed); ledger.failed(request, { ...raw, error });
      expect(ledger.snapshot().expectedCancellations).toEqual([]);
      expect(ledger.snapshot().unexpectedFailures).toHaveLength(1);
    }
  });

  it("preserves failures as evidence and fails closed when the failure bound is exceeded", () => {
    const ledger = new City10000RequestCancellation<object>(endpoint, 1);
    ledger.failed({}, raw); ledger.failed({}, { ...raw, error: "net::ERR_FAILED" });
    expect(ledger.snapshot()).toMatchObject({ truncated: true, expectedCancellations: [], unexpectedFailures: [raw] });
  });

  it("fails closed when pending identities or exit evidence exceed their bounds", () => {
    for (const overflow of ["pending", "exits"]) {
      const ledger = new City10000RequestCancellation<object>(endpoint, 1), request = {};
      ledger.started(request, started);
      if (overflow === "pending") ledger.started({}, started);
      const exit = ledger.beginExit("retained-churn"); ledger.confirmExit(exit, confirmed);
      if (overflow === "exits") ledger.beginExit("retained-churn");
      ledger.failed(request, raw);
      expect(ledger.snapshot()).toMatchObject({ truncated: true, expectedCancellations: [], unexpectedFailures: [raw] });
    }
  });
});
