import { describe, expect, it } from "vitest";
import { affineProject, planetMapTransform } from "../src/shared/planet-atlas";

describe("retained planet terrain camera", () => {
  it("keeps unrounded terrain and snapped markers within half a map pixel", () => {
    const base = { width: 1250, height: 900 };
    for (const zoom of [.82, 1, 1.731, 8.5]) for (const panX of [-1.25, 0, .43]) {
      const camera = { zoom, panX, panY: -.39 }, transform = planetMapTransform(base, camera);
      for (const point of [{ x: 0, y: 0 }, { x: 625, y: 450 }, { x: 1250, y: 900 }]) {
        const snapped = affineProject(point, base, camera);
        expect(Math.abs(transform.x + point.x * transform.scale - snapped.x)).toBeLessThanOrEqual(.5);
        expect(Math.abs(transform.y + point.y * transform.scale - snapped.y)).toBeLessThanOrEqual(.5);
      }
      // Neighboring cells use exactly the same transformed edge, without a gap.
      const left = transform.x + 9 * 32 * transform.scale;
      const right = transform.x + 8 * 32 * transform.scale + 32 * transform.scale;
      expect(left).toBeCloseTo(right, 9);
    }
  });
});
