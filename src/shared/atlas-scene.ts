export type AtlasPoint = { x: number; y: number };
export type AtlasTerrainKind = "grass" | "meadow" | "forest" | "hill" | "mountain" | "coast" | "river" | "stone" | "deep_water" | "shallow_water" | "unknown";
export type AtlasTerrainLevel = "city" | "country" | "planet";
export type AtlasTerrainTile = {
  url: string;
  tileSize: 8 | 16;
  sheetWidth: number;
  sheetHeight: number;
  sourceX: number;
  sourceY: number;
  mask: number;
  variant: number;
};
export type AtlasFlightGeometry = { from: AtlasPoint; control: AtlasPoint; to: AtlasPoint; path: string };

function hashText(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function normalizedAtlasTerrain(kind: AtlasTerrainKind): Exclude<AtlasTerrainKind, "unknown"> {
  return kind === "unknown" ? "deep_water" : kind;
}

function atlasTerrainVariantCount(kind: AtlasTerrainKind): number {
  const normalized = normalizedAtlasTerrain(kind);
  return normalized === "deep_water" || normalized === "shallow_water" || normalized === "river" ? 5 : 3;
}

/** N=1, E=2, S=4 and W=8. Exact-family masks keep authored joins deterministic. */
export function atlasTerrainConnectionMask(
  kind: AtlasTerrainKind,
  column: number,
  row: number,
  terrainAt: (column: number, row: number) => AtlasTerrainKind | undefined,
): number {
  const normalized = normalizedAtlasTerrain(kind);
  let mask = 0;
  if (terrainAt(column, row - 1) && normalizedAtlasTerrain(terrainAt(column, row - 1)!) === normalized) mask |= 1;
  if (terrainAt(column + 1, row) && normalizedAtlasTerrain(terrainAt(column + 1, row)!) === normalized) mask |= 2;
  if (terrainAt(column, row + 1) && normalizedAtlasTerrain(terrainAt(column, row + 1)!) === normalized) mask |= 4;
  if (terrainAt(column - 1, row) && normalizedAtlasTerrain(terrainAt(column - 1, row)!) === normalized) mask |= 8;
  return mask;
}

/** Collapse the detailed CITY simulation vocabulary into shared visual families. */
export function atlasTerrainKindFromWorld(kind: string): Exclude<AtlasTerrainKind, "unknown"> {
  switch (kind) {
    case "MEADOW": return "meadow";
    case "FOREST": return "forest";
    case "HILL": return "hill";
    case "MOUNTAIN": return "mountain";
    case "SAND":
    case "WET_SAND": return "coast";
    case "SHALLOW_WATER": return "shallow_water";
    case "DEEP_WATER": return "deep_water";
    case "STONE":
    case "CLAY": return "stone";
    case "DIRT":
    case "GRASS":
    default: return "grass";
  }
}

/** Resolve one native atlas sprite-sheet cell without scaling another map level. */
export function atlasTerrainTile(
  kind: AtlasTerrainKind,
  level: AtlasTerrainLevel,
  column: number,
  row: number,
  connectionMask: number,
): AtlasTerrainTile {
  const normalized = normalizedAtlasTerrain(kind);
  const tileSize = level === "country" ? 16 : 8;
  const mask = Math.max(0, Math.min(15, connectionMask | 0));
  const variants = atlasTerrainVariantCount(normalized);
  const variant = hashText(`${level}:${normalized}:${column}:${row}`) % variants;
  return {
    url: `atlas/terrain-v4/${level}/${normalized}.png`,
    tileSize,
    sheetWidth: tileSize * 16,
    sheetHeight: tileSize * variants,
    sourceX: mask * tileSize,
    sourceY: variant * tileSize,
    mask,
    variant,
  };
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
