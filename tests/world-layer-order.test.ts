import { describe, expect, it } from "vitest";
import { WORLD_LAYER_ORDER } from "../src/client/world-layer-order";

describe("world layer order", () => {
  it("keeps every authoritative overlay above the instant seed terrain", () => {
    const terrain = WORLD_LAYER_ORDER.indexOf("terrain");
    for (const overlay of ["surface", "road", "platform", "worldObject"] as const) {
      expect(WORLD_LAYER_ORDER.indexOf(overlay), `${overlay} must cover seed terrain`).toBeGreaterThan(terrain);
    }
    expect(WORLD_LAYER_ORDER.indexOf("surface")).toBeLessThan(WORLD_LAYER_ORDER.indexOf("road"));
    expect(WORLD_LAYER_ORDER.indexOf("road")).toBeLessThan(WORLD_LAYER_ORDER.indexOf("platform"));
    expect(WORLD_LAYER_ORDER.indexOf("platform")).toBeLessThan(WORLD_LAYER_ORDER.indexOf("worldObject"));
  });

  it("keeps district boundaries and their tooltip above every visual occluder", () => {
    const districtTooltip = WORLD_LAYER_ORDER.indexOf("districtTooltip");
    for (const occluder of ["worldObject", "flight", "agentOverlay"] as const) {
      expect(districtTooltip, `district tooltip must be above ${occluder}`).toBeGreaterThan(WORLD_LAYER_ORDER.indexOf(occluder));
    }
    expect(WORLD_LAYER_ORDER.indexOf("district"), "interactive district boundary must stay below buildings")
      .toBeLessThan(WORLD_LAYER_ORDER.indexOf("worldObject"));
  });

  it("keeps building hover cards above every world-space visual", () => {
    const buildingTooltip = WORLD_LAYER_ORDER.indexOf("buildingTooltip");
    for (const occluder of ["worldObject", "flight", "agentOverlay", "districtTooltip"] as const) {
      expect(buildingTooltip, `building tooltip must be above ${occluder}`).toBeGreaterThan(WORLD_LAYER_ORDER.indexOf(occluder));
    }
  });

  it("keeps speech and thought bubbles above all world-space objects", () => {
    expect(WORLD_LAYER_ORDER.indexOf("agentOverlay")).toBeGreaterThan(WORLD_LAYER_ORDER.indexOf("worldObject"));
  });
});
