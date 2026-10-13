import type { Cell, ChunkTaskDto } from '../shared/contracts';
const key=(cell:Cell)=>`${cell.x},${cell.y}`;
/** Short, disjoint approaches on the existing pedestrian network. No fallback
 * crosses a road, occupied pixel parcel or unloaded terrain. */
export function planCinematicCrew(task:Pick<ChunkTaskDto,'footprint'|'accessPath'|'siteBounds'>,graph:ReadonlyMap<string,Cell>,roads:ReadonlySet<string>,occupied:ReadonlySet<string>=new Set(),limit=6):Cell[][] {
 if(!task.footprint.length)return [];
 const minX=Math.min(...task.footprint.map(c=>c.x)),maxX=Math.max(...task.footprint.map(c=>c.x));
 const minY=Math.min(...task.footprint.map(c=>c.y)),maxY=Math.max(...task.footprint.map(c=>c.y));
 const distance=(c:Cell)=>Math.max(minX-c.x,0,c.x-maxX)+Math.max(minY-c.y,0,c.y-maxY);
 const blocked=new Set([...occupied,...roads,...task.footprint.map(key)]);
 const approach=task.accessPath[0]??{x:minX,y:maxY+2};
 const safe=(c:Cell)=>graph.has(key(c))&&!blocked.has(key(c))&&distance(c)<=4;
 const slots=[...graph.values()].filter(c=>safe(c)&&distance(c)>0&&distance(c)<=2)
  .sort((a,b)=>(Math.abs(a.x-approach.x)+Math.abs(a.y-approach.y))-(Math.abs(b.x-approach.x)+Math.abs(b.y-approach.y))||a.y-b.y||a.x-b.x);
 const result:Cell[][]=[];
 for(const slot of slots){
  if(result.length>=Math.max(0,Math.min(6,limit)))break;
  if(!safe(slot))continue;
  const route=[slot];
  for(let i=0;i<2;i++){
   const last=route.at(-1)!;
   const next=[{x:last.x,y:last.y+1},{x:last.x+1,y:last.y},{x:last.x,y:last.y-1},{x:last.x-1,y:last.y}]
    .filter(c=>safe(c)&&!route.some(p=>key(p)===key(c))&&distance(c)>=distance(last))
    .sort((a,b)=>distance(b)-distance(a)||a.y-b.y||a.x-b.x)[0];
   if(!next)break;route.push(next);
  }
  if(route.length<2)continue;
  result.push(route.reverse());for(const cell of route)blocked.add(key(cell));
 }
 return result;
}
