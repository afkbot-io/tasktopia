import type { Rect, RoadCellDto } from "./contracts";
import type { SemanticRoadNetwork } from "./semantic-road";

/** Bounded disposable raster; semantic segment data remains canonical. */
export function rasterizeBlockRoads(network: SemanticRoadNetwork, bounds?: Rect): RoadCellDto[] {
  const cells = new Map<string, RoadCellDto>();
  const rank = { LOCAL: 0, COLLECTOR: 1, ARTERIAL: 2, HIGHWAY: 3 };
  for (const segment of network.segments) {
    let { x, y } = segment.geometry.start; const radius = Math.floor(segment.widthCells / 2);
    const roadClass = segment.roadClass === "SERVICE" ? "LOCAL" : segment.roadClass;
    const bridge = segment.structure === "BRIDGE";
    for (const run of segment.geometry.runs) {
      const dx = run.direction === "E" ? 1 : run.direction === "W" ? -1 : 0;
      const dy = run.direction === "S" ? 1 : run.direction === "N" ? -1 : 0;
      const horizontal = dx !== 0;
      const start = horizontal ? x : y; const delta = horizontal ? dx : dy;
      const min = bounds ? (horizontal ? bounds.minX : bounds.minY) - radius - 1 : -Infinity;
      const max = bounds ? (horizontal ? bounds.maxX : bounds.maxY) + radius + 1 : Infinity;
      const first = Math.max(0, delta > 0 ? min - start : start - max);
      const last = Math.min(run.length, delta > 0 ? max - start : start - min);
      const cross = horizontal ? y : x;
      const crossMin = bounds ? (horizontal ? bounds.minY : bounds.minX) - radius - 1 : -Infinity;
      const crossMax = bounds ? (horizontal ? bounds.maxY : bounds.maxX) + radius + 1 : Infinity;
      if (cross >= crossMin && cross <= crossMax && first <= last) {
        // The union of full square caps along an axial run is one rectangle.
        // Keep its one-cell exterior halo for the final neighbour mask pass.
        const minX = Math.max(Math.min(x + dx * first, x + dx * last) - radius, bounds ? bounds.minX - 1 : -Infinity);
        const maxX = Math.min(Math.max(x + dx * first, x + dx * last) + radius, bounds ? bounds.maxX + 1 : Infinity);
        const minY = Math.max(Math.min(y + dy * first, y + dy * last) - radius, bounds ? bounds.minY - 1 : -Infinity);
        const maxY = Math.min(Math.max(y + dy * first, y + dy * last) + radius, bounds ? bounds.maxY + 1 : Infinity);
        for (let py = minY; py <= maxY; py += 1) for (let px = minX; px <= maxX; px += 1) {
          const previous = cells.get(`${px}:${py}`);
          if (!previous || rank[roadClass] > rank[previous.roadClass] || bridge && previous.structure !== "BRIDGE") {
            cells.set(`${px}:${py}`, {x:px,y:py,mask:0,
              structure:previous?.structure === "BRIDGE" || bridge ? "BRIDGE" : "ROAD",
              roadClass:previous && rank[previous.roadClass] > rank[roadClass] ? previous.roadClass : roadClass});
          }
        }
      }
      x += dx * run.length; y += dy * run.length;
    }
  }
  const result: RoadCellDto[] = [];
  for (const road of cells.values()) {
    if (bounds && (road.x < bounds.minX || road.x > bounds.maxX || road.y < bounds.minY || road.y > bounds.maxY)) continue;
    road.mask = (cells.has(`${road.x}:${road.y - 1}`) ? 1 : 0) | (cells.has(`${road.x + 1}:${road.y}`) ? 2 : 0)
      | (cells.has(`${road.x}:${road.y + 1}`) ? 4 : 0) | (cells.has(`${road.x - 1}:${road.y}`) ? 8 : 0);
    result.push(road);
  }
  return result.sort((a, b) => a.y - b.y || a.x - b.x);
}
