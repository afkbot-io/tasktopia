import type { Cell } from "./contracts";
import { buildPlanetSeaRoutes } from "./planet-port-transport";
import { atlasRailRoutes } from "./atlas-grid-transport";
import { planetHexCenter, projectPlanetAnchoredPoint, type ProjectedPlanetAtlas } from "./planet-atlas";

export function buildPlanetRailways(atlas: ProjectedPlanetAtlas) {
  const all = [...atlas.countries.flatMap(country => country.cells), ...atlas.coastCells];
  const land = all.filter(c => c.terrain !== "river").map(c => ({x:c.q,y:c.r}));
  const stops = atlas.countries.flatMap(country => country.cities.flatMap(city => (city.stations ?? []).map(station => {
    const projected = projectPlanetAnchoredPoint(country,city,station.center,country.cells,atlas.hexRadius,country.cityAnchors);
    const nearest=country.cells.filter(cell=>cell.terrain!=="river").reduce<(typeof country.cells)[number]|undefined>((best,cell)=>{
      const p=planetHexCenter(cell,atlas.hexRadius),b=best&&planetHexCenter(best,atlas.hexRadius);
      return !b || (p.x-projected.point.x)**2+(p.y-projected.point.y)**2 < (b.x-projected.point.x)**2+(b.y-projected.point.y)**2 ? cell : best;
    },undefined)??projected.cell;
    return {id:station.taskId,cityId:city.id,countryId:country.id,point:Math.floor(projected.point.x/(2*atlas.hexRadius))===nearest.q && Math.floor(projected.point.y/(2*atlas.hexRadius))===nearest.r
      ? projected.point : planetHexCenter(nearest,atlas.hexRadius),cell:{x:nearest.q,y:nearest.r}};
  })));
  const toPoint = (cell: Cell) => planetHexCenter({q:cell.x,r:cell.y},atlas.hexRadius);
  const byId=new Map(stops.map(stop=>[stop.id,stop]));
  const domestic=atlas.countries.flatMap(country=>atlasRailRoutes(stops.filter(stop=>stop.countryId===country.id),land));
  const international=atlasRailRoutes(stops,land).filter(route=>byId.get(route.from.id)!.countryId!==byId.get(route.to.id)!.countryId);
  return [...domestic,...international].map(route=>({id:route.id,fromStationId:route.from.id,toStationId:route.to.id,
    fromCityId:route.from.cityId,toCityId:route.to.cityId,
    fromCountryId:byId.get(route.from.id)!.countryId,toCountryId:byId.get(route.to.id)!.countryId,
    points:[byId.get(route.from.id)!.point,...route.cells.map(toPoint),byId.get(route.to.id)!.point]}));
}

export function buildPlanetSurfaceTransport(atlas: ProjectedPlanetAtlas) {
  return { rails: buildPlanetRailways(atlas), ships: buildPlanetSeaRoutes(atlas) };
}
