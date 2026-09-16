import { expect, test } from "@playwright/test";
import { atlasFlightPolyline } from "../../src/shared/atlas-flight-path";
import { sampleTransportPolyline } from "../../src/shared/rail-convoy";
import { atlasRoutePath } from "../../src/shared/atlas-scene";

test("flight arc sampler agrees with native SVG geometry across zoom and direction", async ({ page }) => {
  const routes = [.82, 1, 8.5].flatMap(zoom => [
    { from: { x: 0, y: 0 }, control: { x: 10 * zoom, y: 150 * zoom }, to: { x: 200 * zoom, y: -30 * zoom } },
    { from: { x: 0, y: 0 }, control: { x: 0, y: 0 }, to: { x: 200 * zoom, y: 0 } },
  ]);
  await page.setContent('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  for (const route of routes) {
    const oracle = await page.evaluate(pathData => {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", pathData);
      document.querySelector("svg")!.replaceChildren(path);
      const length = path.getTotalLength();
      return Array.from({ length: 101 }, (_, index) => {
        const point = path.getPointAtLength(length * index / 100);
        return { x: point.x, y: point.y };
      });
    }, atlasRoutePath(route.from, route.control, route.to));
    const line = atlasFlightPolyline(route.from, route.control, route.to);
    for (const [index, expected] of oracle.entries()) {
      for (const direction of [1, -1] as const) {
        const actual = sampleTransportPolyline(line, line.length * index / 100, direction);
        // Includes the SVG path's decimal rounding. Well below one display pixel.
        expect(Math.hypot(actual.x - expected.x, actual.y - expected.y)).toBeLessThan(.2);
      }
    }
  }
});
