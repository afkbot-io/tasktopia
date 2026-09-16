import type {Cell,Rect} from "./contracts";
const key=(p:Cell)=>`${p.x},${p.y}`;
/** Only a complete atlas rectangle may establish open ocean. A viewport edge
 * or a streamed CITY chunk edge is not proof of an outlet. Missing cells are
 * barriers; diagonal contact cannot make a lake navigable. Bounds are inclusive. */
export function openOceanCells(cells:readonly Cell[],bounds:Rect):Cell[]{
  if(!Object.values(bounds).every(Number.isInteger)||bounds.minX>bounds.maxX||bounds.minY>bounds.maxY)throw new Error("Invalid ocean bounds");
  const water=new Map(cells.filter(p=>Number.isInteger(p.x)&&Number.isInteger(p.y)&&p.x>=bounds.minX&&p.x<=bounds.maxX&&p.y>=bounds.minY&&p.y<=bounds.maxY).map(p=>[key(p),p]));
  const queue=[...water.values()].filter(p=>p.x===bounds.minX||p.x===bounds.maxX||p.y===bounds.minY||p.y===bounds.maxY);
  const visited=new Set(queue.map(key));
  for(let i=0;i<queue.length;i++){
    const p=queue[i]!;
    for(const [dx,dy] of [[1,0],[0,1],[-1,0],[0,-1]] as const){
      const id=`${p.x+dx},${p.y+dy}`,next=water.get(id);
      if(next&&!visited.has(id)){visited.add(id);queue.push(next);}
    }
  }
  return [...water.values()].filter(p=>visited.has(key(p))).sort((a,b)=>a.y-b.y||a.x-b.x).map(p=>({...p}));
}
