import type { Cell, ChunkTaskDto } from '../shared/contracts';
const key=(cell:Cell)=>`${cell.x},${cell.y}`;
/** Short, disjoint approaches on the existing pedestrian network. No fallback
 * crosses a road, occupied pixel parcel or unloaded terrain. */
export type CrewWalkIndex=Pick<ReadonlyMap<string,Cell>,'has'|'get'>;
export type CrewMembership=Pick<ReadonlySet<string>,'has'>;
export function planCinematicCrew(task:Pick<ChunkTaskDto,'footprint'|'accessPath'|'siteBounds'>,graph:CrewWalkIndex,roads:CrewMembership,occupied:ReadonlySet<string>=new Set(),limit=6):Cell[][] {
 if(!task.footprint.length||task.footprint.length>4096)return [];
 if(task.footprint.some(c=>!Number.isSafeInteger(c.x)||!Number.isSafeInteger(c.y)))return [];
 const minX=Math.min(...task.footprint.map(c=>c.x)),maxX=Math.max(...task.footprint.map(c=>c.x));
 const minY=Math.min(...task.footprint.map(c=>c.y)),maxY=Math.max(...task.footprint.map(c=>c.y));
 // Authored parcels are small. Invalid/extreme extents must not turn a local
 // reaction into an unbounded scan, including at the safe-integer boundary.
 if(maxX-minX>=64||maxY-minY>=64||![minX-4,minY-4,maxX+4,maxY+4].every(Number.isSafeInteger))return [];
 const distance=(c:Cell)=>Math.max(minX-c.x,0,c.x-maxX)+Math.max(minY-c.y,0,c.y-maxY);
 const blocked=new Set([...occupied,...task.footprint.map(key)]);
 const approach=task.accessPath[0]??{x:minX,y:maxY+2};
 const safe=(c:Cell)=>graph.has(key(c))&&!blocked.has(key(c))&&!roads.has(key(c))&&distance(c)<=4;
 const slots:Cell[]=[];
 for(let y=minY-2;y<=maxY+2;y++)for(let x=minX-2;x<=maxX+2;x++){
  const point={x,y};if(distance(point)<=0||distance(point)>2)continue;
  const cell=graph.get(key(point));if(cell&&cell.x===x&&cell.y===y&&safe(cell))slots.push(cell);
 }
 slots.sort((a,b)=>(Math.abs(a.x-approach.x)+Math.abs(a.y-approach.y))-(Math.abs(b.x-approach.x)+Math.abs(b.y-approach.y))||a.y-b.y||a.x-b.x);
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
