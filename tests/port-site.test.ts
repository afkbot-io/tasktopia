import {expect,it} from "vitest";
import {planPortSite,type PortSiteInput} from "../src/shared/port-site";
const input:PortSiteInput={countryId:"country",cityId:"city",worldSeed:42,
 terminal:{minX:1,minY:2,maxX:6,maxY:5},
 cells:Array.from({length:20*12},(_,i)=>({x:i%20,y:Math.floor(i/20),water:i%20>=7})),
 occupied:[],link:{countryId:"country",cityId:"city",worldSeed:42,localOutlet:{x:18,y:4},oceanOutlet:{x:0,y:1}},
 oceanCells:[{x:0,y:1}],oceanBounds:{minX:0,minY:0,maxX:10,maxY:10}};
it("places an attached short pier and a reachable berth without modifying terrain",()=>{
 const before=structuredClone(input),plan=planPortSite(input);
 expect(plan).not.toBeNull();expect(plan!.pier.length).toBeGreaterThan(0);expect(plan!.pier.length).toBeLessThanOrEqual(8);
 expect(plan!.terminal).toEqual(input.terminal);
 expect(plan!.waterPath[0]).toEqual(plan!.berth);expect(plan!.waterPath.at(-1)).toEqual(input.link!.localOutlet);
 const water=new Set(input.cells.filter(c=>c.water).map(c=>`${c.x},${c.y}`));
 for(const cell of [...plan!.pier,...plan!.waterPath])expect(water.has(`${cell.x},${cell.y}`)).toBe(true);
 expect(input).toEqual(before);
});
it("requires a scoped explicit link to actual open ocean, not a viewport edge or lake",()=>{
 expect(planPortSite({...input,link:undefined})).toBeNull();
 for(const change of [{countryId:"other"},{cityId:"other"},{worldSeed:99}])expect(planPortSite({...input,link:{...input.link!,...change}})).toBeNull();
 expect(planPortSite({...input,oceanCells:[{x:5,y:5}],link:{...input.link!,oceanOutlet:{x:5,y:5}}})).toBeNull();
 expect(planPortSite({...input,cells:input.cells.map(c=>c.x===15?{...c,water:false}:c)})).toBeNull();
});
it("never builds through occupied land, water reservations or an unusable terminal",()=>{
 expect(planPortSite({...input,occupied:[{x:3,y:3}]})).toBeNull();
 expect(planPortSite({...input,occupied:input.cells.filter(c=>c.x===7)})).toBeNull();
 expect(planPortSite({...input,terminal:{minX:2,minY:2,maxX:3,maxY:3}})).toBeNull();
 expect(planPortSite({...input,terminal:{minX:5,minY:2,maxX:10,maxY:5}})).toBeNull();
});
it("connects an inland terminal to its pier with a bounded unobstructed land approach",()=>{
 const inland={...input,cells:Array.from({length:30*12},(_,i)=>({x:i%30,y:Math.floor(i/30),water:i%30>=12})),link:{...input.link!,localOutlet:{x:28,y:4}}};
 const plan=planPortSite(inland);
 expect(plan).not.toBeNull();
 expect(plan!.approach).toEqual(Array.from({length:5},(_,i)=>({x:7+i,y:3})));
 expect(plan!.pier[0]).toEqual({x:12,y:3});
 expect(planPortSite({...inland,occupied:inland.cells.filter(c=>c.x===9)})).toBeNull();
 expect(planPortSite({...inland,cells:inland.cells.filter(c=>c.x!==9)})).toBeNull();
 const tooFar={...inland,cells:Array.from({length:90*12},(_,i)=>({x:i%90,y:Math.floor(i/90),water:i%90>=60})),link:{...input.link!,localOutlet:{x:88,y:4}}};
 expect(planPortSite(tooFar)).toBeNull();
});
