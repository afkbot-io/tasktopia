import type { Cell } from "../shared/contracts";

export type ResidentDirection = "north" | "east" | "south" | "west";
export type ResidentWalkFrame = "a" | "b" | "c";
export type ResidentWalkKey = `walker-${ResidentDirection}-${ResidentWalkFrame}`;
export type ResidentActivity = "NONE" | "THINK" | "CHAT";

function residentDirection(current: Cell, next: Cell): ResidentDirection {
  if (next.x > current.x) return "east";
  if (next.x < current.x) return "west";
  return next.y < current.y ? "north" : "south";
}

/**
 * Select one of three authored stride silhouettes. The frame follows distance
 * travelled rather than wall-clock time, so a stopped resident never walks in
 * place and pan/zoom cannot restart the gait.
 */
export function residentWalkPresentation(
  current: Cell,
  next: Cell,
  progress: number,
  phase: number,
): { key: ResidentWalkKey; scaleX: number; scaleY: number } {
  const normalized = ((progress + phase) % 1 + 1) % 1;
  // A complete gait returns through the passing pose. Jumping directly from
  // opposite contact C back to contact A makes both legs snap at once.
  const frame = (["a", "b", "c", "b"] as const)[Math.min(3, Math.floor(normalized * 4))]!;
  return {
    key: `walker-${residentDirection(current, next)}-${frame}`,
    scaleX: 1,
    scaleY: 1,
  };
}

/** Foot position travels through the centre of each pedestrian surface cell. */
export function residentGroundPosition(
  current: Cell,
  next: Cell,
  progress: number,
  cellSize: number,
): { x: number; y: number } {
  const clamped = Math.max(0, Math.min(1, progress));
  return {
    x: (current.x + (next.x - current.x) * clamped) * cellSize + cellSize / 2,
    y: (current.y + (next.y - current.y) * clamped) * cellSize + cellSize / 2,
  };
}

/**
 * An activity is an overlay, not a costume change. Keeping the current walk
 * frame preserves the resident's face, clothes and silhouette while paused.
 */
export function residentActivityVisualKey(
  currentKey: ResidentWalkKey,
  activity: ResidentActivity,
): ResidentWalkKey {
  void activity;
  return currentKey;
}

/** World-space anchor for a thought/speech bubble above an upright resident. */
export function residentActivityPosition(
  foot: { x: number; y: number },
  spriteHeight: number,
  scaleY: number,
): { x: number; y: number } {
  return { x: foot.x, y: foot.y - spriteHeight * Math.abs(scaleY) - 4 };
}
