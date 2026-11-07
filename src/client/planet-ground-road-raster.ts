import type { ProjectedPlanetAtlas } from '../shared/planet-atlas';
import type { PlanetGroundRoadProjection } from '../shared/planet-ground-road-projection';
import { COUNTRY_TERRAIN_KINDS,type CountryOverviewDto } from '../shared/country-overview-contract';
import { COUNTRY_ROAD_ATLAS_TILES,drawCountryRoadRaster,planCountryRoadRaster,type CountryRoadRasterPlan } from './country-road-render';
import { gameAssetUrl } from '../shared/catalog';
import { loadMapImage } from './map-image';
import type { PlanetTerrainRaster } from './planet-terrain-raster';

const MAX_PIXELS=2_097_152,MAX_SIDE=2048;
type Raster={countryId:string;x:number;y:number;width:number;height:number;pixelWidth:number;pixelHeight:number;plan:CountryRoadRasterPlan};
export type PlanetRoadRaster=PlanetTerrainRaster&{routeIds:string[]};

/** Adapt inherited planet cells to the existing dry clipped road compositor.
 * Sixteen native pixels per macro cell match the terrain's2×2 patches. */
export function planPlanetGroundRoadRaster(atlas:ProjectedPlanetAtlas,projection:PlanetGroundRoadProjection){
  if(projection.routes.length>1024)throw new RangeError('Planet road raster route budget exceeded');
  const rasters:Raster[]=[],rejectedRouteIds:string[]=[];let pixelCount=0;
  const countries=new Map(atlas.countries.map(country=>[country.id,country]));
  const groups=new Map<string,typeof projection.routes>();
  for(const route of projection.routes){const group=groups.get(route.countryId)??[];group.push(route);groups.set(route.countryId,group);}
  const unit=atlas.hexRadius*2,density=16/unit;
  for(const [countryId,routes] of groups){
    const country=countries.get(countryId),reject=()=>rejectedRouteIds.push(...routes.map(route=>route.id));
    if(!country?.cells.length||country.cells.length>4096||!Number.isSafeInteger(density)||density<1){reject();continue;}
    const minQ=Math.min(...country.cells.map(cell=>cell.q)),minR=Math.min(...country.cells.map(cell=>cell.r));
    const columns=Math.max(...country.cells.map(cell=>cell.q))-minQ+1,rows=Math.max(...country.cells.map(cell=>cell.r))-minR+1;
    const pixelWidth=columns*16,pixelHeight=rows*16;
    if(![minQ,minR,columns,rows].every(Number.isSafeInteger)||columns<1||rows<1||columns*rows>4096
      ||pixelWidth>MAX_SIDE||pixelHeight>MAX_SIDE||pixelCount+pixelWidth*pixelHeight>MAX_PIXELS){reject();continue;}
    const codes=Array.from({length:columns*rows},()=> 'a');
    for(const cell of country.cells){const code=COUNTRY_TERRAIN_KINDS.indexOf(cell.terrain);
      codes[(cell.r-minR)*columns+cell.q-minQ]=(code<0?10:code).toString(16);}
    const x=minQ*unit,y=minR*unit;
    const groundRoads:CountryOverviewDto['groundRoads']={revision:country.groundRoads?.revision??0,unavailable:[],routes:routes.map(route=>({
      id:route.id,fromCityId:route.fromCityId,toCityId:route.toCityId,
      points:route.points.map(point=>({x:point.x-x,y:point.y-y})),
      corridorCells:route.cells.map(cell=>(cell.y-minR)*columns+cell.x-minQ),
    }))};
    const plan=planCountryRoadRaster(groundRoads,{columns,rows,cellSize:unit,topology:'SQUARE_4',terrainCodes:codes.join(''),territoryCodes:''},density);
    rejectedRouteIds.push(...plan.rejectedRouteIds);if(!plan.routes.length)continue;
    pixelCount+=pixelWidth*pixelHeight;
    rasters.push({countryId,x,y,width:columns*unit,height:rows*unit,pixelWidth,pixelHeight,plan});
  }
  return {rasters,rejectedRouteIds,pixelCount};
}

/** One immutable raster per country/revision, never rerun by camera motion. */
export async function rasterizePlanetGroundRoads(atlas:ProjectedPlanetAtlas,projection:PlanetGroundRoadProjection,signal:AbortSignal){
  signal.throwIfAborted();
  const plan=planPlanetGroundRoadRaster(atlas,projection),layers=new Map<string,PlanetRoadRaster[]>();
  if(!plan.rasters.length)return {layers,rejectedRouteIds:plan.rejectedRouteIds,pixelCount:0};
  const tiles=COUNTRY_ROAD_ATLAS_TILES;
  const images=new Map(await Promise.all([...new Set(Object.values(tiles).map(tile=>tile.url))].map(async url=>{
    const path=new URL(gameAssetUrl(url),window.location.href).pathname;
    return [url,await loadMapImage(path,signal)] as const;
  })));
  const materials={} as Record<keyof typeof tiles,HTMLCanvasElement>;
  try{
    for(const key of Object.keys(tiles) as Array<keyof typeof tiles>){
      const tile=tiles[key],canvas=document.createElement('canvas');materials[key]=canvas;canvas.width=canvas.height=tile.tileSize;
      const context=canvas.getContext('2d');if(!context)throw new Error('Не удалось подготовить покрытие дороги');
      context.imageSmoothingEnabled=false;
      context.drawImage(images.get(tile.url)!,tile.sourceX,tile.sourceY,tile.tileSize,tile.tileSize,0,0,tile.tileSize,tile.tileSize);
    }
    for(const raster of plan.rasters){
      signal.throwIfAborted();const canvas=document.createElement('canvas');
      canvas.width=raster.pixelWidth;canvas.height=raster.pixelHeight;
      try{
        const context=canvas.getContext('2d');if(!context)throw new Error('Не удалось подготовить дороги планеты');
        const asphalt=context.createPattern(materials.asphalt,'repeat'),pavement=context.createPattern(materials.pavement,'repeat');
        if(!asphalt||!pavement)throw new Error('Не удалось загрузить покрытие дороги');
        drawCountryRoadRaster(context,raster.plan,{asphalt,pavement});
        const href=canvas.toDataURL('image/png');await loadMapImage(href,signal,{crossOrigin:null});signal.throwIfAborted();
        layers.set(raster.countryId,[{id:`${raster.countryId}:ground-roads`,x:raster.x,y:raster.y,width:raster.width,height:raster.height,
          href,routeIds:raster.plan.routes.map(route=>route.id)}]);
      }finally{canvas.width=canvas.height=0;}
    }
  }finally{for(const canvas of Object.values(materials))canvas.width=canvas.height=0;}
  return {layers,rejectedRouteIds:plan.rejectedRouteIds,pixelCount:plan.pixelCount};
}
