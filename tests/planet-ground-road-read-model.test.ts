import { expect,it } from 'vitest';
import { readPlanetGroundRoads } from '../src/shared/planet-ground-roads';

const route=(id='r')=>({id,fromCityId:'a',toCityId:'b',fromNodeId:'an',toNodeId:'bn',widthCells:3,
  geometry:{start:{x:0,y:0},runs:[{direction:'E',length:16}]}});
const source=(countryId:string,routes:unknown)=>({countryId,revision:7,routes,cityIds:new Set(['a','b'])});
it('copies only approved canonical fields and marks missing, invalid and foreign-city sources explicitly',()=>{
  const original=route(),withPrivate={...original,privatePlanner:'never publish',geometry:{...original.geometry,privateSites:['secret']}};
  const next=readPlanetGroundRoads([source('country',[withPrivate,{...route('foreign'),toCityId:'not-a-member-city'},
    {...route('invalid'),geometry:{start:{x:0,y:0},runs:[{direction:'E',length:-1}]}}]),
  {...source('missing',[]),revision:null},source('invalid-source',{})]);
  expect(next.get('country')).toMatchObject({state:'READY',revision:7,routes:[original],omittedRoutes:2,
    omittedReasons:{MISSING_CITY:1,INVALID_GEOMETRY:1}});
  expect(JSON.stringify([...next])).not.toContain('secret');expect(JSON.stringify([...next])).not.toContain('privatePlanner');
  expect(next.get('missing')).toMatchObject({state:'MISSING_SNAPSHOT',routes:[]});
  expect(next.get('invalid-source')).toMatchObject({state:'INVALID_SNAPSHOT',routes:[]});
  for(const revision of [-1,NaN,Infinity])expect(readPlanetGroundRoads([{...source('bad-revision',[]),revision}]).get('bad-revision'))
    .toMatchObject({state:'INVALID_SNAPSHOT',revision:0,routes:[]});
  original.geometry.start.x=50;expect(next.get('country')!.routes[0]!.geometry.start.x).toBe(0);
});
it('bounds total accepted routes, inspected runs and geometry even across many countries, reporting every omission',()=>{
  const sources=Array.from({length:12},(_,i)=>source(`country-${i}`,Array.from({length:100},(_,j)=>route(`r${i}-${j}`))));
  const bounded=readPlanetGroundRoads(sources);
  const values=[...bounded.values()];
  expect(values.reduce((n,c)=>n+c.routes.length,0)).toBe(1024);
  expect(values.reduce((n,c)=>n+c.omittedRoutes,0)).toBe(176);
  const huge=route('huge');huge.geometry.runs=Array.from({length:16385},()=>({direction:'E',length:1}));
  const long=route('too-long');long.geometry.runs=[{direction:'E',length:300001}];
  const capped=readPlanetGroundRoads([source('country',[huge,long,route('small')])]).get('country')!;
  expect(capped.routes.map(r=>r.id)).toEqual(['small']);expect(capped.omittedRoutes).toBe(2);
  expect(capped.omittedReasons).toEqual({CAPACITY:2});
});
