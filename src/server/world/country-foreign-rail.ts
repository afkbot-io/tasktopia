import type {Cell} from "../../shared/contracts";
import type {CountryGeography} from "./country-geography";
import {atlasGridPath} from "../../shared/atlas-grid-transport";

/** Clip the canonical land route to the contiguous part attached to the local
 * stop. Never connect across an absent/wet macro cell or restart the trip here. */
export function projectForeignRail(points:readonly Cell[],macro:readonly {id:string;q:number;r:number}[],geography:CountryGeography,radius:number,localFrom:boolean):{points:Cell[];progressRange:[number,number]}|null {
  return projectForeignSurface(points,macro,geography,radius,localFrom,"land");
}

/** A marine segment uses only known water with a full three-cell hull corridor. */
export function projectForeignSea(points:readonly Cell[],macro:readonly {id:string;q:number;r:number}[],geography:CountryGeography,radius:number,localFrom:boolean) {
  return projectForeignSurface(points,macro,geography,radius,localFrom,"sea");
}

function projectForeignSurface(points:readonly Cell[],macro:readonly {id:string;q:number;r:number}[],geography:CountryGeography,radius:number,localFrom:boolean,surface:"land"|"sea"):{points:Cell[];progressRange:[number,number]}|null {
  if(points.length<2)return null;
  const byPosition=new Map(macro.map(cell=>[`${cell.q},${cell.r}`,cell.id]));
  const terrain=geography.cells.filter(cell=>surface==="land"?cell.land:cell.terrain==="deep_water"||cell.terrain==="shallow_water");
  const terrainKeys=new Set(terrain.map(cell=>`${cell.column},${cell.row}`));
  const dry=surface==="land"?terrain:terrain.filter(cell=>[-1,0,1].every(dx=>[-1,0,1].every(dy=>terrainKeys.has(`${cell.column+dx},${cell.row+dy}`))));
  const allowed=new Set(dry.map(cell=>`${cell.column},${cell.row}`));
  const byMacro=new Map<string,typeof dry>();
  for(const cell of dry){if(!cell.macroCellId)continue;const group=byMacro.get(cell.macroCellId)??[];group.push(cell);byMacro.set(cell.macroCellId,group);}
  const distances=[0];for(let i=1;i<points.length;i++)distances.push(distances[i-1]!+Math.hypot(points[i]!.x-points[i-1]!.x,points[i]!.y-points[i-1]!.y));
  const total=distances.at(-1)!;if(!total)return null;
  const mapped=points.map(point=>{
    const q=Math.floor(point.x/(radius*2)),r=Math.floor(point.y/(radius*2));
    const id=byPosition.get(`${q},${r}`),cells=id&&byMacro.get(id);if(!cells||!cells.length)return null;
    const minX=Math.min(...cells.map(c=>c.x)),minY=Math.min(...cells.map(c=>c.y));
    const size=geography.grid.cellSize;
    const target={x:minX+(point.x/(radius*2)-q)*(Math.max(...cells.map(c=>c.x))+size-minX),y:minY+(point.y/(radius*2)-r)*(Math.max(...cells.map(c=>c.y))+size-minY)};
    return [...cells].sort((a,b)=>(a.x+size/2-target.x)**2+(a.y+size/2-target.y)**2-((b.x+size/2-target.x)**2+(b.y+size/2-target.y)**2))[0]!;
  });
  const order=Array.from({length:points.length},(_,i)=>localFrom?i:points.length-1-i);
  const result:Cell[]=[];const indices:number[]=[];let previous:Cell|undefined;
  for(const i of order){
    const cell=mapped[i];if(!cell)break;
    const current={x:cell.column,y:cell.row};
    const path=previous?atlasGridPath(previous,new Set([`${current.x},${current.y}`]),allowed):[current];
    if(!path.length)break;
    for(const p of path){const value={x:(p.x+.5)*geography.grid.cellSize,y:(p.y+.5)*geography.grid.cellSize};
      if(!result.length||result.at(-1)!.x!==value.x||result.at(-1)!.y!==value.y)result.push(value);
    }
    indices.push(i);previous=current;
  }
  if(result.length<2)return null;
  if(!localFrom)result.reverse();
  return {points:result,progressRange:[distances[Math.min(...indices)]!/total,distances[Math.max(...indices)]!/total]};
}
