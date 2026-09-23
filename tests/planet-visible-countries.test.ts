import { describe, expect, it } from "vitest";
import { visiblePlanetCountries } from "../src/client/planet-visible-countries";

describe("planet label aperture", () => {
  it("shows only countries with actual cells intersecting both the viewport and surface ellipse", () => {
    const cell = (x: number, y: number) => ({ x, y, width: 10, height: 10 });
    const countries = [{ id: "center", cells: [cell(45, 45)] }, { id: "off-ellipse", cells: [cell(10, 10)] },
      { id: "partial", cells: [cell(77, 46)] }, { id: "offscreen", cells: [cell(101, 45)] }, { id: "empty", cells: [] }];
    const original = structuredClone(countries);
    expect(visiblePlanetCountries(countries, { minX: 20, minY: 20, maxX: 80, maxY: 80 }, { width: 100, height: 100 })
      .map(country => country.id)).toEqual(["center", "partial"]);
    expect(countries).toEqual(original);
    expect(visiblePlanetCountries(countries, { minX: -100, minY: -100, maxX: 200, maxY: 200 }, { width: 100, height: 100 })
      .some(country => country.id === "offscreen")).toBe(false);
  });
});

it('retains land in the extra vertical viewBox area of a tall screen', () => {
  const country = { cells: [{ x: 490, y: -310, width: 20, height: 20 }] };
  const surface = { minX: -500, minY: -1000, maxX: 1500, maxY: 1700 };
  expect(visiblePlanetCountries([country], surface, { width: 1000, height: 2300, minX: 0, minY: -800 })).toEqual([country]);
  expect(visiblePlanetCountries([country], surface, { width: 1000, height: 700 })).toEqual([]);
});
