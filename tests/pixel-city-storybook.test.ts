import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("Pixel City asset Storybook", () => {
  it("covers the complete manifest and validates every runtime canvas", () => {
    const stdout = execFileSync(
      "python3",
      ["scripts/render-pixel-city-storybook.py", "--describe"],
      { encoding: "utf8" },
    );
    const report = JSON.parse(stdout) as {
      variants: string[];
      counts: { buildings: number; stages: number; props: number; vehicles: number; areas: number; terrainFamilies: number };
      errors: string[];
    };

    expect(report.variants).toEqual(["A", "B", "C"]);
    expect(report.counts.buildings).toBeGreaterThanOrEqual(193);
    expect(report.counts.stages).toBe(report.counts.buildings * 5);
    expect(report.counts.props).toBeGreaterThanOrEqual(177);
    expect(report.counts.vehicles).toBeGreaterThanOrEqual(8);
    expect(report.counts.areas).toBe(7);
    expect(report.counts.terrainFamilies).toBe(12);
    expect(report.errors).toEqual([]);
  });
});
