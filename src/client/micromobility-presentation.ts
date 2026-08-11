import type { Cell } from "../shared/contracts";
import { vehiclePresentation } from "./agent-routing";

export type MicromobilityKind = "cyclist" | "scooter";

/** Ground cells occupied by the accepted sprite silhouette in its current view. */
export function micromobilityOccupancy(current: Cell, next: Cell): Cell[] {
  return current.y === next.y ? [current, next] : [current];
}

export function micromobilityPresentation(kind: MicromobilityKind, current: Cell, next: Cell): {
  key: `${MicromobilityKind}-${"horizontal" | "north" | "south"}`;
  scaleX: number;
  scaleY: number;
} {
  const direction = vehiclePresentation(current, next, 0.85);
  return {
    key: `${kind}-${direction.view}`,
    scaleX: direction.scaleX,
    scaleY: direction.scaleY,
  };
}
