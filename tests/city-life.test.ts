import {expect,it} from 'vitest';
import type {CityLifeTask} from '../src/client/city-life';
import {cityLifeSites,planCityLife} from '../src/client/city-life';
const graph=new Map(Array.from({length:12},(_,x)=>[`${x},0`,{x,y:0}]));
const task={id:'home',status:'COMPLETED',stage:5,accessPath:[{x:0,y:0}],visualKind:'BUILDING',workItemType:'TASK'} satisfies CityLifeTask;
it('планирует доступный локальный участок в середине любого окна с устойчивым ID',()=>{
 const sites=cityLifeSites([task],graph,new Set());
 for(let window=0;window<4;window++){
  const now=window*180_000+42_000,plan=planCityLife('city',sites,now);
  expect(plan?.taskId).toBe('home');expect(plan?.start).toBe(now);
  expect(planCityLife('city',sites,now+1000)?.id).toBe(plan!.id);
 }
});
it('использует только завершённые участки с настоящим свободным подходом',()=>{
  const source=JSON.stringify(task),sites=cityLifeSites([task,task],graph,new Set());
  expect(sites).toHaveLength(1);expect(sites[0]!.route.at(-1)).toEqual({x:0,y:0});
  expect(sites[0]!.route.every(c=>graph.has(`${c.x},${c.y}`))).toBe(true);
  expect(cityLifeSites([{...task,status:'IN_PROGRESS',stage:3}],graph,new Set())).toEqual([]);
  expect(cityLifeSites([{...task,defectSummary:{open:1,inProgress:0,verifying:0,active:1}}],graph,new Set())).toEqual([]);
  expect(cityLifeSites([task],graph,new Set(['3,0']))).toEqual([]);expect(JSON.stringify(task)).toBe(source);
});
it('порядок локальных кандидатов не меняет выбранную площадку',()=>{
 const sites=cityLifeSites([task,{...task,id:'home-other'}],graph,new Set());
 for(let window=0;window<4;window++){
  const now=window*180000,plan=planCityLife('city',sites,now);
  expect(planCityLife('city',[...sites].reverse(),now)).toEqual(plan);
 }
});

it('готовит для учений только ближайшие настоящие дорожные клетки без обхода всей сети',()=>{
 const roads=new Map(Array.from({length:10000},(_,x)=>[`${x},2`,{x,y:2}]));
 roads.values=()=>{throw new Error('full road scan for a drill');};
 const site=cityLifeSites([{...task,serviceRole:'FIRE'}],graph,new Set(),roads)[0]!;
 expect(site.kind).toBe('DRILL');expect(site.responseCells!.length).toBeGreaterThan(0);
 expect(site.responseCells!.length).toBeLessThanOrEqual(16);
 expect(site.responseCells!.every(cell=>roads.has(`${cell.x},${cell.y}`)&&Math.abs(cell.x)<=8&&Math.abs(cell.y)<=8)).toBe(true);
});
