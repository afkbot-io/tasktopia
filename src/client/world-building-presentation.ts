import type { PlatformKind } from "../shared/contracts";
import type { Cell } from "../shared/contracts";
import type { BuildingCatalogEntry } from "../shared/catalog";
import { taskBuildingPlatform } from "../shared/catalog";

const BUILDING_STAGE_COLORS = [0x9b72d2, 0xd6a13d, 0xf2c84b, 0x4fa5d7, 0x69ad67] as const;

export type BuildingBadgePresentation = {
  label: string;
  width: number;
  height: number;
  fontSize: number;
  borderColor: number;
};

export function buildingBadgePresentation(taskNumber: number, stage: number): BuildingBadgePresentation {
  const label = String(taskNumber);
  return {
    label,
    width: Math.max(8, label.length * 4 + 2),
    height: 8,
    fontSize: 6,
    borderColor: BUILDING_STAGE_COLORS[Math.max(0, Math.min(BUILDING_STAGE_COLORS.length - 1, stage - 1))]!,
  };
}

export type BuildingPlatformPresentation =
  | { family: "tile"; key: "pavement" | "road" }
  | { family: "tile"; key: "path-brown" }
  | { family: "terrain"; key: "GRASS" | "MEADOW" | "DIRT"; variant: 0 | 1 | 2 };

export function buildingPlatformPresentation(platform: PlatformKind): BuildingPlatformPresentation {
  switch (platform) {
    case "ASPHALT": return { family: "tile", key: "road" };
    case "STONE":
    case "SERVICE": return { family: "tile", key: "pavement" };
    case "PARK": return { family: "terrain", key: "MEADOW", variant: 1 };
    case "YARD": return { family: "terrain", key: "GRASS", variant: 1 };
  }
}

export function taskPlatformPresentation(entry: BuildingCatalogEntry): BuildingPlatformPresentation {
  const ordinaryResidentialParcel = entry.category === "HOUSE"
    && !entry.tags.includes("new-build")
    && !entry.tags.includes("dense")
    && entry.footprint.width <= 10
    && entry.spriteSize.height <= 96;
  if (entry.platform === "YARD" && !ordinaryResidentialParcel) {
    return { family: "tile", key: "pavement" };
  }
  return buildingPlatformPresentation(taskBuildingPlatform(entry));
}

function yardVariant(x: number, y: number, seed: number): 0 | 1 | 2 {
  let value = Math.imul(x + 17, 73_856_093) ^ Math.imul(y - 31, 19_349_663) ^ Math.imul(seed + 7, 83_492_791);
  value ^= value >>> 13;
  return Math.abs(value) % 3 as 0 | 1 | 2;
}

/**
 * Gives ordinary residential buildings a real parcel rather than a miniature
 * civic square. The south entrance always has a one-cell access path; the
 * remaining cells form a stable mix of lawn, meadow and a compact earth bed.
 * The same pure layout is consumed by the runtime, previews and tests.
 */
export function taskPlatformCellPresentation(
  entry: BuildingCatalogEntry,
  footprint: Cell[],
  cell: Cell,
  seed: number,
  stage: number,
): BuildingPlatformPresentation {
  const base = taskPlatformPresentation(entry);
  if (base.family !== "terrain" || base.key !== "GRASS" || footprint.length === 0) return base;

  const minX = Math.min(...footprint.map((candidate) => candidate.x));
  const maxX = Math.max(...footprint.map((candidate) => candidate.x));
  const minY = Math.min(...footprint.map((candidate) => candidate.y));
  const maxY = Math.max(...footprint.map((candidate) => candidate.y));
  const width = maxX - minX + 1;
  const localX = cell.x - minX;
  const localY = cell.y - minY;
  const declaredEntrance = entry.entrances.find((entrance) => entrance.side === "S")?.offset;
  const entranceX = Math.max(0, Math.min(width - 1, declaredEntrance ?? Math.floor(width / 2)));
  const accessDepth = Math.min(2, maxY - minY + 1);

  if (localX === entranceX && cell.y >= maxY - accessDepth + 1) {
    return { family: "tile", key: "path-brown" };
  }

  const variant = yardVariant(cell.x, cell.y, seed + Math.max(1, Math.round(stage)) * 11);
  const rearBed = localY === 0 && width >= 4 && ((localX + seed) % Math.max(2, width - 1) === 0);
  const sideBed = width >= 6 && localY === 1 && (localX === 0 || localX === width - 1) && (seed + localX) % 2 === 0;
  if (rearBed || sideBed) return { family: "terrain", key: "DIRT", variant };
  if ((localX + localY + seed) % 5 === 0) return { family: "terrain", key: "MEADOW", variant };
  return { family: "terrain", key: "GRASS", variant };
}
