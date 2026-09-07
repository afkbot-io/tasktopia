import manifest from "../../assets/pixel-city-pack/micro-ambient-manifest.json";
import { gameAssetUrl } from "./catalog";
import type { Cell } from "./contracts";

export const MICRO_CAR_VARIANTS = ["blue", "red", "taxi", "van"] as const;
export const MICRO_PERSON_VARIANTS = ["ochre", "teal"] as const;
export const MICRO_ANIMAL_SPECIES = ["fox", "deer", "rabbit", "boar", "duck", "sheep", "dog", "cat"] as const;
export const MICRO_DIRECTIONS = ["north", "east", "south", "west"] as const;
export type MicroDirection = typeof MICRO_DIRECTIONS[number];
export type MicroAmbientKind = "car" | "person" | "animal" | "aircraft";
export type MicroAmbientSprite = {
  key: string;
  url: string;
  width: number;
  height: number;
  anchor: { x: number; y: number };
  opaqueBounds: { left: number; top: number; right: number; bottom: number };
  direction: MicroDirection | "static";
  frameCount: 1;
};

const sprites = new Map<string, MicroAmbientSprite>(Object.entries(manifest.sprites).map(([key, entry]) => [key, {
  key, url: gameAssetUrl(entry.path), width: entry.size[0]!, height: entry.size[1]!,
  anchor: { x: entry.anchorPx[0]!, y: entry.anchorPx[1]! },
  opaqueBounds: { left: entry.opaqueBounds[0]!, top: entry.opaqueBounds[1]!, right: entry.opaqueBounds[2]!, bottom: entry.opaqueBounds[3]! },
  direction: entry.direction as MicroAmbientSprite["direction"], frameCount: 1,
}]));

/** Every heading selects an authored texture; no runtime rotation or mirroring. */
export function microDirection(current: Cell, next: Cell, stoppedDirection: MicroDirection = "south"): MicroDirection {
  const dx = next.x - current.x, dy = next.y - current.y;
  if (dx === 0 && dy === 0) return stoppedDirection;
  if (Math.abs(dy) > Math.abs(dx)) return dy < 0 ? "north" : "south";
  return dx > 0 ? "east" : "west";
}

/** Animals deliberately have one neutral pose: time and movement do not animate it. */
export function microAmbientSprite(kind: MicroAmbientKind, variant: string, direction: MicroDirection = "south"): MicroAmbientSprite {
  const key = `micro-${kind}-${variant}-${kind === "animal" ? "static" : direction}`;
  const sprite = sprites.get(key);
  if (!sprite) throw new Error(`Unknown micro ambient sprite: ${key}`);
  return sprite;
}

export function microAmbientAssetUrls(): string[] {
  return [...sprites.values()].map((sprite) => sprite.url);
}
