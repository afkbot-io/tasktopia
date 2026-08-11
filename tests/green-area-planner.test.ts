import { describe, expect, it } from "vitest";
import { greenAreaAccentCandidates, greenAreaAccentTarget, greenAreaSizeCandidates } from "../src/server/green-area-planner";

describe("green area planning", () => {
  it("tries spacious public parks before compact fallbacks", () => {
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
    const candidates = greenAreaAccentCandidates(12, 10);
    expect(greenAreaAccentTarget(12, 10)).toBe(12);
    expect(candidates.length).toBeGreaterThanOrEqual(12);
    for (const offset of candidates) {
      expect(offset.x).toBeGreaterThan(0);
      expect(offset.x).toBeLessThan(11);
      expect(offset.y).toBeGreaterThan(0);
      expect(offset.y).toBeLessThan(9);
      expect(offset.x).not.toBe(5);
      expect(offset.y).not.toBe(4);
    }
  });

  it("keeps compact fallbacks readable instead of overfilling them", () => {
    expect(greenAreaAccentTarget(5, 4)).toBe(4);
    expect(greenAreaAccentTarget(8, 7)).toBe(5);
  });
});
