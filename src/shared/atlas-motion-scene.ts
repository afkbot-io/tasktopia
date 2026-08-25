import type { Cell, Rect } from "./contracts";

export type AtlasPoint = { x: number; y: number };
export type AtlasFlightLane = {
  id: string;
  from: AtlasPoint;
  control: AtlasPoint;
  to: AtlasPoint;
  path: string;
  durationSeconds: number;
  delaySeconds: number;
  aircraftKind: number;
  altitudeScale: number;
};

function hashText(value: string, seed = 2166136261): number {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function quadraticAtlasPath(from: AtlasPoint, control: AtlasPoint, to: AtlasPoint): string {
  return `M${from.x.toFixed(1)} ${from.y.toFixed(1)} Q${control.x.toFixed(1)} ${control.y.toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`;
}

export function nearestCell(point: AtlasPoint, cells: readonly Cell[]): Cell | null {
  let selected: Cell | null = null;
  let selectedDistance = Number.POSITIVE_INFINITY;
  for (const cell of cells) {
    const distance = (cell.x - point.x) ** 2 + (cell.y - point.y) ** 2;
    if (distance < selectedDistance || (distance === selectedDistance && `${cell.x}:${cell.y}` < `${selected?.x}:${selected?.y}`)) {
      selected = cell;
      selectedDistance = distance;
    }
  }
  return selected;
}

/** Returns the one visual airport anchor used by markers, takeoff and landing. */
export function countryAirportAnchor(city: { features: ReadonlyArray<{ kind: string; assetKind?: string; atlasOrigin: Cell; atlasFootprint: readonly Cell[] }>; cutoutMask: readonly Cell[]; atlasCenter: Cell }): Cell | null {
  const airport = city.features.find((feature) => feature.kind === "AIRPORT" && feature.assetKind === "AREA")
    ?? city.features.find((feature) => feature.kind === "AIRPORT");
  if (!airport) return null;
  const footprintCenter = airport.atlasFootprint.length > 0
    ? {
        x: airport.atlasFootprint.reduce((sum, cell) => sum + cell.x, 0) / airport.atlasFootprint.length,
        y: airport.atlasFootprint.reduce((sum, cell) => sum + cell.y, 0) / airport.atlasFootprint.length,
      }
    : airport.atlasOrigin;
  return nearestCell(footprintCenter, city.cutoutMask) ?? nearestCell(city.atlasCenter, city.cutoutMask);
}

export function buildAtlasFlightLane(id: string, from: AtlasPoint, to: AtlasPoint, seed: number, laneIndex = 0): AtlasFlightLane {
  const value = hashText(id, seed);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const side = ((value + laneIndex) & 1) === 0 ? -1 : 1;
  const lane = 16 + value % 31 + laneIndex * 11;
  const bend = side * Math.min(104, distance * (.16 + (value % 17) / 100) + lane);
  const along = .42 + ((value >>> 7) % 17) / 100;
  const control = {
    x: from.x + dx * along - dy / distance * bend,
    y: from.y + dy * along + dx / distance * bend,
  };
  return {
    id,
    from,
    control,
    to,
    path: quadraticAtlasPath(from, control, to),
    durationSeconds: 10 + value % 13,
    delaySeconds: -(value % 23),
    aircraftKind: value % 8,
    altitudeScale: [.82, 1, 1.18][(value >>> 5) % 3]!,
  };
}

export function atlasEdgePoint(bounds: Rect, target: AtlasPoint, seed: number): AtlasPoint {
  const side = hashText(`${target.x}:${target.y}`, seed) % 4;
  if (side === 0) return { x: bounds.minX, y: target.y - 18 - seed % 37 };
  if (side === 1) return { x: bounds.maxX, y: target.y + 14 + seed % 31 };
  if (side === 2) return { x: target.x + 22 + seed % 41, y: bounds.minY };
  return { x: target.x - 20 - seed % 43, y: bounds.maxY };
}
