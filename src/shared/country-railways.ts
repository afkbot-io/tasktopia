import { atlasRailRoutes } from "./atlas-grid-transport";
import { decodeCountryTerrain, type CountryOverviewDto } from "./country-overview-contract";

export function countryRailways(overview: CountryOverviewDto) {
  const {columns,rows,cellSize,terrainCodes}=overview.geography;
  const land=Array.from({length:columns*rows},(_,i)=>({x:i%columns,y:Math.floor(i/columns)})).filter((_,i)=>
    !["deep_water","shallow_water","river","unknown"].includes(decodeCountryTerrain(terrainCodes[i]??"a")));
  const positions = new Map<string,{x:number;y:number}>();
  const stops=overview.cities.flatMap(city=>(city.miniature.stations??[]).slice(0,1).map(station=>{
    const x=city.atlasCenter.x+(station.x-city.miniature.columns/2)*.72;
    const y=city.atlasCenter.y+(station.y-city.miniature.rows/2)*.72;
    const cell=[...land].sort((a,b)=>(a.x+.5-x/cellSize)**2+(a.y+.5-y/cellSize)**2-((b.x+.5-x/cellSize)**2+(b.y+.5-y/cellSize)**2))[0];
    if(cell) positions.set(station.taskId,Math.floor(x/cellSize)===cell.x&&Math.floor(y/cellSize)===cell.y?{x,y}:{x:(cell.x+.5)*cellSize,y:(cell.y+.5)*cellSize});
    return cell?{id:station.taskId,cityId:city.id,cell}:null;
  })).filter(stop=>stop!==null);
  return atlasRailRoutes(stops,land).map(route=>({id:route.id,fromCityId:route.from.cityId,toCityId:route.to.cityId,points:[positions.get(route.from.id)!,...route.cells.map(cell=>({x:(cell.x+.5)*cellSize,y:(cell.y+.5)*cellSize})),positions.get(route.to.id)!]}));
}
