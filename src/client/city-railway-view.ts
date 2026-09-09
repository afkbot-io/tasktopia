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
  for(const p of line.access) view.rect(p.x*cellSize+2,p.y*cellSize+2,cellSize-4,cellSize-4).fill(line.stage<3?0xa2916f:0xa7ac98);
  rect(start,cross-2,end-start,cellSize+4,line.stage<3?0xa2916f:0x69766d);
  for(let along=start;along<end;along+=6) {
    if(line.stage===1) { rect(along,cross,1,cellSize,0xc9b77f); continue; }
    rect(along,cross,2,cellSize,0x74634e);
  }
  if(line.stage>=3) {
    const length=(end-start)*(line.stage===3?.5:1);
    for(const d of [1,cellSize-2]) {
      rect(start,cross+d,length,2,0x3b4c48);
      rect(start,cross+d,length,1,0xb6c0b0);
    }
  }
  const platform=(horizontal?line.platform.x:line.platform.y)*cellSize;
  rect(platform-4*cellSize,cross+cellSize+1,8*cellSize,cellSize-1,line.stage<4?0xa2916f:0xa7ac98);
  if(line.stage>=4) {
    rect(platform-4*cellSize,cross+cellSize+1,8*cellSize,1,0xd4bc74);
    for(const d of [-2,1]) rect(platform+d*cellSize,cross+cellSize+4,cellSize,2,0x557c72);
  }
}
