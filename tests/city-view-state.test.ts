import {expect,it} from "vitest";
import {CityViewPublisher,CityViewRestoreQueue,readCityViewState} from "../src/client/city-view-state";
const view={center:{x:-12.5,y:44.75},scale:1.5};

it("keeps the newest valid restoration, ignores old tokens, and lets a later explicit focus cancel it",()=>{
  const queue=new CityViewRestoreQueue();
  expect(queue.request({view,token:1})).toBe(true);
  expect(queue.request({view:{...view,scale:2},token:2})).toBe(true);
  expect(queue.request({view,token:1})).toBe(false);
  expect(queue.take()).toMatchObject({token:2,view:{scale:2}});
  expect(queue.request({view,token:2})).toBe(false);
  expect(queue.request({view:{...view,scale:9},token:3})).toBe(false);
  expect(queue.request({view,token:3})).toBe(true);queue.cancel();
  expect(queue.take()).toBeUndefined();expect(queue.epoch).toBe(3);
});

it("accepts finite continuous CITY poses, rejecting malformed history and unsupported scales",()=>{
  expect(readCityViewState(view)).toEqual(view);
  for(const bad of [null,[],{center:{x:NaN,y:0},scale:1},{center:{x:Infinity,y:0},scale:1},{center:{x:0,y:0},scale:0},
    {center:{x:0,y:0},scale:4.1},{center:{x:0,y:0},scale:.3},{center:{x:0,y:'0'},scale:1}])expect(readCityViewState(bad)).toBeUndefined();
});

it("publishes only explicit settled poses and bounds repeated callbacks to250ms without dropping the latest pending pose",()=>{
  const source=new CityViewPublisher();
  expect(source.settle(0,view,true)).toBeUndefined();
  source.markExplicit();expect(source.settle(0,view,false)).toBeUndefined();
  expect(source.settle(10,view,true)).toEqual(view);
  source.markExplicit();expect(source.settle(100,{...view,scale:2},true)).toBeUndefined();
  expect(source.settle(260,{...view,scale:3},true)).toMatchObject({scale:3});
  expect(source.settle(510,view,true)).toBeUndefined();
});
