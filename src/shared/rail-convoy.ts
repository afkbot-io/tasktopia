import type { Cell } from "./contracts";
import { transportProgress, type TransportSchedule } from "./transport-schedule";
export type RailPolyline={points:Cell[];distances:number[];length:number};
export function railPolyline(source:readonly Cell[]):RailPolyline{
  const points=source.filter((p,i)=>i===0||p.x!==source[i-1]!.x||p.y!==source[i-1]!.y).map(p=>({...p}));
  const distances=[0];
  for(let i=1;i<points.length;i++)distances.push(distances[i-1]!+Math.hypot(points[i]!.x-points[i-1]!.x,points[i]!.y-points[i-1]!.y));
  return {points,distances,length:distances.at(-1)??0};
}
export function sampleTransportPolyline(line:RailPolyline,distance:number,direction:1|-1){
  let lo=0,hi=line.points.length-1;
  while(lo+1<hi){const mid=(lo+hi)>>1;if(line.distances[mid]!<=distance)lo=mid;else hi=mid;}
  const a=line.points[lo]!,b=line.points[hi]!,span=line.distances[hi]!-line.distances[lo]!;
  const fraction=span?Math.max(0,Math.min(1,(distance-line.distances[lo]!)/span)):0;
  const dx=(b.x-a.x)*direction,dy=(b.y-a.y)*direction;
  return {x:a.x+(b.x-a.x)*fraction,y:a.y+(b.y-a.y)*fraction,
    angle:Math.atan2(dy,dx),
    heading:Math.abs(dx)>=Math.abs(dy)?dx<0?"west" as const:"east" as const:dy<0?"north" as const:"south" as const};
}
/** A four-part consist stays inside the route at both terminal stops. Cubic
 * easing has zero velocity at arrival/departure; spacing is arc length, so
 * carriages follow corners instead of cutting across water or parcels. */
export function railConvoy(line:RailPolyline,schedule:TransportSchedule,sourceId:string,time:number,spacing:number,progressRange:readonly [number,number]=[0,1]){
  const state=transportProgress(schedule,sourceId,time);
  if(line.points.length<2||line.length<=0)return {...state,visible:false,cars:[]};
  const gap=Math.min(spacing,line.length/4),body=gap*3;
  const eased=state.progress*state.progress*(3-2*state.progress);
  const [start,end]=progressRange;
  const fraction=(eased-start)/(end-start);
  if(end<=start||fraction<0||fraction>1)return {...state,visible:false,cars:[]};
  const center=body/2+(line.length-body)*fraction;
  // Push-pull service: the locomotive keeps its physical end of the consist
  // when reversing. Switching travel direction must not teleport carriages.
  const bodyDirection=sourceId===schedule.fromId?1:-1;
  const lead=center+bodyDirection*body/2;
  return {...state,visible:state.phase!=="WAITING",cars:Array.from({length:4},(_,index)=>sampleTransportPolyline(line,lead-index*gap*bodyDirection,state.direction))};
}
