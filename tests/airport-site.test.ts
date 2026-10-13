import { expect,it } from "vitest";
import { planAirportSite,airportSiteReservations } from "../src/shared/airport-site";
const base={bounds:{minX:0,minY:0,maxX:30,maxY:30},entrance:{x:15,y:20},occupied:[{minX:10,minY:10,maxX:15,maxY:19}],isDry:()=>true};
it("reserves a complete airfield and joins the existing entrance without touching parcels",()=>{
 const plan=planAirportSite(base)!;expect(plan).toBeDefined();expect(plan.runway).toHaveLength(2);expect(plan.stands).toHaveLength(4);
 expect(plan.access[0]).toEqual(base.entrance);expect(plan.access.at(-1)).toEqual(plan.gate);
 const rectangles=airportSiteReservations(plan);
 for(const p of [...plan.access,...plan.taxiPath,...plan.runway,...plan.stands])expect(rectangles.some(r=>p.x>=r.minX&&p.x<=r.maxX&&p.y>=r.minY&&p.y<=r.maxY)).toBe(true);
 for(const p of plan.access)expect(base.occupied.some(r=>p.x>=r.minX&&p.x<=r.maxX&&p.y>=r.minY&&p.y<=r.maxY)).toBe(false);
 expect(planAirportSite({...base,occupied:[...base.occupied].reverse()})).toEqual(plan);
});
it("does not invent a runway on water or behind an unreachable entrance",()=>{
 expect(planAirportSite({...base,isDry:()=>false})).toBeNull();
 expect(planAirportSite({...base,occupied:[{minX:14,minY:19,maxX:16,maxY:21}]})).toBeNull();
 expect(planAirportSite({...base,entrance:{x:NaN,y:0}})).toBeNull();
});
