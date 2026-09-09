import { getBuilding } from "./catalog";
import type { Cell } from "./contracts";

type TransportParcel = { buildingType:string; serviceRole?:string|null; origin:Cell; footprint:readonly Cell[] };
/** A historical service assignment may occupy a house-sized lot. Keep the lot
 * immutable while placing the native terminal on its south frontage. */
export function transportBuildingArt(task:TransportParcel) {
  const requested=task.serviceRole==="AIRPORT"?"compact-airport-v1":task.serviceRole==="RAILWAY"?"compact-railway-v1":task.buildingType;
  const entry=getBuilding(requested);
  if(requested===task.buildingType || !task.footprint.length) return {key:task.buildingType,entry:getBuilding(task.buildingType),origin:task.origin};
  let minX=Infinity,maxX=-Infinity,maxY=-Infinity;
  const cells=new Set(task.footprint.map(p=>{minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);return `${p.x}:${p.y}`;}));
  const origin={x:minX+Math.floor((maxX-minX+1-entry.footprint.width)/2),y:maxY+1-entry.footprint.height};
  for(let y=0;y<entry.footprint.height;y++) for(let x=0;x<entry.footprint.width;x++) if(!cells.has(`${origin.x+x}:${origin.y+y}`)) return {key:task.buildingType,entry:getBuilding(task.buildingType),origin:task.origin};
  return {key:requested,entry,origin};
}
