import type {CityLifeScene} from './city-life';
import {cityEventRecipe,eligibleNeighbourhoodRecipes,sampleRecipeAction,type CityLifeAction} from './city-event-recipes';

export const CITY_ACTION_PALETTE={ink:0x30464c,linen:0xe9d7a7,gold:0xe5c679,clay:0xd79565,sage:0x6d9a83,water:0x9ac7ce} as const;
type Color=typeof CITY_ACTION_PALETTE[keyof typeof CITY_ACTION_PALETTE];
export type CityActionPixel=Readonly<{x:number;y:number;width:number;height:number;color:Color}>;
const c=CITY_ACTION_PALETTE;
const r=(x:number,y:number,width:number,height:number,color:Color):CityActionPixel=>({x,y,width,height,color});
const draw:Record<CityLifeAction,(frame:0|1)=>readonly CityActionPixel[]>={
  BAG:()=>[r(3,-2,3,4,c.sage),r(3,-4,3,1,c.linen),r(3,-3,1,1,c.linen),r(5,-3,1,1,c.linen),r(4,0,1,2,c.ink)],
  BOX:()=>[r(3,-2,3,3,c.clay),r(4,-2,1,3,c.gold),r(3,1,3,1,c.ink)],
  BULB:f=>[r(3,-5,3,3,c.gold),r(4,-6,1,1,c.linen),r(4,-2,1,2,c.ink),r(3,-1,3,1,c.linen),r(7,-5-f,1,1,c.gold)],
  BUNTING:()=>[r(-4,-7,9,1,c.linen),r(-4,-6,2,2,c.clay),r(0,-6,1,2,c.gold),r(3,-6,2,2,c.sage)],
  COLLECT:f=>[r(2,0,5,3,c.sage),r(3,-1,3,1,c.gold),r(4,0,1,2,c.ink),r(6+f,-3,1,1,c.clay),r(2,-2,1,1,c.linen)],
  CONE:()=>[r(4,-2,1,1,c.gold),r(3,-1,3,2,c.clay),r(3,0,3,1,c.linen),r(2,1,5,1,c.ink)],
  CUP:f=>[r(3,-2,3,3,c.linen),r(6,-2,1,2,c.gold),r(3,-3,3,1,c.ink),r(3+f,-5,1,1,c.water)],
  ENVELOPE:()=>[r(2,-3,5,3,c.linen),r(2,-3,5,1,c.gold),r(3,-2,1,1,c.ink),r(5,-2,1,1,c.ink),r(4,-1,1,1,c.gold)],
  FIRST_AID:()=>[r(2,-3,5,4,c.linen),r(3,-5,3,1,c.ink),r(3,-4,1,1,c.ink),r(5,-4,1,1,c.ink),r(4,-2,1,3,c.clay),r(3,-1,3,1,c.clay)],
  FLOWERS:f=>[r(4,-1,1,5,c.sage),r(2,-1,2,1,c.sage),r(5,0,2,1,c.sage),r(2+f,-4,2,2,c.gold),r(4+f,-3,2,2,c.clay),r(3+f,-2,1,1,c.linen)],
  FOOD:()=>[r(2,-1,5,3,c.clay),r(2,-1,5,1,c.gold),r(3,-3,2,2,c.linen),r(6,-3,1,2,c.sage),r(3,1,3,1,c.ink)],
  HOSE:f=>[r(3,-2,3,1,c.sage),r(2,-1,1,2,c.sage),r(3,1,3,1,c.sage),r(6,-1,1,3,c.sage),r(4,0,2,1,c.ink),r(7,-1-f,1,1,c.water)],
  INSPECT:f=>[r(3,-5,3,3,c.ink),r(4,-4,1,1,c.water),r(5,-2,1,1,c.gold),r(6,-1,1,2,c.gold),r(3+f,-5,1,1,c.linen)],
  KEY:()=>[r(3,-4,2,2,c.gold),r(4,-3,1,1,c.ink),r(4,-2,1,3,c.gold),r(5,0,2,1,c.gold),r(6,1,1,1,c.gold)],
  LABEL:()=>[r(3,-4,3,4,c.gold),r(4,-3,1,1,c.ink),r(4,-5,1,1,c.linen),r(4,0,1,2,c.linen)],
  LADDER:()=>[r(3,-5,1,8,c.linen),r(6,-5,1,8,c.linen),r(4,-3,2,1,c.gold),r(4,0,2,1,c.gold)],
  MEASURE:()=>[r(2,-1,6,2,c.linen),r(2,0,1,1,c.ink),r(4,0,1,1,c.ink),r(6,0,1,1,c.ink),r(7,-2,1,1,c.gold)],
  MOP:f=>[r(4,-5,1,6,c.gold),r(2+f,1,5,1,c.ink),r(3+f,2,3,2,c.water),r(5+f,4,1,1,c.water)],
  MUSIC:f=>[r(3,-3-f,1,4,c.gold),r(2,-f,1,1,c.gold),r(4,-3-f,2,1,c.gold)],
  PAINT:f=>[r(3,-3,1,5,c.gold),r(2,-5,3,2,c.sage),r(2,-3,3,1,c.linen),r(6,-2+f,1,1,c.sage)],
  PLANT:f=>[r(2,2,5,1,c.clay),r(4,-1,1,3,c.sage),r(2,0,2,1,c.sage),r(5,-1,2,1,c.sage),r(4,-2-f,1,1,c.gold)],
  PRUNE:f=>[r(3,-4,1,3,c.gold),r(5-f,-4,1,3,c.linen),r(4,-1,1,1,c.ink),r(2,0,2,2,c.sage),r(5,0,2,2,c.sage)],
  RAKE:f=>[r(4+f,-5,1,7,c.gold),r(2+f,2,5,1,c.linen),r(2+f,3,1,1,c.ink),r(4+f,3,1,1,c.ink),r(6+f,3,1,1,c.ink)],
  READ:()=>[r(2,-4,5,4,c.linen),r(4,-4,1,5,c.ink),r(2,-4,2,1,c.sage),r(5,-4,2,1,c.gold),r(2,0,2,1,c.gold),r(5,0,2,1,c.sage)],
  SIGN:()=>[r(2,-6,5,4,c.ink),r(3,-5,3,2,c.linen),r(3,-4,3,1,c.sage),r(4,-2,1,5,c.gold)],
  SIGNAL:f=>[r(3,-6,1,8,c.gold),r(4,-6+f,3,2,c.clay),r(6,-4+f,1,1,c.linen)],
  SORT:f=>[r(2,-1,2,3,c.clay),r(5,0,3,2,c.clay),r(3,-3+f,3,2,c.gold),r(3,-3+f,1,2,c.linen),r(2,2,6,1,c.ink)],
  SWEEP:f=>[r(3+f,-3,1,5,c.gold),r(2+f,2,3,1,c.linen),r(2+f,3,3,1,c.clay)],
  TICKET:()=>[r(3,-5,3,5,c.linen),r(4,-4,1,1,c.sage),r(4,-2,1,1,c.ink),r(3,0,3,1,c.gold)],
  TOOLS:f=>[r(4,-3,1,6,c.gold),r(3,-5,1,2,c.gold),r(5,-5,1,2,c.gold),r(3,-3,3,1,c.ink),r(7,-4-f,1,1,c.linen)],
  UNPACK:f=>[r(3,-1,3,3,c.clay),r(3,-2,3,1,c.ink),r(2,-3-f,2,1,c.gold),r(5,-3-f,2,1,c.gold),r(4,0,1,2,c.linen)],
  WASH:f=>[r(3,-1,4,3,c.sage),r(4,-2,2,1,c.linen),r(4,0,2,1,c.water),r(2,-4-f,1,1,c.water),r(6,-4+f,1,1,c.linen)],
  WATER:f=>[r(3,0,3,2,c.sage),r(3,-1,2,1,c.sage),r(6,-1,1,1,c.water),r(7,f,1,1,c.water)],
  WAVE:f=>[r(3+f,-5,2,2,c.linen),r(4+f,-3,1,2,c.linen),r(7,-6+f,1,1,c.gold)],
};
const frames=new Map<CityLifeAction,readonly [readonly CityActionPixel[],readonly CityActionPixel[]]>();
/** At most68 tiny immutable frames, shared by the one active scene view. */
export function cityLifeActionPixels(action:CityLifeAction,frame:0|1):readonly CityActionPixel[]{
  let pair=frames.get(action);
  if(!pair){pair=[Object.freeze(draw[action](0).map(pixel=>Object.freeze(pixel))),Object.freeze(draw[action](1).map(pixel=>Object.freeze(pixel)))];frames.set(action,pair);}
  return pair[frame];
}
const carried=new Set<CityLifeAction>(['BOX','BAG','ENVELOPE','FLOWERS']);
export type CityLifeCueFrame={action:CityLifeAction;step:number;frame:0|1;pixels:readonly CityActionPixel[]};
export function cityLifeCueFrame(scene:CityLifeScene,now:number):CityLifeCueFrame|undefined{
  if(!Number.isFinite(now)||now<scene.start||now>=scene.start+scene.durationMs||!scene.recipeId||!scene.context)return;
  const recipe=cityEventRecipe(scene.recipeId);
  if(!recipe||recipe.channel!=='NEIGHBOURHOOD'||recipe.kind!==scene.kind||!eligibleNeighbourhoodRecipes(scene.context).includes(recipe))return;
  let state:{action:CityLifeAction;step:number}|undefined;
  if(scene.phase==='ARRIVING'&&carried.has(recipe.steps[0]))state={action:recipe.steps[0],step:-1};
  if(scene.phase==='ACTIVITY'&&scene.activityAt!==undefined&&scene.actorIds.length&&scene.arrived===scene.actorIds.length)
    state=sampleRecipeAction(recipe,now-scene.activityAt);
  if(!state)return;
  const frame=((Math.floor(now/150)%2+2)%2) as 0|1;
  return {...state,frame,pixels:cityLifeActionPixels(state.action,frame)};
}
