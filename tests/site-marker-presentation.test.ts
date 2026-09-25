import { describe, expect, it } from "vitest";
import { siteMarkerPresentation, siteRubbleLayout } from "../src/client/site-marker-presentation";
import { incidentBadge, incidentEffectPixels } from "../src/client/incident-pixels";

describe("permanent site presentation", () => {
  it("presents ruins without a relocation navigation action", () => {
    expect(siteMarkerPresentation()).toMatchObject({ badge: "РУИНЫ", heading: "Задача удалена" });
    expect(siteMarkerPresentation()).not.toHaveProperty("taskId");
  });
  it("keeps distinct native rubble arrangements inside all compact sites", () => {
    for (const height of [24, 32, 48]) {
      const layouts = (["brick", "frame", "overgrown"] as const).map(variant => siteRubbleLayout(48, height, variant));
      expect(new Set(layouts.map(layout => JSON.stringify(layout))).size).toBe(3);
      for (const { x, y } of layouts.flat()) {
        expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true);
        expect(x - 8).toBeGreaterThanOrEqual(0); expect(x + 8).toBeLessThanOrEqual(48);
        expect(y - 16).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(height);
      }
    }
  });
});
describe("native incident pixels", () => {
  it("uses registered 5×5 integer flat-color frames with no PNG dependency", () => {
    for (const kind of ["flame", "smoke"] as const) for (const frame of [0, 1]) {
      const pixels = incidentEffectPixels(kind, frame);
      expect(pixels.length).toBeLessThanOrEqual(25);
      expect(new Set(pixels.map(pixel => pixel.color)).size).toBeLessThanOrEqual(3);
      for (const { x, y, color } of pixels) {
        expect(Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(color)).toBe(true);
        expect(x).toBeGreaterThanOrEqual(-2); expect(x).toBeLessThanOrEqual(2);
        expect(y).toBeGreaterThanOrEqual(-5); expect(y).toBeLessThan(-0);
      }
    }
  });
  it("distinguishes verification, repair and emergency glyphs without flashing text", () => {
    const modes = ["DEFECT_VERIFYING", "DEFECT_REPAIRING", "HOTFIX_ACTIVE"] as const;
    expect(new Set(modes.map(mode => JSON.stringify(incidentBadge(mode).pixels))).size).toBe(3);
  });
});
