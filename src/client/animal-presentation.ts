import type { Cell } from "../shared/contracts";

export type AnimalDirection = "north" | "east" | "south";
export type AnimalFrame = "a" | "b" | "c";

/**
 * Animals use three authored views. West is the exact east silhouette mirrored
 * at runtime, which makes movement direction a geometry invariant instead of
 * relying on a separately generated frame that may face the wrong way.
 */
export function animalPresentation(
  species: string,
  current: Cell,
  next: Cell,
  animationFrame = 0,
): { key: `animal-${string}-${AnimalDirection}-${AnimalFrame}`; scaleX: number; scaleY: number } {
  const horizontal = next.x !== current.x;
  const direction: AnimalDirection = horizontal ? "east" : next.y < current.y ? "north" : "south";
  const frame = (["a", "b", "c"] as const)[Math.abs(Math.floor(animationFrame)) % 3]!;
  return {
    key: `animal-${species}-${direction}-${frame}`,
    scaleX: horizontal && next.x < current.x ? -1 : 1,
    scaleY: 1,
  };
}
