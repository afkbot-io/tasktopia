import { describe, expect, it } from "vitest";
import { retryFailedPadding } from "../src/client/padding-retry";

describe("explicit padding Retry", () => {
  it("allows failed trees to retry at the same camera without destroying correct native ground", () => {
    const ground = { id: "accepted-native-ground" }, surface = { id: "accepted-road-overlay" };
    const failed = { terrainView: ground, overlayView: surface, treeFailed: true, treeComplete: true, treePending: false,
      terrainPending: false, roadPending: false, roadComplete: true };
    const records = new Map([["4,4", failed]]);
    expect(retryFailedPadding(records)).toBe(1);
    const retry = records.get("4,4")!;
    expect(retry).not.toBe(failed);
    expect(retry.terrainView).toBe(ground); expect(retry.overlayView).toBe(surface);
    expect(retry.treeFailed).toBe(false); expect(retry.treeComplete).toBe(false);
    expect(retry.roadComplete).toBe(true);
    // No automatic repeating work: another click without a fresh error does
    // not replace a running generation or schedule a duplicate sprite set.
    expect(retryFailedPadding(records)).toBe(0); expect(records.get("4,4")).toBe(retry);
  });
  it("fences stale pending callbacks and resets only failed completion flags", () => {
    const terrainFailure = { terrainFailed: true, treePending: true, roadPending: true, roadComplete: false, treeComplete: false };
    const roadFailure = { roadFailed: true, roadComplete: true, treeComplete: true };
    const healthy = { roadComplete: true, treeComplete: true };
    const records = new Map<string, typeof terrainFailure | typeof roadFailure | typeof healthy>([
      ["1,2", terrainFailure], ["2,2", roadFailure], ["3,2", healthy],
    ]);
    expect(retryFailedPadding(records)).toBe(2);
    expect(records.get("1,2")).toMatchObject({ terrainFailed: false, treePending: false, roadPending: false });
    expect(records.get("1,2")).not.toBe(terrainFailure);
    expect(records.get("2,2")).toMatchObject({ roadFailed: false, roadComplete: false, treeComplete: true });
    expect(records.get("3,2")).toBe(healthy);
  });
});
