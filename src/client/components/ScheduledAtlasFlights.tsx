import { useEffect, useRef } from "react";
import type { PlanetRoute } from "../../shared/planet-atlas";
import { atlasAircraftEndpointScale } from "../../shared/atlas-scene";
import { microAmbientSprite } from "../../shared/micro-ambient";
import { transportProgress, transportSchedule } from "../../shared/transport-schedule";
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
    const flights = views.flatMap((view, index) => {
      const route = routes[index], image = view.querySelector("image");
      if (!route?.fromAirportId || !image) return [];
      return [{ view, route, image, line: atlasFlightPolyline(route.from, route.control, route.to), schedule:transportSchedule("AIR",route.fromAirportId,route.toAirportId) }];
    });
    return startVisibleAnimation(() => {
      const now = readServerWorldTime() ?? Date.now();
      for (const { view, route, image, line, schedule } of flights) {
        const state = transportProgress(schedule,route.fromAirportId!,now);
        view.style.visibility = state.phase === "MOVING" ? "visible" : "hidden";
        view.dataset.routeId = schedule.id;
        view.dataset.progress = state.progress.toFixed(4);
        if (state.phase !== "MOVING") continue;
        const point = sampleTransportPolyline(line, state.progress * line.length, state.direction);
        const angle = point.angle;
        const heading = (["east","south","west","north"] as const)[((Math.round(angle/(Math.PI/2))%4)+4)%4]!;
        image.setAttribute("href",microAmbientSprite("aircraft","regional",heading).url);
        const scale = route.altitudeScale * atlasAircraftEndpointScale(state.progress);
        image.setAttribute("transform",`translate(${point.x} ${point.y}) scale(${scale})`);
      }
    });
  }, [routes]);
  return <g ref={host} className="planet-routes" aria-hidden="true">{routes.map(route =>
    <g key={route.id} className="atlas-aircraft-flight" style={{visibility:"hidden"}}>
      <path d={route.path} fill="none" stroke="none" />
      <image className="atlas-aircraft-sprite atlas-pixel" x={-4} y={-4} width={8} height={8} />
    </g>)}</g>;
}
