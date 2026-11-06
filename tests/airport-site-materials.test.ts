import {expect,it} from 'vitest';
import type {Graphics} from 'pixi.js';
import {drawCityAirportSites} from '../src/client/airport-site-view';
import {planAirportSite} from '../src/shared/airport-site';
const plan=planAirportSite({bounds:{minX:0,minY:0,maxX:30,maxY:30},entrance:{x:15,y:20},occupied:[],isDry:()=>true})!;
it('uses existing native city materials at whole cells while preserving the canonical site',()=>{
  const view={rect(){return this;},fill(){return this;}},materials:{rect:number[];kind:string}[]=[],before=JSON.stringify(plan);
  drawCityAirportSites(view as unknown as Graphics,[{stage:5,plan}],8,(_view,x,y,w,h,kind)=>{materials.push({rect:[x,y,w,h],kind});return true;});
  expect(new Set(materials.map(item=>item.kind))).toEqual(new Set(['PAVEMENT','PATH_PAVERS','PATH_ASPHALT','DRIVEWAY']));
  expect(materials.length).toBeGreaterThan(20);
  for(const {rect} of materials)for(const value of rect)expect(Number.isInteger(value/8)).toBe(true);
  expect(JSON.stringify(plan)).toBe(before);
});
it('keeps unfinished ground and fallbacks bounded to the existing site/access across all stages',()=>{
  for(const stage of [1,2,3,4,5]){
    const rectangles:number[][]=[],view={rect(...r:number[]){rectangles.push(r);return this;},fill(){return this;}};
    drawCityAirportSites(view as unknown as Graphics,[{stage,plan}],8,()=>false);
    const allowed=new Set(plan.access.map(p=>`${p.x},${p.y}`));
    for(let y=plan.airfield.minY;y<=plan.airfield.maxY;y++)for(let x=plan.airfield.minX;x<=plan.airfield.maxX;x++)allowed.add(`${x},${y}`);
    for(const [x,y,w,h] of rectangles)for(let py=y!;py<y!+h!;py++)for(let px=x!;px<x!+w!;px++)expect(allowed.has(`${Math.floor(px/8)},${Math.floor(py/8)}`)).toBe(true);
  }
});
