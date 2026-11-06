import { expect, it } from 'vitest';
import { planIntercityRoads } from '../src/server/world/intercity-road-planner';
import native200 from './fixtures/intercity-native-200.json';
import { decodeOrthogonalRoadRuns, type GridPoint } from '../src/shared/semantic-road';

it('exhausts the native200 finite search window without wasting the original8000-state budget',()=>{
  const result=planIntercityRoads(native200);
  expect(result.routes).toEqual([]);
  expect(result.unreachable.map(failure=>failure.reason)).toEqual(['NO_PATH']);
  expect(result.metrics.visited).toBeLessThan(8000);
  expect(result.components.map(component=>component.length)).toEqual([1,1]);
});

// Exhaustive Dijkstra on a separately constructed finite graph. It keeps every
// arrival heading and has no heuristic, dominance rule, bridge or visit cutoff.
// Expected cost therefore does not depend on the optimized A* implementation.
it('preserves the optimum of an independent heading-aware graph on24 dry/blocked/turn cases',()=>{
  let connected=0, disconnected=0;
  for(let seed=0;seed<24;seed++){
    const shift=seed%2 ? -128 : 0;
    const start={x:shift,y:shift},end={x:shift+96,y:shift+64};
    const blocks=[start,end].map(origin=>({origin,width:8,height:8}));
    const obstacles=Array.from({length:5},(_,i)=>({x:16+((seed*13+i*17)%9)*8,y:((seed*19+i*23)%9)*8}));
    const buildable=(p:GridPoint)=>seed!==1 || p.x!==shift+40;
    const clear=(x:number,y:number)=>buildable({x,y})
      &&!blocks.some(b=>x>=b.origin.x+3&&x<=b.origin.x+5&&y>=b.origin.y+3&&y<=b.origin.y+5)
      &&(seed<2||!obstacles.some(b=>Math.abs(x-shift-b.x)<=2&&Math.abs(y-shift-b.y)<=7));
    const terrain=(p:GridPoint)=>buildable(p)&&(seed<2||!obstacles.some(b=>Math.abs(p.x-shift-b.x)<=2&&Math.abs(p.y-shift-b.y)<=7));
    const points:GridPoint[]=[];
    for(let y=shift-16;y<=shift+80;y+=8)for(let x=shift-16;x<=shift+112;x+=8)points.push({x,y});
    const edges=new Map<string,Array<{to:GridPoint;heading:number}>>();
    for(const from of points){
      const next:Array<{to:GridPoint;heading:number}>=[];
      for(const [heading,[dx,dy]] of [[8,0],[0,8],[-8,0],[0,-8]].entries()){
        const to={x:from.x+dx!,y:from.y+dy!};
        if(!points.some(p=>p.x===to.x&&p.y===to.y))continue;
        let valid=true;
        for(let step=0;step<=8;step++)for(let oy=-2;oy<=2;oy++)for(let ox=-2;ox<=2;ox++)
          if(!clear(from.x+Math.sign(dx!)*step+ox,from.y+Math.sign(dy!)*step+oy))valid=false;
        if(valid)next.push({to,heading});
      }
      edges.set(`${from.x}:${from.y}`,next);
    }
    const queue=[{...start,heading:-1,cost:0}],settled=new Set<string>();let optimum=Infinity;
    while(queue.length){
      queue.sort((a,b)=>a.cost-b.cost);const p=queue.shift()!,id=`${p.x}:${p.y}:${p.heading}`;
      if(settled.has(id))continue;settled.add(id);
      if(p.x===end.x&&p.y===end.y){optimum=p.cost;break;}
      for(const {to,heading} of edges.get(`${p.x}:${p.y}`)!)queue.push({...to,heading,cost:p.cost+8+(p.heading<0||p.heading===heading?0:2)});
    }
    const cities=blocks.map((b,i)=>({id:`city-${i}`,blocks:[b],nodes:[{id:`node-${i}`,...b.origin}]}));
    const result=planIntercityRoads({countryId:'oracle',seed,cities,isBuildable:terrain,limits:{searchMarginCells:16}});
    if(!Number.isFinite(optimum)){disconnected++;expect(result.unreachable.map(f=>f.reason),`seed${seed}`).toEqual(['NO_PATH']);continue;}
    connected++;expect(result.routes,`seed${seed}`).toHaveLength(1);
    const route=result.routes[0]!,path=decodeOrthogonalRoadRuns(route.geometry);
    const cost=path.length-1+(route.geometry.runs.length-1)*2;
    expect(cost,`seed${seed}`).toBe(optimum);
  }
  expect(connected).toBeGreaterThan(10);expect(disconnected).toBeGreaterThan(0);
});
