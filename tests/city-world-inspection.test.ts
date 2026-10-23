import {expect,it} from "vitest";
import {CityWorldInspection,type TransportInspection} from "../src/client/city-world-inspection";
const item:TransportInspection={kind:"TRANSPORT",transportKind:"AIR",routeId:"real-route",vehicleId:"real-vehicle",journeyId:"real-journey",
  title:"Самолёт",phase:"GATE",activity:"BOARDING",fromName:"Лесной",toName:"Приморск",progress:0,waiting:2,aboard:1,boarded:1,alighted:0,
  local:true,position:{x:5,y:8},task:{countryId:"country",taskId:"airport"}};
const enabled={active:true,reducedMotion:false,life:true};

it("opening a real vehicle never moves the camera; follow requires an explicit action and manual navigation cancels it",()=>{
  const view=new CityWorldInspection();view.open(item);
  expect(view.following).toBe(false);expect(view.update(0,item,enabled).cameraPoint).toBeUndefined();
  expect(view.follow()).toBe(true);expect(view.update(250,item,enabled).cameraPoint).toEqual(item.position);
  view.manualNavigation();expect(view.update(500,item,enabled).cameraPoint).toBeUndefined();
});

it("expires the selected journey instead of following a replacement vehicle or the next trip",()=>{
  const view=new CityWorldInspection();view.open(item);view.follow();
  const frame=view.update(0,{...item,journeyId:"later-journey",position:{x:80,y:90}},enabled);
  expect(frame.publication).toMatchObject({ended:true,following:false,item:{journeyId:"real-journey"}});
  expect(frame.cameraPoint).toBeUndefined();
  expect(view.update(1000,undefined,enabled).publication).toBeUndefined();
});

it("bounds React publications to250ms while preserving per-frame follow, phase changes, and inactive/reduced-motion cancellation",()=>{
  const view=new CityWorldInspection();view.open(item);
  expect(view.update(0,item,enabled).publication).toBeDefined();
  expect(view.update(50,{...item,progress:.02},enabled).publication).toBeUndefined();
  view.follow();
  expect(view.update(60,item,enabled).publication?.following).toBe(true);
  expect(view.update(70,{...item,position:{x:6,y:8}},enabled).cameraPoint).toEqual({x:6,y:8});
  expect(view.update(80,{...item,phase:"TAXI_OUT"},enabled).publication?.item.phase).toBe("TAXI_OUT");
  expect(view.update(100,item,{...enabled,reducedMotion:true})).toMatchObject({publication:{following:false},cameraPoint:undefined});
  expect(view.update(101,item,{...enabled,active:false}).cameraPoint).toBeUndefined();
  view.close();expect(view.update(500,item,enabled)).toEqual({});
});
it("cannot follow an off-map vehicle or a place and does not expose a mutable source snapshot",()=>{
  const view=new CityWorldInspection();const source={...item,position:{x:5,y:8}};view.open(source);
  source.position.x=99;expect(view.update(0,undefined,enabled).publication?.item.position?.x).toBe(5);
  view.open({...item,local:false});expect(view.follow()).toBe(false);
  view.open({...item,position:undefined});expect(view.follow()).toBe(false);
});
