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

it("uses saved city anchors for stations and keeps rail endpoints on land",()=>{
  const atlas=projectPlanetAtlas(transportAtlasFixture()),country=atlas.countries[0]!,city=country.cities[0]!;
  const dry=country.cells.filter(cell=>cell.terrain!=="river"),cell=dry[0]!;
  country.cityAnchors[city.id]={x:(cell.q+.5)*atlas.hexRadius*2,y:(cell.r+.5)*atlas.hexRadius*2};
  const rails=buildPlanetSurfaceTransport(atlas).rails;
  const rail=rails.find(route=>route.fromStationId===city.stations![0]!.taskId || route.toStationId===city.stations![0]!.taskId)!;
  expect(rail).toBeDefined();
  const endpoint=rail.fromStationId===city.stations![0]!.taskId ? rail.points[0]! : rail.points.at(-1)!;
  expect(endpoint.x).toBeCloseTo(country.cityAnchors[city.id]!.x,8);
  expect(endpoint.y).toBeCloseTo(country.cityAnchors[city.id]!.y,8);
  const land=new Set([...atlas.countries.flatMap(c=>c.cells),...atlas.coastCells].filter(c=>c.terrain!=="river").map(c=>`${c.q},${c.r}`));
  for(const route of rails)for(const point of route.points)expect(land.has(`${Math.floor(point.x/(2*atlas.hexRadius))},${Math.floor(point.y/(2*atlas.hexRadius))}`)).toBe(true);
});

it("runs ships only between ready real ports and removes a voyage when either endpoint disappears", () => {
  const fixture = transportAtlasFixture();
  const ready = buildPlanetSurfaceTransport(projectPlanetAtlas(fixture)).ships;
  expect(ready).toHaveLength(1);
  expect(ready[0]!.id).toMatch(/^sea:/);
  const noPorts = structuredClone(fixture);
  for (const country of noPorts.countries) for (const city of country.cities) city.ports = [];
  expect(buildPlanetSurfaceTransport(projectPlanetAtlas(noPorts)).ships).toEqual([]);
  const removed = structuredClone(fixture);
  removed.countries.find(country => country.id === ready[0]!.fromCountryId)!.cities.forEach(city => { city.ports = []; });
  expect(buildPlanetSurfaceTransport(projectPlanetAtlas(removed)).ships).toEqual([]);
  expect(buildPlanetSurfaceTransport(projectPlanetAtlas({ ...fixture, countries: [...fixture.countries].reverse() })).ships).toEqual(ready);
});
