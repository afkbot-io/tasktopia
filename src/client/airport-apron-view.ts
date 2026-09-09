import type { Graphics } from "pixi.js";
import type { ChunkTaskDto } from "../shared/contracts";
import { transportBuildingArt } from "../shared/transport-building-art";

export function drawAirportApron(view:Graphics,task:ChunkTaskDto,cell:number):void {
  if(task.serviceRole!=="AIRPORT" || task.stage<3 || !task.footprint.length) return;
  const art=transportBuildingArt(task);
  if(art.key!=="compact-airport-v1") return;
  const minX=Math.min(...task.footprint.map(p=>p.x)),minY=Math.min(...task.footprint.map(p=>p.y));
  const maxX=Math.max(...task.footprint.map(p=>p.x));
  const occupied = new Set(task.footprint.map(p => `${p.x}:${p.y}`));
  const stripFits = Array.from({length: maxX - minX + 1}, (_, offset) => minX + offset)
    .every(x => occupied.has(`${x}:${minY}`) && occupied.has(`${x}:${minY + 1}`));
  for(const p of task.footprint) view.rect(p.x*cell,p.y*cell,cell,cell).fill(task.stage===3?0xa18f6d:0x697975);
  // A larger service lot has room for a small airfield strip behind the native
  // terminal. Never draw outside its reserved footprint or stretch the building.
  if(stripFits && art.origin.y-minY>=2 && task.stage>=4) {
    const left=minX*cell+2,top=minY*cell+2,width=(maxX-minX+1)*cell-4;
    view.rect(left,top,width,cell+4).fill(0x3e555a);
    if(task.stage===5) {
      view.rect(left,top,width,1).rect(left,top+cell+3,width,1).fill(0xabb8a2);
      for(let x=left+8;x<left+width-5;x+=12) view.rect(x,top+Math.floor(cell/2)+2,5,1).fill(0xd7cead);
      for(const x of [left+2,left+width-4]) for(let y=top+2;y<top+cell+2;y+=3) view.rect(x,y,2,2).fill(0xd7cead);
    }
  }
}
