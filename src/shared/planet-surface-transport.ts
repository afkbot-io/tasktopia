import type { Cell } from "./contracts";
import { atlasRailRoutes, atlasShipRoutes } from "./atlas-grid-transport";
import { planetHexCenter, projectPlanetWorldPoint, type ProjectedPlanetAtlas } from "./planet-atlas";

export function buildPlanetSurfaceTransport(atlas: ProjectedPlanetAtlas) {
  const all = [...atlas.countries.flatMap(country => country.cells), ...atlas.coastCells];
  const cellKey = (c: Cell) => `${c.x},${c.y}`;
  const land = all.filter(c => c.terrain !== "river").map(c => ({x:c.q,y:c.r}));
  const stops = atlas.countries.flatMap(country => country.cities.flatMap(city => (city.stations ?? []).map(station => {
    const projected = projectPlanetWorldPoint(country,station.center,country.cells,atlas.hexRadius);
    return {id:station.taskId,cityId:city.id,cell:{x:projected.cell.q,y:projected.cell.r}};
  })));
  const toPoint = (cell: Cell) => planetHexCenter({q:cell.x,r:cell.y},atlas.hexRadius);
  // Shore ownership follows actual connected land, including coast and rivers.
  const remaining = new Map(all.map(c=>[`${c.q},${c.r}`,{x:c.q,y:c.r}]));
  const continents = new Map<number,Cell[]>();
  while(remaining.size) {
    const queue=[remaining.values().next().value!];remaining.delete(cellKey(queue[0]!));
    for(let i=0;i<queue.length;i++) {
      const c=queue[i]!;
      for(const n of [{x:c.x+1,y:c.y},{x:c.x-1,y:c.y},{x:c.x,y:c.y+1},{x:c.x,y:c.y-1}])if(remaining.delete(cellKey(n)))queue.push(n);
    }
    continents.set(continents.size,queue);
  }
  return {
    rails:atlasRailRoutes(stops,land).map(route=>({id:route.id,points:route.cells.map(toPoint)})),
    ships:atlasShipRoutes(continents,atlas.oceanCells.map(c=>({x:c.q,y:c.r}))).map((cells,index)=>({id:`ship:${index}`,points:cells.map(toPoint)})),
  };
}
