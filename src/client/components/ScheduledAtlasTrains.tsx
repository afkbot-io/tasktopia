import { useEffect,useRef } from "react";
import type { Cell } from "../../shared/contracts";
import { gameAssetUrl } from "../../shared/catalog";
import { railPolyline,railConvoy } from "../../shared/rail-convoy";
import { transportSchedule } from "../../shared/transport-schedule";
import { startVisibleAnimation } from "../visible-animation";
import { readServerWorldTime } from "../server-world-clock";
export function ScheduledAtlasTrains({routes,scale}:{routes:Array<{id:string;fromStationId:string;toStationId:string;points:Cell[]}>;scale:number}){
  const host=useRef<SVGGElement>(null);
  useEffect(()=>{
    const views=Array.from(host.current?.querySelectorAll<SVGGElement>(".atlas-train")??[]);
    const trains=routes.slice(0,4).map((route,i)=>({route,view:views[i]!,cars:Array.from(views[i]!.querySelectorAll("image")),
      line:railPolyline(route.points),schedule:transportSchedule("RAIL",route.fromStationId,route.toStationId)}));
    return startVisibleAnimation(()=>{
      const now=readServerWorldTime()??Date.now();
      for(const [index,train] of trains.entries()){
        if(index>=(document.documentElement.dataset.worldQuality==="ECONOMY"?2:4)){train.view.style.visibility="hidden";continue;}
        const state=railConvoy(train.line,train.schedule,train.route.fromStationId,now,5*scale);
        train.view.style.visibility=state.visible?"visible":"hidden";
        train.view.dataset.phase=state.phase;train.view.dataset.progress=state.progress.toFixed(4);
        state.cars.forEach((car,i)=>{
          const vertical=car.heading==="north"||car.heading==="south";
          const part=i===0?"locomotive":"carriage";
          train.cars[i]!.setAttribute("href",gameAssetUrl(`city-transport/${part}-${vertical?"north":"east"}.png`));
          train.cars[i]!.setAttribute("width",String((vertical?2:4)*scale));
          train.cars[i]!.setAttribute("height",String((vertical?4:2)*scale));
          train.cars[i]!.setAttribute("x",String(-(vertical?1:2)*scale));
          train.cars[i]!.setAttribute("y",String(-(vertical?2:1)*scale));
          train.cars[i]!.setAttribute("transform",`translate(${car.x} ${car.y}) rotate(${car.heading==="west"||car.heading==="south"?180:0})`);
        });
      }
    });
  },[routes,scale]);
  return <g ref={host} className="planet-trains" aria-hidden="true">{routes.slice(0,4).map(route=><g key={route.id} className="atlas-train" data-route-id={route.id} style={{visibility:"hidden"}}>
    {[0,1,2,3].map(index=><image key={index} className="atlas-pixel" />)}
  </g>)}</g>;
}
