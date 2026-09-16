import { transportSchedule, transportProgress } from "../../shared/transport-schedule";
import { useEffect, useRef } from "react";
import { PROP_SPRITES } from "../../shared/catalog";
import { readServerWorldTime } from "../server-world-clock";
import { startVisibleAnimation } from "../visible-animation";

/** Own the motion explicitly: native animateMotion can retain its initial pose
 * when this asynchronously loaded atlas replaces its SVG contents. Camera
 * changes rebuild only geometry; the absolute voyage phase stays unchanged. */
export function AtlasShips({ routes, scale }: { routes: Array<{ id: string; path: string; fromPortId: string; toPortId: string }>; scale: number }) {
  const host = useRef<SVGGElement>(null);
  const lastTime = useRef<number | null>(null);
  useEffect(() => {
    const views = [...host.current!.children] as SVGGElement[];
    const ships = routes.slice(0, 3).map((route, index) => {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", route.path);
      return { view: views[index]!, path, length: path.getTotalLength(), index, route, schedule: transportSchedule("SEA", route.fromPortId, route.toPortId) };
    });
    const render = () => {
      if (lastTime.current === null || !document.hidden && !matchMedia("(prefers-reduced-motion: reduce)").matches)
        lastTime.current = readServerWorldTime() ?? Date.now();
      const now = lastTime.current;
      const budget = document.documentElement.dataset.worldQuality === "ECONOMY" ? 1 : 3;
      for (const ship of ships) {
        const state = transportProgress(ship.schedule, ship.route.fromPortId, now);
        ship.view.style.visibility = ship.index < budget && ship.length > 0 && state.phase !== "WAITING" ? "visible" : "hidden";
        ship.view.dataset.phase = state.phase;
        if (ship.index >= budget || ship.length <= 0) continue;
        const distance = state.progress * ship.length;
        ship.view.dataset.progress = String(distance / ship.length);
        const point = ship.path.getPointAtLength(distance);
        const before = ship.path.getPointAtLength(Math.max(0, distance - .1));
        const after = ship.path.getPointAtLength(Math.min(ship.length, distance + .1));
        const angle = Math.atan2((after.y - before.y) * state.direction, (after.x - before.x) * state.direction) * 180 / Math.PI;
        ship.view.setAttribute("transform", `translate(${point.x} ${point.y}) rotate(${angle})`);
      }
    };
    render();
    return startVisibleAnimation(render);
  }, [routes, scale]);
  return <g ref={host} className="planet-ships" aria-hidden="true">{routes.slice(0, 3).map(route => <g key={route.id} data-route-id={route.id}>
    <image href={PROP_SPRITES["boat-horizontal-b"]} x={-18 * scale} y={-6 * scale} width={36 * scale} height={12 * scale} className="atlas-pixel" />
  </g>)}</g>;
}
