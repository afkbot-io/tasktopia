import { describe, expect, it } from "vitest";
import { WORLD_LAYER_ORDER } from "../src/client/world-layer-order";

describe("world layer order", () => {
  it("keeps district boundaries and their tooltip above every visual occluder", () => {
    const districtTooltip = WORLD_LAYER_ORDER.indexOf("districtTooltip");
    for (const occluder of ["decoration", "agent", "building", "incident", "feature", "flight"] as const) {
      expect(districtTooltip, `district tooltip must be above ${occluder}`).toBeGreaterThan(WORLD_LAYER_ORDER.indexOf(occluder));
    }
    expect(WORLD_LAYER_ORDER.indexOf("district"), "interactive district boundary must stay below buildings")
      .toBeLessThan(WORLD_LAYER_ORDER.indexOf("building"));
  });

  it("keeps building hover cards above every world-space visual", () => {
    const buildingTooltip = WORLD_LAYER_ORDER.indexOf("buildingTooltip");
    for (const occluder of ["decoration", "agent", "building", "incident", "feature", "flight", "districtTooltip"] as const) {
      expect(buildingTooltip, `building tooltip must be above ${occluder}`).toBeGreaterThan(WORLD_LAYER_ORDER.indexOf(occluder));
    }
  });
});
