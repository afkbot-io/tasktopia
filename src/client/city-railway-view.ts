import { Graphics } from "pixi.js";
import type {Cell} from "../shared/contracts";
import { cityRailwayPlatformSpan, cityRailwayPassengerPaths, type CityRailway } from "./city-railway";

/** Native pixel geometry: no stroked subpixel rails or arbitrary sprite rotation. */
export function drawCityRailway(view: Graphics, line: CityRailway, cellSize: number,isDry?:(cell:Cell)=>boolean): void {
  view.clear();
  if (line.stage <= 0) return;
  const horizontal=line.axis==="horizontal";
  const start=(horizontal?line.from.x:line.from.y)*cellSize;
  const end=(horizontal?line.to.x:line.to.y)*cellSize;
  const cross=(horizontal?line.from.y:line.from.x)*cellSize;
  const rect=(along:number,across:number,length:number,width:number,color:number) => {
    if(horizontal) view.rect(along,across,length,width).fill(color);
    else view.rect(across,along,width,length).fill(color);
  };
  for(const p of cityRailwayPassengerPaths(line).access){
    if(isDry&&!isDry(p)){
      view.rect(p.x*cellSize,p.y*cellSize,cellSize,cellSize).fill(0x586e68);
      view.rect(p.x*cellSize,p.y*cellSize,1,cellSize).fill(0x97a089);
      view.rect(p.x*cellSize+cellSize-1,p.y*cellSize,1,cellSize).fill(0x344b47);
    }
    view.rect(p.x*cellSize+2,p.y*cellSize+2,cellSize-4,cellSize-4).fill(line.stage<3?0x756750:0x777f7b);
  }
  // Existing straight corridors cross natural streams. Native bridge decks
  // and supports make that crossing explicit instead of floating ballast.
  if(isDry){
    let run:number|undefined;
    for(let along=start;along<=end;along+=cellSize){
      const p=horizontal?{x:Math.floor(along/cellSize),y:line.from.y}:{x:line.from.x,y:Math.floor(along/cellSize)};
      const wet=along<end&&!isDry(p);
      if(wet&&run===undefined)run=along;
      if(!wet&&run!==undefined){
        rect(run-2,cross-cellSize-4,along-run+4,2*cellSize+8,0x586e68);
        for(let beam=run;beam<along;beam+=8*cellSize){rect(beam,cross-cellSize-7,3,2*cellSize+14,0x344b47);rect(beam,cross-cellSize-7,1,2*cellSize+14,0x97a089);}
        rect(run-2,cross-cellSize-4,along-run+4,2,0xa5ac94);rect(run-2,cross+cellSize+2,along-run+4,2,0x344b47);run=undefined;
      }
    }
  }
  for(const offset of [-cellSize,0]){
    const c=cross+offset;
    rect(start,c-2,end-start,cellSize+4,line.stage<3?0x756750:0x59635f);
    for(let along=start;along<end;along+=3){
      const seed=Math.imul(Math.floor(along),1103515245)>>>0;
      rect(along,c-2+seed%(cellSize+3),1+seed%2,1,[0x424e4b,0x758078,0x636b62][seed%3]!);
    }
    for(let along=start;along<end;along+=6){
      if(line.stage===1){rect(along,c,1,cellSize,0x9c906b);continue;}
      rect(along,c,2,cellSize,0x544f43);rect(along,c+1,1,cellSize-2,0x7b7059);
    }
    if(line.stage>=3){const length=(end-start)*(line.stage===3?.5:1);
      for(const d of [1,cellSize-2]){rect(start,c+d,length,2,0x3b4c48);rect(start,c+d,length,1,0x89968f);}
    }
  }
  const platform=(horizontal?line.platform.x:line.platform.y)*cellSize;
  if(line.stage>=3){
    for(const [begin,direction] of [[platform+3.125*cellSize,1],[platform-18.75*cellSize,-1]]){
      for(let distance=0;distance<8*cellSize;distance++){
        const along=Math.round(begin!+direction!*distance),offset=Math.round(distance/8);
        rect(along,cross+1-offset,1,1,0x89968f);rect(along,cross+cellSize-2-offset,1,1,0x89968f);
      }
    }
  }
  const span=cityRailwayPlatformSpan(line),platformStart=span.start*cellSize,platformEnd=span.end*cellSize;
  rect(platformStart,cross-3*cellSize+1,platformEnd-platformStart,2*cellSize-1,line.stage<4?0x756750:0x777f7b);
  rect(platformStart,cross+cellSize+1,platformEnd-platformStart,2*cellSize-1,line.stage<4?0x756750:0x777f7b);
  for (let along=platformStart; along<platformEnd; along+=4) {
    rect(along,cross+cellSize+2,1,cellSize-3,0x626c68);
    rect(along+1,cross+cellSize+3,2,1,0x8a9186);
  }
  if(line.stage>=4) {
    rect(platformStart,cross+cellSize+1,platformEnd-platformStart,1,0xa89b6f);
    rect(platformStart,cross-cellSize-1,platformEnd-platformStart,1,0xa89b6f);
    // Low slate shelter, steel supports and wooden benches at native pixels.
    const shelter = platform - 8 * cellSize;
    // Furniture sits in the reserved outer alcove, clear of both walking
    // lanes and the wagon doors. People use the visible platform in front.
    rect(shelter, cross+3*cellSize, 4*cellSize, cellSize, 0x777f7b);
    rect(shelter, cross+3*cellSize+3, 4*cellSize, cellSize-3, 0x394944);
    rect(shelter, cross+3*cellSize+2, 4*cellSize, 3, 0x556966);
    for(let offset=1;offset<4*cellSize;offset+=4) rect(shelter+offset,cross+3*cellSize+2,1,2,0x78847a);
    for(const d of [-10,-3,1]) {
      rect(platform+d*cellSize,cross+3*cellSize,cellSize,cellSize,0x777f7b);
      rect(platform+d*cellSize,cross+3*cellSize+4,cellSize,2,0x594e3f);
      rect(platform+d*cellSize,cross+3*cellSize+4,cellSize,1,0x9c8761);
    }
  }
}

/** The deck belongs above train bodies; its pedestrians use the next layer. */
export function drawCityRailwayBridge(view:Graphics,line:CityRailway|undefined,cellSize:number):void {
 view.clear();if(!line||line.stage<4)return;
 const horizontal=line.axis==='horizontal',cross=(horizontal?line.from.y:line.from.x)*cellSize;
 const rect=(along:number,across:number,length:number,width:number,color:number)=>{
  if(horizontal)view.rect(along,across,length,width).fill(color);else view.rect(across,along,width,length).fill(color);
 };
    const bridge=(horizontal?line.platform.x:line.platform.y)*cellSize+3*cellSize;
    rect(bridge-2,cross-2*cellSize,4,5*cellSize,0x61756e);
    rect(bridge-2,cross-2*cellSize,1,5*cellSize,0xb6ad89);
    rect(bridge+1,cross-2*cellSize,1,5*cellSize,0x394f49);
}
