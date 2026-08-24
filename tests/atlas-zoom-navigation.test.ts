import { describe, expect, it } from "vitest";
import { advanceAtlasZoomBoundary, initialAtlasZoomBoundary } from "../src/client/atlas-zoom-navigation";

describe("atlas zoom level navigation", () => {
  it("requires two additional same-direction wheel steps after a zoom boundary", () => {
    const first = advanceAtlasZoomBoundary(initialAtlasZoomBoundary(), {
      at: 100, atBoundary: true, direction: "OUT",
    });
    expect(first.triggered).toBe(false);
    expect(first.state.count).toBe(1);

    const second = advanceAtlasZoomBoundary(first.state, {
      at: 220, atBoundary: true, direction: "OUT",
    });
    expect(second.triggered).toBe(true);
    expect(second.state).toEqual(initialAtlasZoomBoundary());
  });

  it("does not carry progress across direction changes, timeouts or non-boundary zoom", () => {
    const first = advanceAtlasZoomBoundary(initialAtlasZoomBoundary(), {
      at: 100, atBoundary: true, direction: "OUT",
    });
    expect(advanceAtlasZoomBoundary(first.state, {
      at: 200, atBoundary: true, direction: "IN",
    }).state.count).toBe(1);
    expect(advanceAtlasZoomBoundary(first.state, {
      at: 1_000, atBoundary: true, direction: "OUT",
    }).state.count).toBe(1);
    expect(advanceAtlasZoomBoundary(first.state, {
      at: 200, atBoundary: false, direction: "OUT",
    }).state).toEqual(initialAtlasZoomBoundary());
  });
});
