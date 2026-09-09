import { expect, it } from "vitest";
import { transportBuildingArt } from "../src/shared/transport-building-art";
it("renders a native terminal inside a larger historical airport parcel", () => {
 const task={buildingType:"compact-long-gallery-v1",serviceRole:"AIRPORT" as const,origin:{x:10,y:20},footprint:Array.from({length:72},(_,i)=>({x:10+i%12,y:20+Math.floor(i/12)}))};
 const art=transportBuildingArt(task);
 expect(art.key).toBe("compact-airport-v1");expect(art.origin).toEqual({x:13,y:22});
 expect(art.entry.spriteSize).toEqual({width:48,height:32});
 expect(task.origin).toEqual({x:10,y:20});
});
it("does not squeeze a transport terminal into an undersized parcel", () => {
 const art=transportBuildingArt({buildingType:"compact-apartment-v1",serviceRole:"AIRPORT",origin:{x:0,y:0},footprint:[{x:0,y:0}]});
 expect(art.key).toBe("compact-apartment-v1");
});
