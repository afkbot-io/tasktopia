import type { Rect, RoadCellDto } from "./contracts";
import type { SemanticRoadNetwork } from "./semantic-road";

/** Bounded disposable raster; semantic segment data remains canonical. */
export function rasterizeBlockRoads(network: SemanticRoadNetwork, bounds?: Rect): RoadCellDto[] {
  const cells = new Map<string, RoadCellDto>();
  const rank = { LOCAL: 0, COLLECTOR: 1, ARTERIAL: 2, HIGHWAY: 3 };
  for (const segment of network.segments) {
    let { x, y } = segment.geometry.start; const radius = Math.floor(segment.widthCells / 2);
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
      if (cross >= crossMin && cross <= crossMax) for (let step = first; step <= last; step += 1) {
        // Full square node caps prevent inside-corner holes at T/X junctions.
        for (let oy = -radius; oy <= radius; oy += 1) for (let ox = -radius; ox <= radius; ox += 1) {
          const px = x + dx * step + ox; const py = y + dy * step + oy;
          if (bounds && (px < bounds.minX - 1 || px > bounds.maxX + 1 || py < bounds.minY - 1 || py > bounds.maxY + 1)) continue;
          const roadClass = segment.roadClass === "SERVICE" ? "LOCAL" : segment.roadClass;
          const previous = cells.get(`${px}:${py}`);
          if (!previous || rank[roadClass] > rank[previous.roadClass]) cells.set(`${px}:${py}`, { x: px, y: py, mask: 0, structure: "ROAD", roadClass });
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
