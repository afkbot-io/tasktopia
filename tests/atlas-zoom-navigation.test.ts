import { describe, expect, it } from "vitest";
import {
  advanceAtlasEntryHysteresis,
  advanceAtlasZoomBoundary,
  atlasTargetCoverage,
  continuousAtlasZoom,
  initialAtlasEntryHysteresis,
  initialAtlasZoomBoundary,
  mapAtlasFocusPoint,
  returnedParentEntryHysteresis,
} from "../src/client/atlas-zoom-navigation";

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

  it("uses wheel magnitude for continuous zoom instead of fixed zoom steps", () => {
    const trackpad = continuousAtlasZoom(1, -24, { min: 0.8, max: 4 });
    const wheel = continuousAtlasZoom(1, -120, { min: 0.8, max: 4 });

    expect(trackpad).toBeGreaterThan(1);
    expect(wheel).toBeGreaterThan(trackpad);
    expect(continuousAtlasZoom(3.98, -120, { min: 0.8, max: 4 })).toBe(4);
    expect(continuousAtlasZoom(0.81, 120, { min: 0.8, max: 4 })).toBe(0.8);
  });

  it("measures when the focused atlas target nearly fills the viewport", () => {
    expect(atlasTargetCoverage(
      { minX: 100, minY: 80, maxX: 900, maxY: 620 },
      { minX: 0, minY: 0, maxX: 1_000, maxY: 700 },
    )).toBeCloseTo(0.8);
    expect(atlasTargetCoverage(
      { minX: -100, minY: -100, maxX: 1_100, maxY: 800 },
      { minX: 0, minY: 0, maxX: 1_000, maxY: 700 },
    )).toBe(1);
  });

  it("requires a retreat and a new zoom-in gesture after returning to a parent", () => {
    const state = returnedParentEntryHysteresis();
    let step = advanceAtlasEntryHysteresis(state, {
      direction: "IN", zoom: 1.2, rearmZoom: 1, coverage: 0.9, enterCoverage: 0.78,
    });
    expect(step.triggered).toBe(false);
    expect(step.state.armed).toBe(false);

    step = advanceAtlasEntryHysteresis(step.state, {
      direction: "OUT", zoom: 0.98, rearmZoom: 1, coverage: 0.6, enterCoverage: 0.78,
    });
    expect(step.state).toEqual(initialAtlasEntryHysteresis());

    step = advanceAtlasEntryHysteresis(step.state, {
      direction: "IN", zoom: 1.35, rearmZoom: 1, coverage: 0.82, enterCoverage: 0.78,
    });
    expect(step.triggered).toBe(true);
    expect(step.state.armed).toBe(false);
  });

  it("maps the focused atlas point into the same normalized city source point", () => {
    expect(mapAtlasFocusPoint(
      { x: 75, y: 40 },
      { minX: 50, minY: 20, maxX: 149, maxY: 69 },
      { minX: -200, minY: 100, maxX: 199, maxY: 299 },
    )).toEqual({ x: -100, y: 180 });
  });
});
