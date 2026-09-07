import { describe, expect, it } from "vitest";
import { siteMarkerPresentation, siteRubbleLayout, type SiteMarker } from "../src/client/site-marker-presentation";
import { incidentBadge, incidentEffectPixels } from "../src/client/incident-pixels";

const marker: SiteMarker = { kind: "RELOCATED", permanent: true, targetTaskId: "canonical-task", variant: "brick", snapshot: { taskNumber: 12, title: "Задача", buildingFamily: "compact-wide-v1", lastStage: 4, recordedAt: "2026-09-05T00:00:00Z" } };
describe("permanent site presentation", () => {
  it("links MOVE only to its canonical task and never resurrects ruins", () => {
    expect(siteMarkerPresentation(marker)).toMatchObject({ badge: "MOVE", taskId: "canonical-task" });
    expect(siteMarkerPresentation({ ...marker, kind: "RUINED" })).toMatchObject({ badge: "RUIN", taskId: null });
    expect(siteMarkerPresentation({ ...marker, targetTaskId: null }).taskId).toBeNull();
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
