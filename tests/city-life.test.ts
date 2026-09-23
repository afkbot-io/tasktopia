import {expect,it} from 'vitest';
import type {CityLifeTask} from '../src/client/city-life';
import {cityLifeSites,sampleCityLife,cityLifeHash,planCityLife} from '../src/client/city-life';
const graph=new Map(Array.from({length:12},(_,x)=>[`${x},0`,{x,y:0}]));
const task={id:'home',status:'COMPLETED',stage:5,accessPath:[{x:0,y:0}],visualKind:'BUILDING',workItemType:'TASK'} satisfies CityLifeTask;
it('использует только завершённые участки с настоящим свободным подходом',()=>{
  const source=JSON.stringify(task),sites=cityLifeSites([task,task],graph,new Set());
  expect(sites).toHaveLength(1);expect(sites[0]!.route.at(-1)).toEqual({x:0,y:0});
  expect(sites[0]!.route.every(c=>graph.has(`${c.x},${c.y}`))).toBe(true);
  expect(cityLifeSites([{...task,status:'IN_PROGRESS',stage:3}],graph,new Set())).toEqual([]);
  expect(cityLifeSites([{...task,defectSummary:{open:1,inProgress:0,verifying:0,active:1}}],graph,new Set())).toEqual([]);
  expect(cityLifeSites([task],graph,new Set(['3,0']))).toEqual([]);expect(JSON.stringify(task)).toBe(source);
});
it('одна сцена приезжает, действует и уходит; reload и порядок данных её не меняют',()=>{
  const sites=cityLifeSites([task],graph,new Set()),window=cityLifeHash(task.id)%4;
  const start=window*180000+15000+cityLifeHash(`city:${window}:start`)%90000;
  const view={minX:-10,minY:-10,maxX:20,maxY:20},options={enabled:true,reducedMotion:false};
  expect(sampleCityLife('city',sites,start-1,view,options)).toBeUndefined();
  expect(sampleCityLife('city',sites,start,view,options)?.position).toEqual(sites[0]!.route[0]);
  expect(sampleCityLife('city',sites,start+9000,view,options)?.phase).toBe('ACTIVITY');
  expect(sampleCityLife('city',sites,start+35000,view,options)?.phase).toBe('LEAVING');
  expect(sampleCityLife('city',sites,start+38000,view,options)).toBeUndefined();
  expect(sampleCityLife('city',sites,start+9000,view,options)).toEqual(sampleCityLife('city',[...sites].reverse(),start+9000,view,options));
  expect(sampleCityLife('city',sites,start+9000,view,{...options,enabled:false})).toBeUndefined();
  expect(sampleCityLife('city',sites,start+9000,view,{...options,reducedMotion:true})).toBeUndefined();
});

it('камера не выбирает новое событие вместо невидимого канонического участка',()=>{
 const sites=cityLifeSites([task,{...task,id:'home-other'}],graph,new Set());
 const ids=sites.map(site=>site.taskId);
 for(let window=0;window<4;window++){
  const plan=planCityLife('city',sites,window*180000,ids);if(!plan)continue;
  expect(planCityLife('city',sites.filter(site=>site.taskId!==plan.taskId),window*180000,ids)).toBeUndefined();
 }
});
