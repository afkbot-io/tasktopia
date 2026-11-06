import { expect,it } from 'vitest';
import type { Cell } from '../src/shared/contracts';
import { planCinematicCrew } from '../src/client/city-cinematic-crew';
import { BUILDING_CATALOG } from '../src/shared/catalog';
import { legacyPlanCinematicCrew } from './helpers/legacy-cinematic-crew';

const key=(c:Cell)=>`${c.x},${c.y}`;
const task={footprint:Array.from({length:12},(_,i)=>({x:4+i%4,y:4+Math.floor(i/4)})),accessPath:[{x:5,y:8}],siteBounds:undefined};
class LocalOnlyGraph extends Map<string,Cell>{
  lookups=0;
  override get(id:string){this.lookups++;return super.get(id);}
  override has(id:string){this.lookups++;return super.has(id);}
  override values():MapIterator<Cell>{throw new Error('A local crew must not scan the whole city');}
  override [Symbol.iterator]():MapIterator<[string,Cell]>{throw new Error('A local crew must not copy the whole city');}
}
it('finds the same six local workers without enumerating any road or walking index',()=>{
  const graph=new LocalOnlyGraph(Array.from({length:144},(_,i)=>({x:i%12,y:Math.floor(i/12)})).map(c=>[key(c),c]));
  const roads=new Set<string>();Object.defineProperty(roads,Symbol.iterator,{value(){throw new Error('Road membership must not be copied');}});
  const routes=planCinematicCrew(task,graph,roads);
  expect(routes).toHaveLength(6);expect(graph.lookups).toBeLessThan(512);
  const occupied=new Set<string>();
  for(const route of routes)for(const cell of route){expect(graph.has(key(cell))).toBe(true);expect(occupied.has(key(cell))).toBe(false);occupied.add(key(cell));}
});
it('matches the frozen prior planner for every native parcel shape and representative occupied approaches',()=>{
  const shapes=[...new Map(BUILDING_CATALOG.map(b=>[`${b.footprint.width},${b.footprint.height}`,
    [b.footprint.width,b.footprint.height] as const])).values(),[3,15] as const,[8,8] as const];
  for(const [width,height] of shapes)for(let scenario=0;scenario<6;scenario++){
    const x=scenario%2?-30:4,y=scenario%3?-17:4;
    const footprint=Array.from({length:width*height},(_,i)=>({x:x+i%width,y:y+Math.floor(i/width)}));
    const points=Array.from({length:(width+12)*(height+12)},(_,i)=>({x:x-6+i%(width+12),y:y-6+Math.floor(i/(width+12))}));
    const graph=new Map((scenario%2?points.reverse():points).filter(c=>scenario!==5||(c.x+c.y)%7!==0).map(c=>[key(c),c]));
    const roads=new Set(scenario===3?points.filter(c=>c.y===y-1).map(key):[]);
    const occupied=new Set(scenario%2?points.filter(c=>c.x===x-1||c.y===y+height).map(key):[]);
    const parcel={footprint,accessPath:scenario===4?[]:[{x:x+1,y:y+height}],siteBounds:undefined};
    const limit=[0,1,2,3,6,12][scenario]!;
    expect(planCinematicCrew(parcel,graph,roads,occupied,limit),`${width}x${height}/${scenario}`)
      .toEqual(legacyPlanCinematicCrew(parcel,graph,roads,occupied,limit));
  }
});
it('rejects malformed or enormous parcel envelopes before accessing the city index',()=>{
  const graph=new LocalOnlyGraph();
  for(const footprint of [[{x:NaN,y:0}],[{x:0,y:0},{x:1e9,y:1e9}],[{x:Number.MAX_SAFE_INTEGER,y:0}],
    [{x:.5,y:0}],Array.from({length:4097},()=>({x:0,y:0}))])
    expect(planCinematicCrew({...task,footprint},graph,new Set())).toEqual([]);
  expect(graph.lookups).toBe(0);
});
