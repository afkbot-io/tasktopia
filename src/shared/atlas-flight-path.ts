import type { Cell } from "./contracts";
import { railPolyline } from "./rail-convoy";

/** Approximate the displayed quadratic to 1/8 of a map unit. Build once when
 * projected geometry changes; arc-length sampling during flight needs no SVG
 * layout reads. The same sampler already drives the railway's constant spacing. */
export function atlasFlightPolyline(from: Cell, control: Cell, to: Cell) {
  const points: Cell[] = [from];
  const midpoint = (a: Cell, b: Cell): Cell => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const append = (a: Cell, c: Cell, b: Cell, depth: number) => {
    // Maximum deviation between a quadratic and its chord is |a - 2c + b|/4.
    if (depth === 12 || Math.hypot(a.x - 2 * c.x + b.x, a.y - 2 * c.y + b.y) <= .5) {
      points.push(b);
      return;
    }
    const left = midpoint(a, c), right = midpoint(c, b), center = midpoint(left, right);
    append(a, left, center, depth + 1);
    append(center, right, b, depth + 1);
  };
  append(from, control, to, 0);
  return railPolyline(points);
}
