import { atlasAircraftEndpointScale, buildAtlasFlightGeometry, sampleAtlasFlight, type AtlasFlightGeometry } from "../shared/atlas-scene";
import type { Cell } from "../shared/contracts";
import type { CityAirportConnectionDto } from "../shared/city-scene-contract";
import type { MicroDirection } from "../shared/micro-ambient";

export type CityMicroFlightRoute = { id: string; fromTaskId: string; toTaskId: string; curve: AtlasFlightGeometry; length: number };

/** Cancel, never teleport/retarget, when canonical endpoint geometry changes.
 * IDs alone survive world regeneration. Compare numeric geometry rather than
 * the rounded SVG path; identical refreshed scenes preserve elapsed flight. */
export function cityMicroFlightIsCurrent(active: CityMicroFlightRoute, routes: readonly CityMicroFlightRoute[]): boolean {
  return routes.some(route => route.id === active.id && route.fromTaskId === active.fromTaskId && route.toTaskId === active.toTaskId
    && route.length === active.length && (["from", "control", "to"] as const)
      .every(point => route.curve[point].x === active.curve[point].x && route.curve[point].y === active.curve[point].y));
}

/** Canonical cross-city endpoints share the smooth route geometry used by both atlas levels. */
export function cityMicroFlightRoutes(connections: readonly CityAirportConnectionDto[]): CityMicroFlightRoute[] {
  return [...new Map(connections.map(connection => [connection.id, connection])).values()]
    .sort((a, b) => a.id.localeCompare(b.id)).flatMap(connection => {
      const start = connection.from.point, end = connection.to.point;
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      return length > 0 ? [{
        id: connection.id, fromTaskId: connection.from.taskId, toTaskId: connection.to.taskId,
        curve: buildAtlasFlightGeometry(start, end, connection.id, 24), length,
      }] : [];
    });
}

/** Bound travel duration so distant airports still produce visible departures/arrivals. */
export function cityMicroFlightDuration(route: CityMicroFlightRoute): number {
  return Math.min(30_000, Math.max(8_000, route.length * 120));
}

/** Continuous position; nearest authored compass heading follows the curve tangent. */
export function cityMicroFlightPosition(route: CityMicroFlightRoute, progress: number): Cell & { direction: MicroDirection; scale: number } {
  const sample = sampleAtlasFlight(route.curve, progress);
  const dx = Math.cos(sample.angle), dy = Math.sin(sample.angle);
  const direction: MicroDirection = Math.abs(dx) >= Math.abs(dy) ? dx < 0 ? "west" : "east" : dy < 0 ? "north" : "south";
  return { x: sample.x, y: sample.y, direction, scale: atlasAircraftEndpointScale(progress) };
}
