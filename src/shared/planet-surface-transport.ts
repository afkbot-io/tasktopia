import { railwayScheduleOffset,railwayTimetable,retainedTransportNetwork } from "./transport-network";
import type { Cell } from "./contracts";
import { buildPlanetSeaRoutes } from "./planet-port-transport";
import { atlasRailRoutes } from "./atlas-grid-transport";
import { planetHexCenter, projectPlanetAnchoredPoint, type ProjectedPlanetAtlas } from "./planet-atlas";

export function buildPlanetRailways(atlas: ProjectedPlanetAtlas,previous:readonly import("./planet-atlas-contract").PlanetRailRouteDto[]=[]) {
  if(atlas.railRoutes)return atlas.railRoutes;
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
  const domestic=atlas.countries.flatMap(country=>atlasRailRoutes(stops.filter(stop=>stop.countryId===country.id),land,country.transportNetworks?.RAIL));
  const foreignEdges=previous.length?retainedTransportNetwork(stops.map(stop=>({...stop,taskId:stop.id,point:stop.cell})),previous.filter(route=>route.fromCountryId!==route.toCountryId).map(route=>({fromCityId:route.fromCityId,toCityId:route.toCityId}))):undefined;
  const international=atlasRailRoutes(stops,land,foreignEdges).filter(route=>byId.get(route.from.id)!.countryId!==byId.get(route.to.id)!.countryId);
  const candidates=[...domestic,...international];
  const old=previous.filter(route=>route.scheduleOffsetMs!==undefined).map(route=>({fromCityId:route.fromCityId,toCityId:route.toCityId,arrivalPhaseMs:((((route.fromStationId<route.toStationId?0:108_000)-route.scheduleOffsetMs!)%72_000)+72_000)%72_000}));
  const timings=railwayTimetable(candidates.map(route=>({fromCityId:route.from.cityId,toCityId:route.to.cityId})),[...atlas.countries.flatMap(country=>country.transportNetworks?.RAIL??[]),...old.filter(edge=>!atlas.countries.some(country=>country.transportNetworks?.RAIL.some(current=>current.fromCityId===edge.fromCityId&&current.toCityId===edge.toCityId)))],false);
  return candidates.flatMap(route=>{
    const timing=timings.find(edge=>edge.fromCityId===route.from.cityId&&edge.toCityId===route.to.cityId);
    if(!timing)return [];
    const offset=timing?railwayScheduleOffset(timing,timing.fromCityId===route.from.cityId?route.from.id:route.to.id,timing.toCityId===route.to.cityId?route.to.id:route.from.id):undefined;
    return [{scheduleOffsetMs:offset,id:route.id,fromStationId:route.from.id,toStationId:route.to.id,
    fromCityId:route.from.cityId,toCityId:route.to.cityId,
    fromCountryId:byId.get(route.from.id)!.countryId,toCountryId:byId.get(route.to.id)!.countryId,
    points:[byId.get(route.from.id)!.point,...route.cells.map(toPoint),byId.get(route.to.id)!.point]}];});
}

export function buildPlanetSurfaceTransport(atlas: ProjectedPlanetAtlas) {
  return { rails: buildPlanetRailways(atlas), ships: buildPlanetSeaRoutes(atlas) };
}
