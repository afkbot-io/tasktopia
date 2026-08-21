import type { Cell, RoadCellDto } from "./contracts";

export type RoadBandRole =
  | { kind: "JUNCTION" }
  | { kind: "MEDIAN"; axis: "H" | "V" }
  | { kind: "SHOULDER"; axis: "H" | "V" }
  | { kind: "TRAVEL"; axis: "H" | "V"; dx: -1 | 0 | 1; dy: -1 | 0 | 1 };

/** Full-size buses use the separated travel bands of wide road classes only. */
export function roadClassSupportsVehicle(
  roadClass: RoadCellDto["roadClass"],
  kind: "CAR" | "BUS",
): boolean {
  return kind === "CAR" || roadClass !== "LOCAL";
}

function key(cell: Cell): string {
  return `${cell.x},${cell.y}`;
}

type RoadProfileCell = Cell & { roadClass?: RoadCellDto["roadClass"] };

function belongsToBand(graph: ReadonlyMap<string, RoadProfileCell>, origin: RoadProfileCell, candidate: Cell): boolean {
  const value = graph.get(key(candidate));
  return Boolean(value && (!origin.roadClass || !value.roadClass || value.roadClass === origin.roadClass));
}

function axisRun(graph: ReadonlyMap<string, RoadProfileCell>, cell: RoadProfileCell, dx: number, dy: number): number {
  let length = 0;
  for (const sign of [-1, 1]) {
    for (let step = 1; step <= 8; step += 1) {
      if (!belongsToBand(graph, cell, { x: cell.x + dx * step * sign, y: cell.y + dy * step * sign })) break;
      length += 1;
    }
  }
  return length;
}

function directionalBandRun(
  graph: ReadonlyMap<string, RoadProfileCell>,
  cell: RoadProfileCell,
  dx: number,
  dy: number,
): number {
  let length = 0;
  for (let step = 1; step <= 8; step += 1) {
    if (!belongsToBand(graph, cell, { x: cell.x + dx * step, y: cell.y + dy * step })) break;
    length += 1;
  }
  return length;
}

function contiguousBand(
  graph: ReadonlyMap<string, RoadProfileCell>,
  cell: RoadProfileCell,
  horizontal: boolean,
): { min: number; max: number } {
  const coordinate = horizontal ? cell.y : cell.x;
  let min = coordinate;
  let max = coordinate;
  for (const sign of [-1, 1]) {
    for (let step = 1; step <= 6; step += 1) {
      const candidate = horizontal
        ? { x: cell.x, y: cell.y + step * sign }
        : { x: cell.x + step * sign, y: cell.y };
      if (!belongsToBand(graph, cell, candidate)) break;
      if (sign < 0) min = coordinate - step;
      else max = coordinate + step;
    }
  }
  return { min, max };
}

/**
 * Classify a canonical road cell. A three-cell local street contains two
 * opposing travel lanes and one median marking. A seven-cell bus road adds
 * median clearance and shoulders around two full-size travel lanes.
 */
export function roadBandRole(graph: ReadonlyMap<string, RoadProfileCell>, cell: RoadProfileCell): RoadBandRole {
  const profileCell = graph.get(key(cell)) ?? cell;
  const horizontalRun = axisRun(graph, profileCell, 1, 0);
  const verticalRun = axisRun(graph, profileCell, 0, 1);
  // A straight seven-cell road extends only three cells transversely. A real
  // crossing or bend has at least one four-cell arm on each axis. Local roads
  // use the analogous two-cell threshold. Directional runs avoid confusing a
  // wide straight asphalt envelope with a junction.
  const junctionArm = profileCell.roadClass === "LOCAL" ? 4 : profileCell.roadClass ? 8 : 4;
  const north = directionalBandRun(graph, profileCell, 0, -1);
  const east = directionalBandRun(graph, profileCell, 1, 0);
  const south = directionalBandRun(graph, profileCell, 0, 1);
  const west = directionalBandRun(graph, profileCell, -1, 0);
  if ((east >= junctionArm || west >= junctionArm) && (north >= junctionArm || south >= junctionArm)) {
    return { kind: "JUNCTION" };
  }
  if (horizontalRun >= verticalRun) {
    const band = contiguousBand(graph, profileCell, true);
    const midpoint = (band.min + band.max) / 2;
    const width = band.max - band.min + 1;
    if (width % 2 === 1 && (cell.y === midpoint || width >= 7 && Math.abs(cell.y - midpoint) <= 1)) return { kind: "MEDIAN", axis: "H" };
    if (width >= 5 && Math.abs(cell.y - midpoint) >= Math.floor(width / 2)) return { kind: "SHOULDER", axis: "H" };
    return { kind: "TRAVEL", axis: "H", dx: cell.y > midpoint ? 1 : -1, dy: 0 };
  }
  const band = contiguousBand(graph, profileCell, false);
  const midpoint = (band.min + band.max) / 2;
  const width = band.max - band.min + 1;
  if (width % 2 === 1 && (cell.x === midpoint || width >= 7 && Math.abs(cell.x - midpoint) <= 1)) return { kind: "MEDIAN", axis: "V" };
  if (width >= 5 && Math.abs(cell.x - midpoint) >= Math.floor(width / 2)) return { kind: "SHOULDER", axis: "V" };
  return { kind: "TRAVEL", axis: "V", dx: 0, dy: cell.x <= midpoint ? 1 : -1 };
}
