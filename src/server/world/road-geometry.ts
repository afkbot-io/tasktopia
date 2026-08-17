import type { Cell, RoadCellDto } from "../../shared/contracts";
import { cellKey, neighbors4 } from "./grid";

export type RoadWidthPolicy = Record<RoadCellDto["roadClass"], number>;

/** Bridge components must connect two distinct pieces of dry-road frontage. */
export function bridgeComponentsWithoutTwoLandPortals(roads: Iterable<RoadCellDto>): Array<Set<string>> {
  const roadMap = new Map([...roads].map((road) => [cellKey(road), road]));
  const unvisited = new Set([...roadMap.values()].filter((road) => road.structure === "BRIDGE").map(cellKey));
  const invalid: Array<Set<string>> = [];
  while (unvisited.size > 0) {
    const start = unvisited.values().next().value as string;
    unvisited.delete(start);
    const component = [roadMap.get(start)!];
    const componentKeys = new Set([start]);
    const landPortals = new Set<string>();
    for (let index = 0; index < component.length; index += 1) {
      for (const neighborCell of neighbors4(component[index]!)) {
        const neighbor = roadMap.get(cellKey(neighborCell));
        if (!neighbor) continue;
        const neighborKey = cellKey(neighbor);
        if (neighbor.structure === "ROAD") landPortals.add(neighborKey);
        else if (unvisited.delete(neighborKey)) {
          component.push(neighbor);
          componentKeys.add(neighborKey);
        }
      }
    }
    let portalComponents = 0;
    while (landPortals.size > 0) {
      portalComponents += 1;
      const portalStart = landPortals.values().next().value as string;
      landPortals.delete(portalStart);
      const queue = [roadMap.get(portalStart)!];
      for (let index = 0; index < queue.length; index += 1) {
        for (const neighbor of neighbors4(queue[index]!)) {
          const neighborKey = cellKey(neighbor);
          if (!landPortals.delete(neighborKey)) continue;
          queue.push(roadMap.get(neighborKey)!);
        }
      }
    }
    if (portalComponents < 2) invalid.push(componentKeys);
  }
  return invalid;
}

export function centeredRoadOffsets(width: number): number[] {
  if (!Number.isInteger(width) || width < 1) throw new Error(`Invalid road width: ${width}`);
  const start = -Math.floor(width / 2);
  return Array.from({ length: width }, (_, index) => start + index);
}

/**
 * Expands an orthogonal centerline into a canonical asphalt envelope.
 *
 * The operation deliberately ignores existing asphalt: callers union the
 * returned cells with the persisted network. This guarantees that a new arm
 * stamps its complete width through an existing street instead of collapsing
 * to the one-cell centerline at the junction.
 */
export function stampRoadCorridor(
  path: Cell[],
  roadClass: RoadCellDto["roadClass"],
  widths: RoadWidthPolicy,
): Cell[] {
  const offsets = centeredRoadOffsets(widths[roadClass]);
  const corridor = new Map<string, Cell>();
  const add = (cell: Cell) => corridor.set(cellKey(cell), cell);

  for (let index = 0; index < path.length; index += 1) {
    const cell = path[index]!;
    const previous = path[index - 1];
    const next = path[index + 1];
    const horizontal = Boolean(previous && previous.x !== cell.x || next && next.x !== cell.x);
    const vertical = Boolean(previous && previous.y !== cell.y || next && next.y !== cell.y);

    if (horizontal && vertical) {
      // A square turn envelope is the Chebyshev buffer of the centerline.
      // Without it, the inner corner becomes a one-cell notch with a curb.
      for (const offsetY of offsets) for (const offsetX of offsets) add({ x: cell.x + offsetX, y: cell.y + offsetY });
      continue;
    }
    if (horizontal) for (const offset of offsets) add({ x: cell.x, y: cell.y + offset });
    if (vertical) for (const offset of offsets) add({ x: cell.x + offset, y: cell.y });
    if (!horizontal && !vertical) add(cell);
  }
  return [...corridor.values()];
}

/** Cells that would make a newly stamped road lose part of its full profile. */
export function roadCorridorBlockers(
  path: Cell[],
  roadClass: RoadCellDto["roadClass"],
  widths: RoadWidthPolicy,
  blocked: ReadonlySet<string>,
  existing: ReadonlySet<string> = new Set(),
): Cell[] {
  return stampRoadCorridor(path, roadClass, widths)
    .filter((cell) => blocked.has(cellKey(cell)) && !existing.has(cellKey(cell)));
}
