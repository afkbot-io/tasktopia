import { TERRAIN_SPRITES } from "./catalog";

export type AtlasPoint = { x: number; y: number };
export type AtlasTerrainKind = "grass" | "meadow" | "forest" | "hill" | "mountain" | "coast" | "river" | "stone" | "deep_water" | "shallow_water" | "unknown";
export type AtlasFlightGeometry = { from: AtlasPoint; control: AtlasPoint; to: AtlasPoint; path: string };

const TERRAIN_FAMILY: Record<AtlasTerrainKind, keyof typeof TERRAIN_SPRITES> = {
  grass: "GRASS",
  meadow: "MEADOW",
  forest: "FOREST",
  hill: "HILL",
  mountain: "MOUNTAIN",
  coast: "SAND",
  river: "SHALLOW_WATER",
  stone: "STONE",
  deep_water: "DEEP_WATER",
  shallow_water: "SHALLOW_WATER",
  // Unknown country context is rendered as the same deep atlas background as
  // PLANET instead of inventing a white frame or a new vector texture.
  unknown: "DEEP_WATER",
};

function hashText(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

/** Select a deterministic existing Pixel City terrain tile for every atlas level. */
export function atlasTerrainAsset(kind: AtlasTerrainKind, column: number, row: number): string {
  const sprites = TERRAIN_SPRITES[TERRAIN_FAMILY[kind]] ?? TERRAIN_SPRITES.GRASS!;
  return sprites[Math.abs(column * 31 + row * 17) % sprites.length] ?? sprites[0]!;
}

export function atlasRoutePath(from: AtlasPoint, control: AtlasPoint, to: AtlasPoint): string {
  return `M${from.x.toFixed(1)} ${from.y.toFixed(1)} Q${control.x.toFixed(1)} ${control.y.toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`;
}

/** One deterministic quadratic route model shared by PLANET and COUNTRY. */
export function buildAtlasFlightGeometry(from: AtlasPoint, to: AtlasPoint, routeId: string, maximumBend = 68): AtlasFlightGeometry {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const direction = hashText(routeId) % 2 === 0 ? -1 : 1;
  const bend = direction * Math.min(maximumBend, 4 + distance * .2);
  const control = {
    x: (from.x + to.x) / 2 - dy / distance * bend,
    y: (from.y + to.y) / 2 + dx / distance * bend,
  };
  return { from, control, to, path: atlasRoutePath(from, control, to) };
}

export function sampleAtlasFlight(route: AtlasFlightGeometry, progress: number): AtlasPoint & { angle: number } {
  const bounded = Math.max(0, Math.min(1, progress));
  const inverse = 1 - bounded;
  const tangentX = 2 * inverse * (route.control.x - route.from.x) + 2 * bounded * (route.to.x - route.control.x);
  const tangentY = 2 * inverse * (route.control.y - route.from.y) + 2 * bounded * (route.to.y - route.control.y);
  return {
    x: inverse * inverse * route.from.x + 2 * inverse * bounded * route.control.x + bounded * bounded * route.to.x,
    y: inverse * inverse * route.from.y + 2 * inverse * bounded * route.control.y + bounded * bounded * route.to.y,
    angle: Math.atan2(tangentY, tangentX),
  };
}

export const ATLAS_AIRCRAFT_ENDPOINT_KEYFRAMES = "0.05;1;1;0.05";

export function atlasAircraftEndpointScale(progress: number, startsAtAirport = true, endsAtAirport = true): number {
  const bounded = Math.max(0, Math.min(1, progress));
  if (startsAtAirport && bounded <= .14) return .05 + bounded / .14 * .95;
  if (endsAtAirport && bounded >= .86) return .05 + (1 - bounded) / .14 * .95;
  return 1;
}
