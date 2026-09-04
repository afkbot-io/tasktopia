import type { RoadCellDto } from "./contracts";

export type RoadAtlasSurface = "PAVEMENT" | "PATH_EARTH" | "PATH_PAVERS" | "PATH_ASPHALT" | "DRIVEWAY";
export type RoadAtlasOverlay =
  | "CROSSWALK_H" | "CROSSWALK_V"
  | "MARKING_H" | "MARKING_V"
  | "BRIDGE_RAIL_N" | "BRIDGE_RAIL_E" | "BRIDGE_RAIL_S" | "BRIDGE_RAIL_W"
  | "BRIDGE_PORTAL_N" | "BRIDGE_PORTAL_E" | "BRIDGE_PORTAL_S" | "BRIDGE_PORTAL_W";

export const ROAD_ATLAS_VISUAL_PROFILE = "TASKTOPIA_TERRAIN_V4_CARTOON_2026" as const;

export type RoadAtlasTile = {
  url: "atlas/road-v2/road.png" | "atlas/road-v2/surface.png" | "atlas/road-v2/overlay.png";
  tileSize: 8;
  sheetWidth: number;
  sheetHeight: number;
  sourceX: number;
  sourceY: number;
  mask?: number;
  variant?: number;
};

const ROAD_FAMILIES = ["LOCAL", "COLLECTOR", "ARTERIAL", "HIGHWAY", "BRIDGE"] as const;
const SURFACE_FAMILIES: readonly RoadAtlasSurface[] = ["PAVEMENT", "PATH_EARTH", "PATH_PAVERS", "PATH_ASPHALT", "DRIVEWAY"];
const OVERLAY_FRAMES: readonly RoadAtlasOverlay[] = [
  "CROSSWALK_H", "CROSSWALK_V", "MARKING_H", "MARKING_V",
  "BRIDGE_RAIL_N", "BRIDGE_RAIL_E", "BRIDGE_RAIL_S", "BRIDGE_RAIL_W",
  "BRIDGE_PORTAL_N", "BRIDGE_PORTAL_E", "BRIDGE_PORTAL_S", "BRIDGE_PORTAL_W",
];

function hashText(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function boundedMask(mask: number): number {
  return Math.max(0, Math.min(15, mask | 0));
}

function directionalTile(
  url: RoadAtlasTile["url"],
  familyIndex: number,
  family: string,
  column: number,
  row: number,
  connectionMask: number,
): RoadAtlasTile {
  const mask = boundedMask(connectionMask);
  const variant = hashText(`${family}:${column}:${row}`) % 3;
  return {
    url,
    tileSize: 8,
    sheetWidth: 128,
    sheetHeight: 120,
    sourceX: mask * 8,
    sourceY: (familyIndex * 3 + variant) * 8,
    mask,
    variant,
  };
}

export function roadAtlasTile(cell: Pick<RoadCellDto, "x" | "y" | "mask" | "structure" | "roadClass">): RoadAtlasTile {
  const family = cell.structure === "BRIDGE" ? "BRIDGE" : cell.roadClass;
  return directionalTile(
    "atlas/road-v2/road.png",
    ROAD_FAMILIES.indexOf(family),
    family,
    cell.x,
    cell.y,
    cell.mask,
  );
}

export function roadAtlasSurfaceTile(
  family: RoadAtlasSurface,
  column: number,
  row: number,
  connectionMask: number,
): RoadAtlasTile {
  return directionalTile(
    "atlas/road-v2/surface.png",
    SURFACE_FAMILIES.indexOf(family),
    family,
    column,
    row,
    connectionMask,
  );
}

export function roadAtlasConnectionMask<T extends string>(
  kind: T,
  column: number,
  row: number,
  kindAt: (column: number, row: number) => T | undefined,
): number {
  let mask = 0;
  if (kindAt(column, row - 1) === kind) mask |= 1;
  if (kindAt(column + 1, row) === kind) mask |= 2;
  if (kindAt(column, row + 1) === kind) mask |= 4;
  if (kindAt(column - 1, row) === kind) mask |= 8;
  return mask;
}

export function roadAtlasOverlayTile(kind: RoadAtlasOverlay): RoadAtlasTile {
  const frame = OVERLAY_FRAMES.indexOf(kind);
  if (frame < 0) throw new Error(`Unknown road atlas overlay: ${String(kind)}`);
  return {
    url: "atlas/road-v2/overlay.png",
    tileSize: 8,
    sheetWidth: 96,
    sheetHeight: 8,
    sourceX: frame * 8,
    sourceY: 0,
  };
}
