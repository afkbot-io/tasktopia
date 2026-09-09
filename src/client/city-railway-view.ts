import { Graphics } from "pixi.js";
import type { CityRailway } from "./city-railway";

/** Native pixel geometry: no stroked subpixel rails or arbitrary sprite rotation. */
export function drawCityRailway(view: Graphics, line: CityRailway, cellSize: number): void {
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
  for(const p of line.access) view.rect(p.x*cellSize+2,p.y*cellSize+2,cellSize-4,cellSize-4).fill(line.stage<3?0x756750:0x777f7b);
  rect(start,cross-2,end-start,cellSize+4,line.stage<3?0x756750:0x59635f);
  // Deterministic gravel clusters, matching the broken stone of city sidewalks.
  for (let along=start; along<end; along+=3) {
    const seed = Math.imul(Math.floor(along), 1103515245) >>> 0;
    rect(along, cross - 2 + seed % (cellSize+3), 1 + seed % 2, 1,
      [0x424e4b, 0x758078, 0x636b62][seed % 3]!);
  }
  for(let along=start;along<end;along+=6) {
    if(line.stage===1) { rect(along,cross,1,cellSize,0x9c906b); continue; }
    rect(along,cross,2,cellSize,0x544f43);
    rect(along,cross+1,1,cellSize-2,0x7b7059);
  }
  if(line.stage>=3) {
    const length=(end-start)*(line.stage===3?.5:1);
    for(const d of [1,cellSize-2]) {
      rect(start,cross+d,length,2,0x3b4c48);
      rect(start,cross+d,length,1,0x89968f);
    }
  }
  const platform=(horizontal?line.platform.x:line.platform.y)*cellSize;
  rect(platform-11*cellSize,cross+cellSize+1,14*cellSize,cellSize-1,line.stage<4?0x756750:0x777f7b);
  for (let along=platform-11*cellSize; along<platform+3*cellSize; along+=4) {
    rect(along,cross+cellSize+2,1,cellSize-3,0x626c68);
    rect(along+1,cross+cellSize+3,2,1,0x8a9186);
  }
  if(line.stage>=4) {
    rect(platform-11*cellSize,cross+cellSize+1,14*cellSize,1,0xa89b6f);
    // Low slate shelter, steel supports and wooden benches at native pixels.
    const shelter = platform - 8 * cellSize;
    rect(shelter, cross+cellSize+3, 4*cellSize, cellSize-3, 0x394944);
    rect(shelter, cross+cellSize+2, 4*cellSize, 3, 0x556966);
    for(let offset=1;offset<4*cellSize;offset+=4) rect(shelter+offset,cross+cellSize+2,1,2,0x78847a);
    for(const d of [-10,-3,1]) {
      rect(platform+d*cellSize,cross+cellSize+4,cellSize,2,0x594e3f);
      rect(platform+d*cellSize,cross+cellSize+4,cellSize,1,0x9c8761);
    }
  }
}
