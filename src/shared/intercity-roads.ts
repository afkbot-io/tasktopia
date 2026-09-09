import type { Rect } from "./contracts";
import type { OrthogonalRoadGeometry, SemanticRoadNetwork } from "./semantic-road";

/** Canonical world coordinates; COUNTRY only derives a cartographic projection. */
export type IntercityRoadRoute = {
  id: string; fromCityId: string; toCityId: string; fromNodeId: string; toNodeId: string;
  widthCells: 3; geometry: OrthogonalRoadGeometry;
  bridges?: OrthogonalRoadGeometry[];
};

/** O(compressed runs), never an unbounded per-cell allocation. */
export function intercityRoadCorridors(routes: readonly IntercityRoadRoute[], clearance = 1): Rect[] {
  if (!Number.isSafeInteger(clearance) || clearance < 0 || clearance > 8) throw new Error("Invalid road clearance");
  return routes.flatMap(route => {
    let { x, y } = route.geometry.start;
    const radius = Math.floor(route.widthCells / 2) + clearance;
    return route.geometry.runs.map(run => {
      const toX = x + (run.direction === "E" ? run.length : run.direction === "W" ? -run.length : 0);
      const toY = y + (run.direction === "S" ? run.length : run.direction === "N" ? -run.length : 0);
      const bounds = { minX: Math.min(x, toX) - radius, maxX: Math.max(x, toX) + radius,
        minY: Math.min(y, toY) - radius, maxY: Math.max(y, toY) + radius };
      x = toX; y = toY;
      return bounds;
    });
  });
}

/** Retain whole canonical routes that can already be visible in resident CITY
 * chunks, not just routes with a local endpoint. Work is O(compressed runs),
 * independent of road length; unrelated distant roads remain outside the DTO. */
export function citySceneIntercityRoads(routes: readonly IntercityRoadRoute[], cityId: string,
  residentBounds: Rect): IntercityRoadRoute[] {
  return routes.filter(route => {
    if (route.fromCityId === cityId || route.toCityId === cityId) return true;
    let { x, y } = route.geometry.start;
    const radius = Math.floor(route.widthCells / 2);
    for (const run of route.geometry.runs) {
      const toX = x + (run.direction === "E" ? run.length : run.direction === "W" ? -run.length : 0);
      const toY = y + (run.direction === "S" ? run.length : run.direction === "N" ? -run.length : 0);
      if (Math.min(x, toX) - radius <= residentBounds.maxX && Math.max(x, toX) + radius >= residentBounds.minX
        && Math.min(y, toY) - radius <= residentBounds.maxY && Math.max(y, toY) + radius >= residentBounds.minY) return true;
      x = toX; y = toY;
    }
    return false;
  });
}

/** Raster input only. Junction topology is derived from the union of all road
 * cells by the existing mobility graph, not from these unsplit long segments. */
export function intercityRoadRasterNetwork(routes: readonly IntercityRoadRoute[]): SemanticRoadNetwork {
  return { schemaVersion: 1, nodes: [], segments: routes.flatMap(route => [{
    id: route.id, fromNodeId: route.fromNodeId, toNodeId: route.toNodeId,
    roadClass: "LOCAL", widthCells: route.widthCells, geometry: route.geometry,
  }, ...(route.bridges ?? []).map((geometry, index) => ({
    id: `${route.id}:bridge:${index}`, fromNodeId: route.fromNodeId, toNodeId: route.toNodeId,
    roadClass: "LOCAL" as const, widthCells: route.widthCells, geometry, structure: "BRIDGE" as const,
  }))]) };
}
