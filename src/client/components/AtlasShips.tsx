import { transportSchedule, transportJourney } from "../../shared/transport-schedule";
import { useEffect, useRef } from "react";
import { gameAssetUrl } from "../../shared/catalog";
import { readServerWorldTime } from "../server-world-clock";
import { startVisibleAnimation } from "../visible-animation";
type Route={id:string;path:string;fromPortId:string;toPortId:string;scheduleOffsetMs?:number};
/** A fleet slot retains identity across camera changes. Authored headings use
 * square canvases; passing vessels stay within the validated water corridor. */
export function AtlasShips({ routes, scale }: { routes: Route[]; scale: number }) {
 const host=useRef<SVGGElement>(null);
 useEffect(()=>{
  const views=Array.from(host.current?.children??[]) as SVGGElement[];
  const ships=routes.slice(0,3).flatMap((route,routeIndex)=>{
   const path=document.createElementNS("http://www.w3.org/2000/svg","path");path.setAttribute("d",route.path);
   const schedule=transportSchedule("SEA",route.fromPortId,route.toPortId,route.scheduleOffsetMs),length=path.getTotalLength();
   return Array.from({length:schedule.fleetSize},(_,fleetIndex)=>({route,routeIndex,path,length,schedule,fleetIndex}));
  }).map((plan,index)=>({...plan,view:views[index]!,image:views[index]!.querySelector("image")!}));
  const render=()=>{
   const now=readServerWorldTime()??Date.now(),budget=document.documentElement.dataset.worldQuality==="ECONOMY"?1:3;
   for(const ship of ships){
    const state=transportJourney(ship.schedule,ship.route.fromPortId,now,ship.fleetIndex);
    const visible=ship.routeIndex<budget&&ship.length>0&&state.phase!=="WAITING";
    ship.view.style.visibility=visible?"visible":"hidden";if(!visible)continue;
    const distance=state.progress*ship.length,point=ship.path.getPointAtLength(distance);
    const before=ship.path.getPointAtLength(Math.max(0,distance-.1)),after=ship.path.getPointAtLength(Math.min(ship.length,distance+.1));
    const angle=Math.atan2((after.y-before.y)*state.direction,(after.x-before.x)*state.direction);
    const heading=(["east","south","west","north"] as const)[((Math.round(angle/(Math.PI/2))%4)+4)%4]!;
    const lane=.5*scale*Math.min(1,distance/(3*scale),(ship.length-distance)/(3*scale));
    ship.image.setAttribute("href",gameAssetUrl(`city-transport/ferry-${heading}.png`));
    ship.view.setAttribute("transform",`translate(${point.x-Math.sin(angle)*lane} ${point.y+Math.cos(angle)*lane})`);
    ship.view.dataset.phase=state.phase;ship.view.dataset.progress=String(state.progress);
    ship.view.dataset.vehicleId=state.vehicleId;ship.view.dataset.journeyId=state.journeyId;
   }
  };
  render();return startVisibleAnimation(render);
 },[routes,scale]);
 return <g ref={host} className="planet-ships" aria-hidden="true">{routes.slice(0,3).flatMap(route=>
  Array.from({length:transportSchedule("SEA",route.fromPortId,route.toPortId).fleetSize},(_,index)=><g key={`${route.id}:${index}`} data-route-id={route.id}>
   <image x={-1.5*scale} y={-1.5*scale} width={3*scale} height={3*scale} className="atlas-pixel" />
  </g>))}</g>;
}
