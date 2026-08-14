import { describe, expect, it } from "vitest";
import { ambientMotionPresentation } from "../src/client/ambient-motion";

describe("ambientMotionPresentation", () => {
  it("moves pedestrians and micromobility through cell centres without a synthetic jump", () => {
    for (const kind of ["WALKER", "CYCLIST", "SCOOTER"] as const) {
      expect(ambientMotionPresentation(kind, { x: 2, y: 3 }, { x: 3, y: 3 }, 0.25, undefined, 8))
        .toEqual({ x: 22, y: 28, rotation: 0 });
    }
  });

  it("keeps animals on the ground plane while they travel", () => {
    expect(ambientMotionPresentation("ANIMAL", { x: 4, y: 5 }, { x: 4, y: 6 }, 0.5, undefined, 8))
      .toEqual({ x: 36, y: 48, rotation: 0 });
  });

  it("uses the inset right-hand traffic lanes for cars and buses without bobbing", () => {
    expect(ambientMotionPresentation("CAR", { x: 0, y: 0 }, { x: 1, y: 0 }, 0.5, undefined, 8))
      .toEqual({ x: 8, y: 3.5, rotation: 0 });
    expect(ambientMotionPresentation("BUS", { x: 1, y: 0 }, { x: 0, y: 0 }, 0.5, undefined, 8))
      .toEqual({ x: 8, y: 4.5, rotation: 0 });
  });
});
