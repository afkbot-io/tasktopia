import { expect,it } from "vitest";
import { transportAtlasFixture } from "./fixtures/atlas-transport";
import { projectPlanetAtlas } from "../src/shared/planet-atlas";
import { internationalAirConnections } from "../src/server/world/international-air-connections";
import { transportOffmapPoint } from "../src/shared/transport-offmap-point";

it("uses only real international atlas routes and projects remote airports beyond local space",()=>{
  const fixture=transportAtlasFixture(),atlas=projectPlanetAtlas(fixture);
  const country=fixture.countries[0]!;
  const routes=internationalAirConnections(atlas,country.id);
  expect(routes.length).toBeGreaterThan(0);
  for(const route of routes){
    expect(atlas.routes.some(r=>r.id===route.id)).toBe(true);
    expect(route.from.countryId).not.toBe(route.to.countryId);
    expect([route.from.countryId,route.to.countryId]).toContain(country.id);
    const point=transportOffmapPoint({x:40,y:50},route.atlasFrom,route.atlasTo,{minX:0,minY:0,maxX:100,maxY:100});
    expect(Math.hypot(point.x-40,point.y-50)).toBeCloseTo(480);
    expect(Math.sign(point.x-40)).toBe(Math.sign(route.atlasTo.x-route.atlasFrom.x));
  }
  expect(internationalAirConnections(projectPlanetAtlas({...fixture,countries:[country]}),country.id)).toEqual([]);
});
