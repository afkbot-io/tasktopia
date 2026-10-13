import { expect, it } from "vitest";
import { railPolyline } from "../src/shared/rail-convoy";
import { seaVessel } from "../src/shared/sea-vessel";
import { transportSchedule, TRANSPORT_EPOCH } from "../src/shared/transport-schedule";
it("shares departure, docking, return and absence across full and local views",()=>{
  const schedule=transportSchedule("SEA","a","b"),zero=TRANSPORT_EPOCH-schedule.offsetMs;
  const line=railPolyline([{x:0,y:0},{x:0,y:8},{x:8,y:8}]);
  const at=(seconds:number,range:[number,number]=[0,1])=>seaVessel(line,schedule,"a",zero+seconds*1000,range);
  expect(at(0)).toMatchObject({visible:true,phase:"STOPPED",point:{x:0,y:0}});
  expect(at(30,[0,.12])).toMatchObject({visible:true,progress:.05});
  expect(at(60,[0,.12])).toMatchObject({visible:false,point:null});
  expect(at(144,[.88,1])).toMatchObject({visible:true,phase:"STOPPED",point:{x:8,y:8}});
  expect(at(170,[.88,1])).toMatchObject({visible:true,direction:-1});
  expect(at(290)).toMatchObject({visible:true,phase:"STOPPED"});
  const bend=at(84);expect(bend.point).toMatchObject({x:0,y:8});
  expect(seaVessel(railPolyline([]),schedule,"a",zero).visible).toBe(false);
});
it("keeps two ferries on separate passing lanes without changing the shared voyage",()=>{
 const schedule=transportSchedule("SEA","a","b",0),line=railPolyline([{x:0,y:0},{x:20,y:0}]);
 const time=TRANSPORT_EPOCH+schedule.dwellMs+schedule.travelMs/2;
 const east=seaVessel(line,schedule,"a",time,[0,1],0,.5);
 const west=seaVessel(line,schedule,"a",time,[0,1],1,.5);
 expect(east.point).toMatchObject({x:10,y:.5,heading:"east"});
 expect(west.point).toMatchObject({x:10,y:-.5,heading:"west"});
 expect(east.vehicleId).not.toBe(west.vehicleId);
 expect(seaVessel(line,schedule,"a",TRANSPORT_EPOCH,[0,1],0,.5).point).toMatchObject({x:0,y:0});
 expect(seaVessel(line,schedule,"a",TRANSPORT_EPOCH+288_000,[0,1],0,.5).point).toMatchObject({x:0,y:0});
});
