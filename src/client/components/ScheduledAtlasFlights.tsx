import { airFlightState } from "../../shared/air-flight-state";
import { useEffect, useRef } from "react";
import type { PlanetRoute } from "../../shared/planet-atlas";
import { atlasAircraftEndpointScale } from "../../shared/atlas-scene";
import { microAmbientSprite } from "../../shared/micro-ambient";
import { transportSchedule } from "../../shared/transport-schedule";
import { readServerWorldTime } from "../server-world-clock";
import { startVisibleAnimation } from "../visible-animation";
import { atlasFlightPolyline } from "../../shared/atlas-flight-path";
import { sampleTransportPolyline } from "../../shared/rail-convoy";

/** A single owned loop for the bounded visible fleet; camera projections only
 * change the path, never the identity or departure time of a flight. */
export function ScheduledAtlasFlights({ routes }: { routes: PlanetRoute[] }) {
  const host = useRef<SVGGElement>(null);
  useEffect(() => {
    const views = Array.from(host.current?.querySelectorAll<SVGGElement>(".atlas-aircraft-flight") ?? []);
    const plans=routes.flatMap(route=>route.fromAirportId?Array.from({length:transportSchedule("AIR",route.fromAirportId,route.toAirportId).fleetSize},(_,fleetIndex)=>({route,fleetIndex})):[]);
    const flights=plans.map(({route,fleetIndex},index)=>{
      const view=views[index]!,image=view.querySelector("image")!;
      return {view,route,image,fleetIndex,line:atlasFlightPolyline(route.from,route.control,route.to),schedule:transportSchedule("AIR",route.fromAirportId!,route.toAirportId,route.scheduleOffsetMs)};
    });
    const render=() => {
      const now = readServerWorldTime() ?? Date.now();
      for (const { view, route, image, line, schedule,fleetIndex } of flights) {
        const state = airFlightState(schedule,route.fromAirportId!,now,fleetIndex);
        view.style.visibility = state.visible ? "visible" : "hidden";
        view.dataset.routeId = schedule.id;
        view.dataset.progress = state.progress.toFixed(4);
        view.dataset.vehicleId=state.vehicleId;view.dataset.journeyId=state.journeyId;
        if (!state.visible) continue;
        const point = sampleTransportPolyline(line, state.flightProgress * line.length, state.direction);
        const angle = point.angle;
        const heading = (["east","south","west","north"] as const)[((Math.round(angle/(Math.PI/2))%4)+4)%4]!;
        image.setAttribute("href",microAmbientSprite("aircraft","regional",heading).url);
        const scale = route.altitudeScale * atlasAircraftEndpointScale(state.flightProgress);
        image.setAttribute("transform",`translate(${point.x} ${point.y}) scale(${scale})`);
      }
    };
    render();return startVisibleAnimation(render);
  }, [routes]);
  return <g ref={host} className="planet-routes" aria-hidden="true">{routes.flatMap(route=>route.fromAirportId?
    Array.from({length:transportSchedule("AIR",route.fromAirportId,route.toAirportId).fleetSize},(_,index)=><g key={`${route.id}:${index}`} className="atlas-aircraft-flight" style={{visibility:"hidden"}}>
      <path d={route.path} fill="none" stroke="none" />
      <image className="atlas-aircraft-sprite atlas-pixel" x={-4} y={-4} width={8} height={8} />
    </g>):[])}</g>;
}
