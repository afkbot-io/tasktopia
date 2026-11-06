import {expect,it} from 'vitest';
import {CITY_LIFE_ACTIONS,NEIGHBOURHOOD_RECIPES} from '../src/client/city-event-recipes';
import {CITY_ACTION_PALETTE,cityLifeActionPixels,cityLifeCueFrame} from '../src/client/city-life-cues';
import type {CityLifeScene} from '../src/client/city-life';

it('gives all34 activity primitives distinct bounded integer-pixel frames in the city palette',()=>{
  const hashes=new Set<string>(),colors=new Set(Object.values(CITY_ACTION_PALETTE));
  expect(CITY_LIFE_ACTIONS).toHaveLength(34);
  for(const action of CITY_LIFE_ACTIONS){
    const frames=[cityLifeActionPixels(action,0),cityLifeActionPixels(action,1)];
    expect(cityLifeActionPixels(action,0)).toBe(frames[0]);
    for(const pixels of frames){
      expect(pixels.length).toBeGreaterThan(0);expect(pixels.length).toBeLessThanOrEqual(20);
      for(const p of pixels){
        for(const value of [p.x,p.y,p.width,p.height])expect(Number.isInteger(value)).toBe(true);
        expect(p.width).toBeGreaterThan(0);expect(p.height).toBeGreaterThan(0);expect(p.x).toBeGreaterThanOrEqual(-8);expect(p.y).toBeGreaterThanOrEqual(-10);
        expect(p.x+p.width).toBeLessThanOrEqual(10);expect(p.y+p.height).toBeLessThanOrEqual(6);expect(colors.has(p.color)).toBe(true);
      }
    }
    hashes.add(JSON.stringify(frames));
  }
  expect(hashes.size,'Names or colors alone must not duplicate a whole action trace').toBe(34);
});

it('never draws work before actual arrival, after its phase, or for an invalid recipe',()=>{
  const scene={id:'scene',taskId:'home',kind:'GARDEN',context:'GREEN',recipeId:'garden-water',route:[{x:0,y:0},{x:1,y:0}],start:42000,durationMs:75000,
    phase:'ARRIVING',position:{x:1.5,y:.5},actorIds:['real'],arrived:0} satisfies CityLifeScene;
  expect(cityLifeCueFrame(scene,43000)).toBeUndefined();
  expect(cityLifeCueFrame({...scene,phase:'ACTIVITY'},45000)).toBeUndefined();
  expect(cityLifeCueFrame({...scene,phase:'ACTIVITY',activityAt:45000},45000)).toBeUndefined();
  const active={...scene,phase:'ACTIVITY' as const,activityAt:45000,arrived:1};
  expect(cityLifeCueFrame(active,45000)).toMatchObject({action:'WATER',step:0});
  expect(cityLifeCueFrame(active,49000)).toMatchObject({action:'PLANT',step:1});
  expect(cityLifeCueFrame(active,53000)).toMatchObject({action:'INSPECT',step:2});
  expect(cityLifeCueFrame(active,57000)).toBeUndefined();
  expect(cityLifeCueFrame({...active,phase:'LEAVING'},50000)).toBeUndefined();
  expect(cityLifeCueFrame({...active,recipeId:'missing'},50000)).toBeUndefined();
  expect(cityLifeCueFrame({...active,context:'PAVED'},50000)).toBeUndefined();
  const moving=NEIGHBOURHOOD_RECIPES.find(recipe=>recipe.id==='home-moving')!;
  expect(cityLifeCueFrame({...scene,kind:moving.kind,context:'HOME',recipeId:moving.id},43000)).toMatchObject({action:'BOX'});
  expect(cityLifeCueFrame({...scene,kind:moving.kind,context:'HOME',recipeId:moving.id},41000)).toBeUndefined();
});
