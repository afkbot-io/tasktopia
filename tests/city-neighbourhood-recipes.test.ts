import {expect,it} from 'vitest';
import {CityEventDirector} from '../src/client/city-event-director';
import {createNeighbourhoodController} from '../src/client/city-neighbourhood-controller';
import {cityTransitGrid} from './fixtures/city-transit-grid';
import {cityLifeSites,planCityLife,type CityLifePlan,type CityLifeTask} from '../src/client/city-life';
import {sampleRecipeAction,NEIGHBOURHOOD_RECIPES,type NeighbourhoodRecipe} from '../src/client/city-event-recipes';
import {cityLifeCueFrame} from '../src/client/city-life-cues';

const options={enabled:true,economy:false,busy:new Set<string>()};
function fixture(recipe:NeighbourhoodRecipe=NEIGHBOURHOOD_RECIPES[0]){
  const f=cityTransitGrid(24),director=new CityEventDirector(),start=42000;
  director.update(start,options);
  const context=recipe.contexts.find(context=>context!=='ANY'&&context!=='BUILDING')??'HOME';
  const task:CityLifeTask={id:'home',stage:5,status:'COMPLETED',visualKind:'BUILDING',workItemType:'TASK',accessPath:[{x:3,y:-2}]};
  if(context==='GREEN'||context==='PAVED'||context==='WATER_EDGE'){
    task.visualKind='PARK';task.visualAssetKey=context==='GREEN'?'urban-formal':context==='PAVED'?'urban-parking':'urban-lake';
  }else if(context!=='HOME')task.serviceRole=context;
  const site=cityLifeSites([task],f.city.walkingCells,new Set(f.input.roads.keys()),f.input.roads)[0]!;
  expect(site.context).toBe(context);
  let plan:CityLifePlan|undefined;
  for(let window=0;window<4096;window++){
    const candidate=planCityLife('city',[site],window*180000+start)!;
    if(candidate.recipeId===recipe.id){plan=candidate;break;}
  }
  expect(plan).toBeDefined();director.update(plan!.start,options);
  const controller=createNeighbourhoodController(()=>f.city,director);
  return {...f,controller,director,plan:plan!,recipe};
}

it('starts recipe work at actual arrival and preserves every visible action until real departure',()=>{
  const f=fixture();expect(f.controller.start(f.plan,f.plan.start)).toBe(true);
  expect(f.controller.state?.activityAt).toBeUndefined();const steps=new Set<number>();let firstActivity:number|undefined;
  for(let elapsed=0;elapsed<75000&&f.controller.state;elapsed+=50){
    const now=f.plan.start+elapsed;f.director.update(now,options);const state=f.controller.update(now,f.view,true);
    if(state?.phase==='ACTIVITY'){
      firstActivity??=now;expect(state.activityAt).toBe(firstActivity);
      expect(state.actorIds.every(id=>f.city.agents.some(actor=>actor.id===id&&actor.visit?.arrived))).toBe(true);
      steps.add(sampleRecipeAction(f.recipe,now-state.activityAt!)!.step);
    }
    if(f.controller.state)f.city.advance(50);
  }
  expect(steps).toEqual(new Set([0,1,2]));expect(f.controller.metrics.completed).toBe(1);
  expect(f.director.active).toEqual([]);
  expect([f.city.metrics.vehicleUnsafeTotal,f.city.metrics.pedestrianUnsafeTotal,f.city.metrics.vehiclePedestrianUnsafeTotal]).toEqual([0,0,0]);
});

it.each(NEIGHBOURHOOD_RECIPES)('$id completes all visible steps with native arrival, service ownership and departure',recipe=>{
  const f=fixture(recipe),idsBefore=f.city.agents.map(actor=>actor.id);
  expect(f.controller.start(f.plan,f.plan.start)).toBe(true);
  const ids=f.controller.state!.actorIds,steps:string[]=[],phases=new Set<string>(),departures=new Map<string,{x:number;y:number}>();
  for(let elapsed=0;elapsed<75000&&f.controller.state;elapsed+=50){
    const now=f.plan.start+elapsed;f.director.update(now,options);
    const state=f.controller.update(now,f.view,true);
    if(state)phases.add(state.phase);
    if(state?.phase==='ACTIVITY'){
      expect(state.arrived).toBe(ids.length);
      expect(ids.every(id=>f.city.agents.some(actor=>actor.id===id&&actor.visit?.id===f.plan.id&&actor.visit.arrived))).toBe(true);
      if(recipe.kind==='DRILL')expect(f.city.agents.some(actor=>actor.id===state.serviceId&&actor.responseOwner===f.plan.id&&actor.activity==='REST')).toBe(true);
      const cue=cityLifeCueFrame(state,now)!;
      if(steps.length===cue.step)steps.push(cue.action);
    }
    if(state?.phase==='LEAVING'){
      expect(cityLifeCueFrame(state,now)).toBeUndefined();
      if(!departures.size)for(const id of [...ids,...(state.serviceId?[state.serviceId]:[])])
        departures.set(id,{...f.city.agents.find(actor=>actor.id===id)!.position});
    }
    if(f.controller.state)f.city.advance(50);
  }
  expect(steps).toEqual(recipe.steps);expect([...phases]).toEqual(['ARRIVING','ACTIVITY','LEAVING']);
  expect(f.controller.metrics.completed).toBe(1);expect(f.controller.metrics.cancelled).toBe(0);
  expect(f.controller.state).toBeUndefined();expect(f.director.active).toEqual([]);expect(f.city.agents.map(actor=>actor.id)).toEqual(idsBefore);
  for(const [id,origin] of departures){
    const actor=f.city.agents.find(actor=>actor.id===id)!;
    expect(Math.abs(actor.position.x-origin.x)+Math.abs(actor.position.y-origin.y)).toBeGreaterThanOrEqual(3);
    expect(actor.visit?.id??'').not.toContain(f.plan.id);expect(actor.responseOwner).not.toBe(f.plan.id);
  }
  expect([f.city.metrics.vehicleUnsafeTotal,f.city.metrics.pedestrianUnsafeTotal,f.city.metrics.vehiclePedestrianUnsafeTotal]).toEqual([0,0,0]);
});

it('refuses unknown, mismatched or contextless recipes before acquiring any participant',()=>{
  const f=fixture(),before=structuredClone(f.city.agents);
  for(const patch of [{recipeId:'missing'},{context:'AIRPORT' as const},{kind:'MUSIC' as const},{context:undefined}]){
    const plan={...f.plan,...patch};expect(f.controller.canStart(plan)).toBe(false);expect(f.controller.start(plan,plan.start)).toBe(false);
    expect(f.city.agents).toEqual(before);expect(f.director.active).toEqual([]);
  }
});
