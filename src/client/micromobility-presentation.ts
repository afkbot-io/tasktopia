import type { Cell } from "../shared/contracts";
import { vehiclePresentation } from "./agent-routing";

export type MicromobilityKind = "cyclist" | "scooter";

/** Ground cells occupied by the accepted sprite silhouette in its current view. */
export function micromobilityOccupancy(current: Cell, next: Cell): Cell[] {
  return current.y === next.y ? [current, next] : [current];
}

export function micromobilityPresentation(kind: MicromobilityKind, current: Cell, next: Cell, animationFrame = 0): {
  key: `${MicromobilityKind}-${"horizontal" | "north" | "south"}-${"a" | "b" | "c"}`;
  scaleX: number;
  scaleY: number;
} {
  // Rider sprites are authored against the same 18 px adult scale as walkers.
  // Runtime shrinking made riders look like children next to pedestrians.
  const direction = vehiclePresentation(current, next, 1);
  const frame = (["a", "b", "c"] as const)[Math.abs(Math.floor(animationFrame)) % 3]!;
  return {
    key: `${kind}-${direction.view}-${frame}`,
    scaleX: direction.scaleX,
    scaleY: direction.scaleY,
  };
}
