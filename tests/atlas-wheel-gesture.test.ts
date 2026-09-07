import { describe, expect, it } from "vitest";
import { atlasHitTarget, atlasPointInsideEllipse, atlasViewBoxPoint, createAtlasWheelNavigation } from "../src/client/atlas-zoom-navigation";

describe("one wheel burst across retained and newly mounted atlas levels", () => {
  it("switches on the first eligible delta without a hold, extra step or magnitude ceiling", () => {
    const navigation = createAtlasWheelNavigation();
    expect(navigation.consume({ at: 100, deltaY: 4_000 }, true)).toBe(true);
    expect(navigation.consume({ at: 101, deltaY: 4_000 }, true)).toBe(false);
  });
  it("consumes one transition across CITY, loading and COUNTRY, even in a long inertia tail", () => {
    const navigation = createAtlasWheelNavigation();
    expect(navigation.consume({ at: 100, deltaY: 120 }, false)).toBe(false);
    expect(navigation.consume({ at: 120, deltaY: 120 }, true)).toBe(true);
    // App capture keeps observing while a renderer is loading or hidden.
    for (let at = 140; at <= 1_800; at += 20) navigation.observe({ at, deltaY: 24 });
    expect(navigation.consume({ at: 1_820, deltaY: 12 }, true)).toBe(false);
    expect(navigation.consume({ at: 2_200, deltaY: 120 }, true)).toBe(true);
  });
  it("accepts an intentional opposite-direction gesture immediately after returning", () => {
    const navigation = createAtlasWheelNavigation();
    expect(navigation.consume({ at: 100, deltaY: 120 }, true)).toBe(true);
    expect(navigation.consume({ at: 120, deltaY: -120 }, true)).toBe(true);
    expect(navigation.consume({ at: 121, deltaY: -120 }, true)).toBe(false);
    expect(navigation.consume({ at: 130, deltaY: 0 }, true)).toBe(false);
  });
});

describe("geographic atlas entry hit tests", () => {
  it("uses the SVG meet letterbox for mobile cursor coordinates instead of stretching the geography", () => {
    const viewport = { minX: 0, minY: 52, maxX: 390, maxY: 796 };
    expect(atlasViewBoxPoint({ x: 195, y: 424 }, viewport, { width: 1000, height: 700 })).toEqual({ x: 500, y: 350 });
    expect(atlasViewBoxPoint({ x: 195, y: 287.5 }, viewport, { width: 1000, height: 700 }).y).toBeCloseTo(0);
    expect(atlasViewBoxPoint({ x: 195, y: 60 }, viewport, { width: 1000, height: 700 }).y).toBeLessThan(0);
  });
  const targets = [{ id: "a", cells: [{ minX: 0, minY: 0, maxX: 10, maxY: 10 }] },
    { id: "b", cells: [{ minX: 30, minY: 30, maxX: 40, maxY: 40 }] }];
  it("never chooses a nearest country over ocean or outside the real footprint", () => {
    expect(atlasHitTarget({ x: 20, y: 20 }, targets, target => target.cells)).toBeUndefined();
    expect(atlasHitTarget({ x: 35, y: 35 }, targets, target => target.cells)?.id).toBe("b");
    expect(atlasHitTarget({ x: 10, y: 5 }, targets, target => target.cells)).toBeUndefined();
  });
  it("rejects clipped-out terrain before attempting a planet entry", () => {
    const ellipse = { minX: 0, minY: 0, maxX: 100, maxY: 60 };
    expect(atlasPointInsideEllipse({ x: 50, y: 30 }, ellipse)).toBe(true);
    expect(atlasPointInsideEllipse({ x: 0, y: 0 }, ellipse)).toBe(false);
  });
});
