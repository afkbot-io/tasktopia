import {expect,it} from 'vitest';
import {CITY_EVENT_CATALOG,NEIGHBOURHOOD_RECIPES,ROAD_EVENT_RECIPES,EVERYDAY_EVENT_RECIPES,
  cityEventRecipe,eligibleNeighbourhoodRecipes,sampleRecipeAction} from '../src/client/city-event-recipes';

it('registers100 uniquely owned runtime recipes across81 neighbourhood,7 road and12 everyday actions',()=>{
  expect(CITY_EVENT_CATALOG).toHaveLength(100);
  expect(NEIGHBOURHOOD_RECIPES).toHaveLength(81);expect(ROAD_EVENT_RECIPES).toHaveLength(7);expect(EVERYDAY_EVENT_RECIPES).toHaveLength(12);
  expect(new Set(CITY_EVENT_CATALOG.map(recipe=>recipe.id)).size).toBe(100);
  for(const recipe of CITY_EVENT_CATALOG){expect(recipe.label.trim().length).toBeGreaterThan(0);expect(cityEventRecipe(recipe.id)).toBe(recipe);}
  expect(cityEventRecipe('missing')).toBeUndefined();
  expect(ROAD_EVENT_RECIPES.map(recipe=>recipe.kind)).toEqual(['ACCIDENT','REPAIR','FIRE','MEDICAL','PATROL','BREAKDOWN','WATER']);
  expect(new Set(EVERYDAY_EVENT_RECIPES.map(recipe=>recipe.kind))).toEqual(new Set(['SCHOOL','KINDERGARTEN','BUS','MARKET','SPORT','DOG','BIRDS','OPEN_SCHOOL','OPEN_KINDERGARTEN','OPEN_SHOP','OPEN_FIRE','OPEN_BUILDING']));
  expect(EVERYDAY_EVENT_RECIPES.filter(recipe=>recipe.freshCompletion).map(recipe=>recipe.kind).toSorted())
    .toEqual(['OPEN_BUILDING','OPEN_FIRE','OPEN_KINDERGARTEN','OPEN_SCHOOL','OPEN_SHOP']);
});

it('requires81 distinct observable2/3-step traces and reachable appropriate contexts',()=>{
  expect(new Set(NEIGHBOURHOOD_RECIPES.map(recipe=>recipe.steps.join(','))).size).toBe(81);
  for(const recipe of NEIGHBOURHOOD_RECIPES)expect([2,3]).toContain(recipe.steps.length);
  const ids=(context:Parameters<typeof eligibleNeighbourhoodRecipes>[0])=>eligibleNeighbourhoodRecipes(context).map(recipe=>recipe.id);
  expect(ids('HOME')).toContain('home-moving');expect(ids('SHOP')).toContain('shop-stock');
  expect(ids('GREEN')).toContain('garden-water');expect(ids('PAVED')).not.toContain('garden-water');expect(ids('WATER_EDGE')).not.toContain('garden-water');
  expect(ids('FIRE')).toContain('service-drill');expect(ids('HOME')).not.toContain('service-drill');
  expect(ids('AIRPORT')).toContain('transport-bag');expect(ids('RAILWAY')).not.toContain('transport-bag');
  expect(ids('GREEN')).not.toContain('maint-door');expect(ids('HOME')).toContain('maint-door');
  expect(ids('PAVED')).toContain('clean-sweep');
  expect(eligibleNeighbourhoodRecipes('HOME')).toBe(eligibleNeighbourhoodRecipes('HOME'));
});

it('samples work from actual activity elapsed time with exact boundaries, not approach wall time',()=>{
  const moving=NEIGHBOURHOOD_RECIPES.find(recipe=>recipe.id==='home-moving')!;
  expect(sampleRecipeAction(moving,0)).toEqual({action:'BOX',step:0});
  expect(sampleRecipeAction(moving,3999)).toEqual({action:'BOX',step:0});
  expect(sampleRecipeAction(moving,4000)).toEqual({action:'UNPACK',step:1});
  expect(sampleRecipeAction(moving,8000)).toEqual({action:'SORT',step:2});
  const measure=NEIGHBOURHOOD_RECIPES.find(recipe=>recipe.id==='maint-measure')!;
  expect(sampleRecipeAction(measure,5999)).toEqual({action:'MEASURE',step:0});
  expect(sampleRecipeAction(measure,6000)).toEqual({action:'INSPECT',step:1});
  for(const invalid of [-1,12000,NaN,Infinity])expect(sampleRecipeAction(moving,invalid)).toBeUndefined();
});
