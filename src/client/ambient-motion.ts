import type { Cell } from "../shared/contracts";
import { vehicleLanePosition } from "./agent-routing";
import { residentGroundPosition } from "./resident-presentation";

export type MovingAgentKind = "WALKER" | "CAR" | "BUS" | "ANIMAL" | "CYCLIST" | "SCOOTER";

/**
 * Stable world-space presentation for every moving agent.
 *
 * Motion comes exclusively from progress along the navigation graph. We do
 * not add a sine-wave bob or rotation: those offsets made wheels, feet and
 * paws detach from the ground and restarted visually when chunks reconciled.
 */
export function ambientMotionPresentation(
  kind: MovingAgentKind,
  current: Cell,
  next: Cell,
  progress: number,
  previous: Cell | undefined,
  cellSize: number,
): { x: number; y: number; rotation: 0 } {
  const point = kind === "CAR" || kind === "BUS"
    ? vehicleLanePosition(current, next, progress, previous, cellSize, kind)
    : residentGroundPosition(current, next, progress, cellSize);
  return { ...point, rotation: 0 };
}
