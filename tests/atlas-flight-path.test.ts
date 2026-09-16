import { describe, expect, it } from "vitest";
import { atlasFlightPolyline } from "../src/shared/atlas-flight-path";
import { sampleTransportPolyline } from "../src/shared/rail-convoy";

describe("flight geometry without browser layout reads", () => {
  it("follows arc length, including a non-uniform straight quadratic", () => {
    const line = atlasFlightPolyline({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 });
    expect(line.length).toBeCloseTo(100, 6);
    expect(sampleTransportPolyline(line, line.length / 4, 1)).toMatchObject({ x: 25, y: 0, heading: "east" });
    expect(sampleTransportPolyline(line, line.length / 4, -1)).toMatchObject({ x: 25, y: 0, heading: "west" });
  });

  it("preserves the curve and endpoints at every map zoom", () => {
    for (const zoom of [.82, 1, 8.5]) {
      const line = atlasFlightPolyline({ x: 0, y: 0 }, { x: 50 * zoom, y: 100 * zoom }, { x: 100 * zoom, y: 0 });
      const midpoint = sampleTransportPolyline(line, line.length / 2, 1);
      expect(midpoint.x).toBeCloseTo(50 * zoom, 6);
      expect(midpoint.y).toBeCloseTo(50 * zoom, 6);
      expect(line.points[0]).toEqual({ x: 0, y: 0 });
      expect(line.points.at(-1)).toEqual({ x: 100 * zoom, y: 0 });
      // Analytic length of this parabola: integral sqrt(1 + u²), u ∈ [-2, 2].
      const exactLength = 25 * zoom * (2 * Math.sqrt(5) + Math.asinh(2));
      expect(Math.abs(line.length - exactLength)).toBeLessThan(.15);
      for (let i = 0; i < line.points.length - 1; i++) {
        const a = line.points[i]!, b = line.points[i + 1]!;
        const x = (a.x + b.x) / 2, t = x / (100 * zoom);
        expect(Math.abs((a.y + b.y) / 2 - 200 * zoom * t * (1 - t))).toBeLessThanOrEqual(.125);
      }
    }
  });

  it("handles a zero-length flight without NaN", () => {
    const point = { x: 13, y: 27 }, line = atlasFlightPolyline(point, point, point);
    expect(line.length).toBe(0);
    expect(sampleTransportPolyline(line, 0, 1)).toMatchObject(point);
  });
});
