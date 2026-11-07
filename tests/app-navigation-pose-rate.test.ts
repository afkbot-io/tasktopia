import { afterEach,expect,it,vi } from 'vitest';
import { AppNavigation,type NavigationView } from '../src/client/app-navigation';

afterEach(()=>vi.useRealTimers());
const city:NavigationView={countryId:'country-a',cityId:'city-a',mode:'CITY',cityView:{center:{x:0,y:0},scale:1}};
function fixture(){
  const entries:Array<{state:unknown;url:string}>=[{state:null,url:'/'}];let index=0,writes=0;
  const timestamps:number[]=[];
  const history={get state(){return entries[index]!.state;},replaceState(next:unknown,_unused:string,nextUrl?:string|URL|null){
    const now=Date.now();while(timestamps.length&&timestamps[0]!<=now-10_000)timestamps.shift();
    if(timestamps.length>=100)throw new DOMException('Safari history frequency limit','SecurityError');
    timestamps.push(now);writes++;entries[index]={state:structuredClone(next),url:String(nextUrl)};
  },pushState(next:unknown,_unused:string,nextUrl?:string|URL|null){entries.splice(index+1);entries.push({state:structuredClone(next),url:String(nextUrl)});index++;},
    go(delta:number){index=Math.max(0,Math.min(entries.length-1,index+delta));}};
  return {history,url:()=>entries[index]!.url,writes:()=>writes};
}
it('coalesces600camera frames within Safari history limits while retaining the exact latest pose',async()=>{
  vi.useFakeTimers();vi.setSystemTime(0);
  const f=fixture(),nav=new AppNavigation(f.history,f.url);nav.view(city);
  for(let frame=1;frame<=600;frame++){
    await vi.advanceTimersByTimeAsync(16);
    nav.pose({...city,cityView:{center:{x:frame,y:-frame},scale:1.7}});
    expect(nav.current()?.view.cityView?.center).toEqual({x:frame,y:-frame});
  }
  await vi.advanceTimersByTimeAsync(250);
  expect(f.writes()).toBeLessThanOrEqual(51);
  expect(f.history.state).toMatchObject({view:{cityView:{center:{x:600,y:-600},scale:1.7}}});
});
it('keeps each entry exact when native Back interrupts a pending pose before its timer',async()=>{
  vi.useFakeTimers();vi.setSystemTime(0);
  const f=fixture(),nav=new AppNavigation(f.history,f.url);nav.view(city);nav.task(city,{id:'a',taskNumber:1},false);
  const shown={...city,cityView:{center:{x:120,y:80},scale:2}};
  nav.pose(shown);f.history.go(-1);
  expect(nav.restore(f.history.state)?.view).toEqual(city);
  await vi.advanceTimersByTimeAsync(250);expect(nav.current()?.view).toEqual(city);
  f.history.go(1);expect(nav.restore(f.history.state)?.view).toEqual(shown);
});
it('flushes before a new route and cancels private pending state on session teardown',async()=>{
  vi.useFakeTimers();vi.setSystemTime(0);
  const f=fixture(),nav=new AppNavigation(f.history,f.url);nav.view(city);
  const shown={...city,cityView:{center:{x:20,y:30},scale:1.3}};
  nav.pose(shown);nav.pending(shown,'a',false);f.history.go(-1);expect(nav.current()?.view).toEqual(shown);
  nav.pose({...shown,cityView:{center:{x:999,y:999},scale:4}});nav.cancelPose();
  const before=structuredClone(f.history.state),writes=f.writes();await vi.advanceTimersByTimeAsync(250);
  expect(f.writes()).toBe(writes);expect(f.history.state).toEqual(before);
});
it('never lets a deferred pose overwrite an externally entered country',async()=>{
  vi.useFakeTimers();vi.setSystemTime(0);
  const f=fixture(),nav=new AppNavigation(f.history,f.url);nav.view(city);nav.pose({...city,cityView:{center:{x:9,y:9},scale:2}});
  const foreign={kind:'tasktopia.navigation',version:1,entryId:'foreign-entry',view:{countryId:'country-b',cityId:null,mode:'PLANET'},taskDepth:0};
  f.history.pushState(foreign,'','/?countryId=country-b');const writes=f.writes();
  await vi.advanceTimersByTimeAsync(250);expect(f.writes()).toBe(writes);expect(f.history.state).toEqual(foreign);
});
it('upgrades a legacy entry once and snapshots mutable input without changing its route',async()=>{
  vi.useFakeTimers();vi.setSystemTime(0);
  const f=fixture(),nav=new AppNavigation(f.history,f.url),view=structuredClone(city);
  f.history.replaceState({kind:'tasktopia.navigation',version:1,view:city,taskDepth:0},'','/?countryId=country-a&cityId=city-a');
  nav.pose(view);view.cityView!.center.x=999;
  expect(nav.current()?.entryId).toBeTruthy();expect(nav.current()?.view.cityView!.center.x).toBe(0);
  await vi.advanceTimersByTimeAsync(250);expect(f.url()).toBe('/?countryId=country-a&cityId=city-a');
  expect(nav.current()?.view.cityView!.center.x).toBe(0);expect(f.writes()).toBe(3);
});
