import { describe, expect, it } from "vitest";
import { planCityRailway, cityTrainPosition, railwayIntersectsRect } from "../src/client/city-railway";
import type { ChunkTaskDto } from "../src/shared/contracts";
const station = { id: "station", cityId: "city", serviceRole: "RAILWAY", stage: 5, status: "COMPLETED", origin: {x: 10, y: 10}, footprint: Array.from({length:24}, (_,i)=>({x:10+i%6,y:10+Math.floor(i/6)})), accessPath:[{x:13,y:14}] } as ChunkTaskDto;
const bounds = {minX:0,minY:0,maxX:40,maxY:40};
describe("city railway", () => {
  it("has no line without a station", () => expect(planCityRailway(bounds, [], [])).toBeUndefined());
  it("keeps the straight line and access off existing and reserved parcels", () => {
    const sites = [{id:"future",kind:"BUILDING" as const,origin:{x:0,y:17},width:40,height:7}];
    const line = planCityRailway(bounds,[station],sites)!;
    expect(line).toBeDefined();
    expect(line.from.x === line.to.x || line.from.y === line.to.y).toBe(true);
    for (const cell of station.footprint) expect(line.axis === "horizontal" ? Math.abs(cell.y-line.from.y) : Math.abs(cell.x-line.from.x)).toBeGreaterThan(2);
    expect(line.access.every(cell => !(cell.y>=17 && cell.y<24 && cell.x>=0 && cell.x<40))).toBe(true);
    expect(line.running).toBe(true);
  });
  it("is independent of payload order and does not run before completion", () => {
    const second={...station,id:"z",origin:{x:30,y:10},footprint:station.footprint.map(p=>({...p,x:p.x+20}))};
    expect(planCityRailway(bounds,[station,second],[])).toEqual(planCityRailway(bounds,[second,station],[]));
    expect(planCityRailway(bounds,[{...station,stage:4,status:"TESTING"}],[])!.running).toBe(false);
  });
  it("moves an entire consist with fixed wagon spacing and wraps outside the map", () => {
    const line=planCityRailway(bounds,[station],[])!;
    const a=cityTrainPosition(line,1000), b=cityTrainPosition(line,2000);
    expect(b[0]!.x-a[0]!.x + b[0]!.y-a[0]!.y).toBeCloseTo(5);
    expect(a).toHaveLength(4);
    expect(Math.hypot(a[0]!.x-a[1]!.x,a[0]!.y-a[1]!.y)).toBe(3.5);
  });
  it("supports a vertical corridor and excludes scenery from its platform", () => {
    const line = planCityRailway(bounds, [station], [])!;
    const vertical = {...line, axis: "vertical" as const, from: {x: 4, y: -10}, to: {x: 4, y: 50}, access: []};
    const positions = cityTrainPosition(vertical, 2000);
    expect(new Set(positions.map(p => p.x)).size).toBe(1);
    expect(positions[0]!.y - positions[1]!.y).toBe(3.5);
    expect(railwayIntersectsRect(vertical, {x: 5, y: 10}, 2, 2)).toBe(true);
    expect(railwayIntersectsRect(vertical, {x: 10, y: 10}, 2, 2)).toBe(false);
    expect(railwayIntersectsRect({...vertical, stage:0}, {x:5,y:10}, 2, 2)).toBe(false);
  });
});
