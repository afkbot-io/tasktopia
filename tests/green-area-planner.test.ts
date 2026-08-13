import { describe, expect, it } from "vitest";
import { greenAreaAccentCandidates, greenAreaAccentTarget, greenAreaSizeCandidates } from "../src/server/green-area-planner";

describe("green area planning", () => {
  it("tries spacious public parks before compact fallbacks", () => {
    expect(greenAreaSizeCandidates("urban-formal")).toEqual([[18, 10], [16, 9], [14, 8]]);
    expect(greenAreaSizeCandidates("urban-community")).toEqual([[16, 10], [14, 9], [12, 8]]);
    expect(greenAreaSizeCandidates("urban-central")).toEqual([[12, 10], [10, 9], [8, 7]]);
    expect(greenAreaSizeCandidates("urban-botanical")).toEqual([[10, 9], [8, 8], [7, 6]]);
    expect(greenAreaSizeCandidates("urban-amusement")).toEqual([[10, 8], [8, 7], [7, 5]]);
    expect(greenAreaSizeCandidates("urban-grove")).toEqual([[8, 7], [7, 6], [6, 5]]);
    expect(greenAreaSizeCandidates("urban-park")).toEqual([[7, 6], [6, 5], [5, 4]]);
  });

  it("returns defensive copies so a placement attempt cannot mutate policy", () => {
    const candidates = greenAreaSizeCandidates("urban-park");
    candidates.pop();
    expect(greenAreaSizeCandidates("urban-park")).toHaveLength(3);
  });

  it("fills large parks proportionally without putting decor on the path cross or boundary", () => {
    const candidates = greenAreaAccentCandidates(18, 10, "urban-formal");
    expect(greenAreaAccentTarget(18, 10)).toBe(20);
    expect(candidates.length).toBeGreaterThanOrEqual(20);
    for (const offset of candidates) {
      expect(offset.x).toBeGreaterThan(0);
      expect(offset.x).toBeLessThan(17);
      expect(offset.y).toBeGreaterThan(0);
      expect(offset.y).toBeLessThan(9);
      expect([8, 9]).not.toContain(offset.x);
      expect([4, 5]).not.toContain(offset.y);
    }
  });

  it("keeps compact fallbacks readable instead of overfilling them", () => {
    expect(greenAreaAccentTarget(5, 4)).toBe(4);
    expect(greenAreaAccentTarget(8, 7)).toBe(5);
  });
});
