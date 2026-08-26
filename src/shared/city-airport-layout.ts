import type { ConstructionTileKey } from "./construction-stage";
import type { Cell, WorldFeatureDto } from "./contracts";

export const CITY_AIRPORT_CELL_SIZE = 8;

export type AirportBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
};

export type AirportSurfaceRole = "APRON" | "SERVICE" | "TAXIWAY" | "RUNWAY";
export type AirportSurfaceTile = Cell & { role: AirportSurfaceRole };
export type AirportFenceTile = Cell & {
  key: Extract<ConstructionTileKey, "construction-fence" | "construction-fence-post" | "construction-gate">;
  quarterTurns?: 0 | 1 | 2 | 3;
};
export type AirportBuildingRole = "TERMINAL" | "CONTROL" | "HANGAR" | "FIRE" | "SERVICE" | "FUEL";
export type AirportBuildingPlacement = {
  role: AirportBuildingRole;
  asset: string;
  centerX: number;
  baselineY: number;
  scale: number;
  displayWidth: number;
  displayHeight: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export function airportCompoundBounds(feature: Pick<WorldFeatureDto, "origin" | "footprint">): AirportBounds {
  const cells = feature.footprint.length > 0 ? feature.footprint : [feature.origin];
  const minX = Math.min(...cells.map((cell) => cell.x));
  const minY = Math.min(...cells.map((cell) => cell.y));
  const maxX = Math.max(...cells.map((cell) => cell.x));
  const maxY = Math.max(...cells.map((cell) => cell.y));
  return { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Airport persistence keeps the secured perimeter compact. Rendering,
 * decoration masks and ambient movement all need the complete rectangle.
 */
export function airportCompoundCells(feature: Pick<WorldFeatureDto, "origin" | "footprint">): Cell[] {
  const bounds = airportCompoundBounds(feature);
  return Array.from({ length: bounds.width * bounds.height }, (_, index) => ({
    x: bounds.minX + index % bounds.width,
    y: bounds.minY + Math.floor(index / bounds.width),
  }));
}

function hashText(value: string): number {
  let hash = 2_166_136_261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16_777_619) >>> 0;
  return hash;
}

function terminalVariant(feature: Pick<WorldFeatureDto, "id" | "assetKey">): number {
  const explicit = /city-airport-terminal-([1-5])$/.exec(feature.assetKey)?.[1];
  return explicit ? Number(explicit) : hashText(feature.id) % 5 + 1;
}

function building(
  role: AirportBuildingRole,
  asset: string,
  centerX: number,
  baselineY: number,
  sourceWidth: number,
  sourceHeight: number,
  scale: number,
): AirportBuildingPlacement {
  const displayWidth = sourceWidth * scale;
  const displayHeight = sourceHeight * scale;
  return {
    role, asset, centerX, baselineY, scale, displayWidth, displayHeight,
    left: centerX - displayWidth / 2,
    top: baselineY - displayHeight,
    right: centerX + displayWidth / 2,
    bottom: baselineY,
  };
}

function nearestGate(feature: Pick<WorldFeatureDto, "accessPath">, bounds: AirportBounds): {
  side: "N" | "E" | "S" | "W";
  offset: number;
} {
  const fallback = { x: bounds.maxX + 1, y: Math.round((bounds.minY + bounds.maxY) / 2) };
  const point = feature.accessPath.reduce((best, cell) => {
    const distance = Math.max(0, bounds.minX - cell.x, cell.x - bounds.maxX)
      + Math.max(0, bounds.minY - cell.y, cell.y - bounds.maxY);
    return distance < best.distance ? { cell, distance } : best;
  }, { cell: fallback, distance: Number.POSITIVE_INFINITY }).cell;
  const distances = [
    { side: "N" as const, distance: Math.abs(point.y - bounds.minY) },
    { side: "E" as const, distance: Math.abs(point.x - bounds.maxX) },
    { side: "S" as const, distance: Math.abs(point.y - bounds.maxY) },
    { side: "W" as const, distance: Math.abs(point.x - bounds.minX) },
  ].sort((left, right) => left.distance - right.distance);
  const side = distances[0]!.side;
  const span = side === "N" || side === "S" ? bounds.width : bounds.height;
  const raw = side === "N" || side === "S" ? point.x - bounds.minX : point.y - bounds.minY;
  return { side, offset: Math.max(1, Math.min(span - 3, Math.round(raw) - 1)) };
}

function airportFence(feature: Pick<WorldFeatureDto, "accessPath">, bounds: AirportBounds): AirportFenceTile[] {
  const { side, offset } = nearestGate(feature, bounds);
  const tiles: AirportFenceTile[] = [];
  const isGate = (x: number, y: number) => (side === "N" && y === 0 && (x === offset || x === offset + 1))
    || (side === "S" && y === bounds.height - 1 && (x === offset || x === offset + 1))
    || (side === "W" && x === 0 && (y === offset || y === offset + 1))
    || (side === "E" && x === bounds.width - 1 && (y === offset || y === offset + 1));
  for (let x = 0; x < bounds.width; x += 1) {
    if (!isGate(x, 0)) tiles.push({ x, y: 0, key: "construction-fence" });
    if (!isGate(x, bounds.height - 1)) tiles.push({ x, y: bounds.height - 1, key: "construction-fence" });
  }
  for (let y = 1; y < bounds.height - 1; y += 1) {
    if (!isGate(0, y)) tiles.push({ x: 0, y, key: "construction-fence", quarterTurns: 1 });
    if (!isGate(bounds.width - 1, y)) tiles.push({ x: bounds.width - 1, y, key: "construction-fence", quarterTurns: 1 });
  }
  const vertical = side === "E" || side === "W";
  for (let index = 0; index < 2; index += 1) {
    tiles.push({
      x: vertical ? (side === "E" ? bounds.width - 1 : 0) : offset + index,
      y: vertical ? offset + index : (side === "S" ? bounds.height - 1 : 0),
      key: "construction-gate",
      quarterTurns: vertical ? 1 : index === 0 ? 0 : 2,
    });
  }
  for (const [x, y] of [[0, 0], [bounds.width - 1, 0], [0, bounds.height - 1], [bounds.width - 1, bounds.height - 1]] as const) {
    tiles.push({ x, y, key: "construction-fence-post" });
  }
  return tiles;
}

export function cityAirportVisualLayout(
  feature: Pick<WorldFeatureDto, "id" | "assetKey" | "origin" | "footprint" | "accessPath">,
): {
  bounds: AirportBounds;
  surfaceTiles: AirportSurfaceTile[];
  fenceTiles: AirportFenceTile[];
  buildings: AirportBuildingPlacement[];
  runway: { left: number; top: number; width: number; height: number };
} {
  const bounds = airportCompoundBounds(feature);
  const runwayTop = Math.max(8, bounds.height - 7);
  const runwayBottom = Math.min(bounds.height - 3, runwayTop + 3);
  const surfaceTiles: AirportSurfaceTile[] = Array.from({ length: bounds.width * bounds.height }, (_, index) => {
    const x = index % bounds.width;
    const y = Math.floor(index / bounds.width);
    const role: AirportSurfaceRole = y >= runwayTop && y <= runwayBottom && x >= 2 && x < bounds.width - 2
      ? "RUNWAY"
      : y >= runwayTop - 2 && y < runwayTop && x >= 2 && x < bounds.width - 2
        ? "TAXIWAY"
        : y <= runwayTop - 3 && x >= 1 && x < bounds.width - 1
          ? "APRON"
          : "SERVICE";
    return { x, y, role };
  });
  const widthPx = bounds.width * CITY_AIRPORT_CELL_SIZE;
  const topZoneBottom = runwayTop * CITY_AIRPORT_CELL_SIZE;
  const buildings = [
    building("TERMINAL", `atlas/airport/airport-terminal-${terminalVariant(feature)}.png`, widthPx * 0.23, Math.min(topZoneBottom - 40, 78), 192, 96, 0.72),
    building("CONTROL", "atlas/airport/airport-support-1.png", widthPx * 0.535, Math.min(topZoneBottom - 62, 56), 128, 80, 0.58),
    building("HANGAR", "atlas/airport/airport-support-2.png", widthPx * 0.78, Math.min(topZoneBottom - 52, 66), 128, 80, 0.72),
    building("FIRE", "atlas/airport/airport-support-3.png", widthPx * 0.535, Math.min(topZoneBottom - 4, 116), 128, 80, 0.58),
    building("SERVICE", "atlas/airport/airport-support-5.png", widthPx * 0.733, Math.min(topZoneBottom - 4, 116), 128, 80, 0.5),
    building("FUEL", "atlas/airport/airport-support-4.png", widthPx * 0.914, Math.min(topZoneBottom - 4, 116), 128, 80, 0.47),
  ];
  return {
    bounds,
    surfaceTiles,
    fenceTiles: airportFence(feature, bounds),
    buildings,
    runway: {
      left: 2 * CITY_AIRPORT_CELL_SIZE,
      top: runwayTop * CITY_AIRPORT_CELL_SIZE,
      width: Math.max(0, bounds.width - 4) * CITY_AIRPORT_CELL_SIZE,
      height: (runwayBottom - runwayTop + 1) * CITY_AIRPORT_CELL_SIZE,
    },
  };
}
