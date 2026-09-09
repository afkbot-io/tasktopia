import { expect, it } from "vitest";
import { projectPlanetAtlas } from "../src/shared/planet-atlas";
import { buildPlanetSurfaceTransport } from "../src/shared/planet-surface-transport";
import { transportAtlasFixture } from "./fixtures/atlas-transport";

it("gives the browser transport fixture two separate continents with navigable sea and rail", () => {
  const atlas = projectPlanetAtlas(transportAtlasFixture());
  expect(new Set(atlas.countries.map(country => country.continent)).size).toBe(2);
  const transport = buildPlanetSurfaceTransport(atlas);
  expect(transport.ships).toHaveLength(1);
  expect(transport.ships[0]!.points.length).toBeGreaterThan(1);
  expect(transport.rails.length).toBeGreaterThan(0);
  expect(atlas.routes.length).toBeGreaterThan(0);
});
