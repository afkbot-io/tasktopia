import { describe, expect, it } from "vitest";
import { atlasTransitionProgress, createAtlasTransition, withAtlasTransitionPhase } from "../src/client/atlas-navigation-transition";

describe("atlas navigation transition", () => {
  it("keeps a clamped focus point and deterministic bounded progress", () => {
    const transition = createAtlasTransition("PLANET", "COUNTRY", { x: 1.4, y: -0.2 }, 1_000, 360);

    expect(transition.focus).toEqual({ x: 1, y: 0 });
    expect(atlasTransitionProgress(transition, 900)).toBe(0);
    expect(atlasTransitionProgress(transition, 1_180)).toBe(0.5);
    expect(atlasTransitionProgress(transition, 1_800)).toBe(1);
    expect(transition.phase).toBe("PRELOAD");
    expect(withAtlasTransitionPhase(transition, "FIRST_FRAME")).toMatchObject({ phase: "FIRST_FRAME", id: transition.id });
  });
});
