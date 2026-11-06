import {expect,it} from 'vitest';
import {cityLifeSites,planCityLife,cityLifePlanFitsSite,type CityLifeTask} from '../src/client/city-life';
import {cityEventRecipe,eligibleNeighbourhoodRecipes} from '../src/client/city-event-recipes';

const graph=new Map(Array.from({length:12},(_,x)=>[`${x},0`,{x,y:0}]));
const home={id:'home',status:'COMPLETED',stage:5,accessPath:[{x:0,y:0}],visualKind:'BUILDING',workItemType:'TASK'} satisfies CityLifeTask;

it('compiles true parcel and service context without treating a parking area or lake as a garden',()=>{
  const cases=[
    [{...home,visualAssetKey:'compact-apartment-v1'},'HOME'],
    [{...home,visualKind:'PARK',visualAssetKey:'urban-park'},'GREEN'],
    [{...home,visualKind:'PARK',visualAssetKey:'urban-parking'},'PAVED'],
    [{...home,visualKind:'PARK',visualAssetKey:'urban-lake'},'WATER_EDGE'],
    [{...home,serviceRole:'SHOP'},'SHOP'],[{...home,serviceRole:'AIRPORT'},'AIRPORT'],
    [{...home,visualAssetKey:'compact-fire-station-v1'},'FIRE'],
  ] as const;
  const roads=new Map(Array.from({length:12},(_,x)=>[`${x},2`,{x,y:2}]));
  for(const [task,context] of cases){
    const site=cityLifeSites([task],graph,new Set(),roads)[0]!;
    expect(site.context).toBe(context);
    if(context==='FIRE'){expect(site.kind).toBe('DRILL');expect(site.responseCells!.length).toBeGreaterThan(0);}
  }
});

it('selects real compatible recipes throughout windows while keeping stable order and legacy direct sites',()=>{
  const sites=cityLifeSites([home],graph,new Set()),seen=new Set<string>();
  for(let window=0;window<360;window++){
    const now=window*180000+42000,plan=planCityLife('city',sites,now)!;
    expect(plan.context).toBe('HOME');expect(plan.recipeId).toBeDefined();
    const recipe=cityEventRecipe(plan.recipeId!)!;expect(recipe.channel).toBe('NEIGHBOURHOOD');
    expect(eligibleNeighbourhoodRecipes('HOME')).toContain(recipe);expect(recipe.kind).toBe(plan.kind);
    expect(planCityLife('city',[...sites].reverse(),now)).toEqual(plan);seen.add(plan.recipeId!);
  }
  expect(seen.size,'A completed neighbourhood must not repeat one fixed activity forever').toBeGreaterThan(12);
  const legacy=planCityLife('city',[{taskId:'legacy',kind:'GARDEN',route:[{x:0,y:0},{x:1,y:0}]}],42000)!;
  expect(legacy.kind).toBe('GARDEN');expect(legacy.recipeId).toBeUndefined();
});


it('retains a compatible recipe of another base kind, but cancels a moved or newly incompatible site',()=>{
  const site=cityLifeSites([home],graph,new Set())[0]!;
  let plan=planCityLife('city',[site],42000)!;
  for(let window=0;window<64&&plan.kind===site.kind;window++)plan=planCityLife('city',[site],window*180000+42000)!;
  expect(plan.kind).not.toBe(site.kind);expect(cityLifePlanFitsSite(site,plan)).toBe(true);
  expect(cityLifePlanFitsSite({...site,route:site.route.map((cell,index)=>index?cell:{x:cell.x+1,y:cell.y})},plan)).toBe(false);
  const garden=cityLifeSites([{...home,visualKind:'PARK',visualAssetKey:'urban-park'}],graph,new Set())[0]!;
  let gardening=planCityLife('city',[garden],42000)!;
  for(let window=0;window<4096&&gardening.kind!=='GARDEN';window++)gardening=planCityLife('city',[garden],window*180000+42000)!;
  expect(gardening.kind).toBe('GARDEN');expect(cityLifePlanFitsSite({...garden,context:'PAVED'},gardening)).toBe(false);
});
