import type { Cell, RoadCellDto } from "./contracts";

export type RoadBandRole =
  | { kind: "JUNCTION" }
  | { kind: "MEDIAN"; axis: "H" | "V" }
  | { kind: "TRAVEL"; axis: "H" | "V"; dx: -1 | 0 | 1; dy: -1 | 0 | 1 };

/** Full-size buses use the separated lanes of three-cell roads only. */
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
 * Classify a canonical road cell. A two-cell band contains two opposing
 * travel lanes; a three-cell band contains two outer travel lanes and a
 * non-drivable median/marking cell. Crossing road bands become a junction.
 */
export function roadBandRole(graph: ReadonlyMap<string, RoadProfileCell>, cell: RoadProfileCell): RoadBandRole {
  const horizontalRun = axisRun(graph, cell, 1, 0);
  const verticalRun = axisRun(graph, cell, 0, 1);
  if (horizontalRun >= 4 && verticalRun >= 4) return { kind: "JUNCTION" };
  if (horizontalRun >= verticalRun) {
    const band = contiguousBand(graph, cell, true);
    const midpoint = (band.min + band.max) / 2;
    if ((band.max - band.min + 1) % 2 === 1 && cell.y === midpoint) return { kind: "MEDIAN", axis: "H" };
    return { kind: "TRAVEL", axis: "H", dx: cell.y > midpoint ? 1 : -1, dy: 0 };
  }
  const band = contiguousBand(graph, cell, false);
  const midpoint = (band.min + band.max) / 2;
  if ((band.max - band.min + 1) % 2 === 1 && cell.x === midpoint) return { kind: "MEDIAN", axis: "V" };
  return { kind: "TRAVEL", axis: "V", dx: 0, dy: cell.x <= midpoint ? 1 : -1 };
}
