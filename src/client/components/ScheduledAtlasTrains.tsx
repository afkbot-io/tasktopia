import { useEffect,useRef } from "react";
import type { Cell } from "../../shared/contracts";
import { gameAssetUrl } from "../../shared/catalog";
import { railPolyline,railConvoy } from "../../shared/rail-convoy";
import { transportSchedule } from "../../shared/transport-schedule";
import { startVisibleAnimation } from "../visible-animation";
import { readServerWorldTime } from "../server-world-clock";
type Route={id:string;fromStationId:string;toStationId:string;points:Cell[];progressRange?:[number,number];scheduleOffsetMs?:number};
export function ScheduledAtlasTrains({routes,scale}:{routes:Route[];scale:number}){
  const host=useRef<SVGGElement>(null);
  useEffect(()=>{
    const views=Array.from(host.current?.querySelectorAll<SVGGElement>(".atlas-train")??[]);
    const plans=routes.slice(0,4).flatMap((route,routeIndex)=>{
      const line=railPolyline(route.points),schedule=transportSchedule("RAIL",route.fromStationId,route.toStationId,route.scheduleOffsetMs);
      return Array.from({length:schedule.fleetSize},(_,fleetIndex)=>({route,routeIndex,line,schedule,fleetIndex,spacing:Math.min(6*scale,line.length/14)}));
    });
    const trains=plans.map((plan,index)=>({...plan,view:views[index]!,cars:Array.from(views[index]!.querySelectorAll("image"))}));
    const render=()=>{
      const now=readServerWorldTime()??Date.now();
      for(const train of trains){
        if(train.routeIndex>=(document.documentElement.dataset.worldQuality==="ECONOMY"?2:4)){train.view.style.visibility="hidden";continue;}
        const state=railConvoy(train.line,train.schedule,train.route.fromStationId,now,train.spacing,train.route.progressRange??[0,1],6,train.fleetIndex,.8*scale);
        train.view.style.visibility=state.visible?"visible":"hidden";
        train.view.dataset.phase=state.phase;train.view.dataset.progress=state.progress.toFixed(4);
        train.view.dataset.vehicleId=state.vehicleId;train.view.dataset.journeyId=state.journeyId;
        const glyphSize=Math.min(4*scale,train.spacing*2/3);
        state.cars.forEach((car,i)=>{
          const part=i===0?"locomotive":"carriage";
          train.cars[i]!.setAttribute("href",gameAssetUrl(`city-transport/${part}-${car.heading}.png`));
          train.cars[i]!.setAttribute("width",String(glyphSize));
          train.cars[i]!.setAttribute("height",String(glyphSize));
          train.cars[i]!.setAttribute("x",String(-glyphSize/2));
          train.cars[i]!.setAttribute("y",String(-glyphSize/2));
          train.cars[i]!.setAttribute("transform",`translate(${car.x} ${car.y})`);
        });
      }
    };
    render();return startVisibleAnimation(render);
  },[routes,scale]);
  return <g ref={host} className="planet-trains" aria-hidden="true">{routes.slice(0,4).flatMap(route=>
    Array.from({length:transportSchedule("RAIL",route.fromStationId,route.toStationId).fleetSize},(_,index)=><g key={`${route.id}:${index}`} className="atlas-train" data-route-id={route.id} style={{visibility:"hidden"}}>
      {[0,1,2,3,4,5].map(part=><image key={part} className="atlas-pixel" />)}
    </g>))}</g>;
}
