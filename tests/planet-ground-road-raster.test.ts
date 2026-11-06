import { expect,it } from 'vitest';
import { planPlanetGroundRoadRaster } from '../src/client/planet-ground-road-raster';
import type { ProjectedPlanetAtlas } from '../src/shared/planet-atlas';
import type { PlanetGroundRoadProjection } from '../src/shared/planet-ground-road-projection';

const atlas={hexRadius:4,countries:[{id:'country',cells:[{q:2,r:3,terrain:'grass'},{q:3,r:3,terrain:'river'}]}]} as ProjectedPlanetAtlas;
const projection:PlanetGroundRoadProjection={routes:[{id:'saved-road',countryId:'country',fromCityId:'a',toCityId:'b',
  points:[{x:20,y:25},{x:20,y:30}],cells:[{x:2,y:3}]}],unavailable:[],
  metrics:{gridCells:2,projectSamples:2,comparisons:2,searchCellsCharged:1,outputPoints:2,outputCells:1}};
it('uses the existing clipped native road painter with stable world origin and no water pixels',()=>{
  const plan=planPlanetGroundRoadRaster(atlas,projection);
  expect(plan.rejectedRouteIds).toEqual([]);expect(plan.rasters).toHaveLength(1);
  const raster=plan.rasters[0]!;
  expect(raster).toMatchObject({countryId:'country',x:16,y:24,width:16,height:8,pixelWidth:32,pixelHeight:16});
  expect(raster.plan.routes[0]!.id).toBe('saved-road');
  expect(raster.plan.routes[0]!.clipRects).toEqual([{x:0,y:0,width:16,height:16}]);
  expect(raster.plan.routes[0]!.asphaltRects).toEqual([{x:7,y:1,width:3,height:13}]);
  expect(raster.plan.routes.flatMap(r=>[...r.clipRects,...r.asphaltRects,...r.pavementRects])
    .every(rect=>Object.values(rect).every(Number.isInteger))).toBe(true);
});
it('rejects invalid/diagonal paths and oversized canvases before raster allocation',()=>{
  const malformed={...projection,routes:[{...projection.routes[0]!,points:[{x:20,y:25},{x:21,y:30}]}]};
  expect(planPlanetGroundRoadRaster(atlas,malformed).rejectedRouteIds).toEqual(['saved-road']);
  const enormous={...atlas,countries:[{...atlas.countries[0]!,cells:[{id:'a',q:0,r:0,terrain:'grass' as const},
    {id:'b',q:1_000_000,r:0,terrain:'grass' as const}]}]};
  const capped=planPlanetGroundRoadRaster(enormous,projection);expect(capped.rasters).toEqual([]);
  expect(capped.rejectedRouteIds).toEqual(['saved-road']);
});
