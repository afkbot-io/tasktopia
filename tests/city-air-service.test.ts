import { expect,it } from "vitest";
import { planAirportSite } from "../src/shared/airport-site";
import { planCityAirServices,sampleCityAirService } from "../src/shared/city-air-service";
import { airportTimetable,airportScheduleOffset } from "../src/shared/transport-network";
import { TRANSPORT_EPOCH } from "../src/shared/transport-schedule";
const city={id:"home",name:"Город",center:{x:20,y:20},bounds:{minX:0,minY:0,maxX:40,maxY:40}};
const site=planAirportSite({bounds:city.bounds,entrance:{x:20,y:0},occupied:[],isDry:()=>true})!;
function plans(){const timed=airportTimetable([{fromCityId:"home",toCityId:"away"}],[]);
 return planCityAirServices({city,airports:[{taskId:"a",stage:5,plan:site,reason:null}],airportConnections:[{id:"a:z",from:{taskId:"a",cityId:"home",point:city.center},to:{taskId:"z",cityId:"away",point:{x:300,y:20}},scheduleOffsetMs:airportScheduleOffset(timed[0]!,"a","z")}]});}
it("runs a continuous complete gate/taxi/runway/flight/landing/return cycle using fixed identity",()=>{
 const plan=plans()[0]!;
 const at=(ms:number)=>sampleCityAirService(plan,TRANSPORT_EPOCH+ms);
 expect(at(0)).toMatchObject({phase:"GATE",visible:true});
 expect(at(26_000).phase).toBe("TAXI_OUT");expect(at(34_000).phase).toBe("TAKEOFF");expect(at(40_000).phase).toBe("FLYING");
 expect(at(60_000)).toMatchObject({phase:"AWAY",visible:false});
 expect(at(185_000).phase).toBe("FLYING");expect(at(190_000).phase).toBe("LANDING");expect(at(194_000).phase).toBe("TAXI_IN");
 expect(at(200_000)).toMatchObject({phase:"GATE",visible:true,point:at(0).point,vehicleId:at(0).vehicleId});
 for(const boundary of [25_000,33_000,36_000,189_000,192_000,200_000]){
  // Across a phase boundary the displacement over2ms stays below one native pixel.
  const a=at(boundary-1),b=at(boundary+1);expect(Math.hypot(a.point.x-b.point.x,a.point.y-b.point.y)).toBeLessThan(.1);
 }
});
it("does not operate an unfinished terminal or an airport without safe geometry",()=>{
 const [plan]=plans();expect(plan).toBeDefined();
 const input={city,airportConnections:[plan!.route]};
 expect(planCityAirServices({...input,airports:[{taskId:"a",stage:4,plan:site,reason:null}]})).toEqual([]);
 expect(planCityAirServices({...input,airports:[{taskId:"a",stage:5,plan:null,reason:"NO_AIRFIELD"}]})).toEqual([]);
 expect(plans().map(p=>p.vehicleId)).toEqual(plans().map(p=>p.vehicleId));
});
