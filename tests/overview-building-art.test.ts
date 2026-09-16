import { expect, it } from "vitest";
import { overviewBuildingArt } from "../src/shared/overview-building-art";
it("uses at least ten stable reviewed house variants without stretching their proportions", () => {
  const kinds = new Set<string>();
  for (let i = 0; i < 1000; i++) {
    const icon = overviewBuildingArt(`district-${i}`);
    kinds.add(icon.key);
    expect(overviewBuildingArt(`district-${i}`)).toEqual(icon);
    expect(Math.max(icon.width, icon.height)).toBe(10);
    const scale = 10 / Math.max(icon.nativeWidth, icon.nativeHeight);
    expect(Math.abs(icon.width - icon.nativeWidth * scale)).toBeLessThanOrEqual(.5);
    expect(Math.abs(icon.height - icon.nativeHeight * scale)).toBeLessThanOrEqual(.5);
    expect(icon.url).toContain("stage-5");
  }
  expect(kinds.size).toBeGreaterThanOrEqual(10);
});
