import type { PlatformKind } from "../shared/contracts";
import type { Cell } from "../shared/contracts";
import type { BuildingCatalogEntry } from "../shared/catalog";
import { taskBuildingPlatform } from "../shared/catalog";
import type { RoadAtlasSurface } from "../shared/road-atlas";

const BUILDING_STAGE_COLORS = [0x9b72d2, 0xd6a13d, 0xf2c84b, 0x4fa5d7, 0x69ad67] as const;

export type BuildingBadgePresentation = {
  label: string;
  width: number;
  height: number;
  fontSize: number;
  borderColor: number;
};

export type BuildingInteractiveBounds = { x: number; y: number; width: number; height: number };

/** Follow opaque authored pixels instead of making transparent sky clickable. */
export function buildingInteractiveBounds(
  entry: BuildingCatalogEntry,
  stage: number,
  constructionPadDepth: number,
  cellSize = 8,
): BuildingInteractiveBounds {
  if (stage <= 2) {
    const width = (entry.footprint.width + 2) * cellSize;
    const height = (constructionPadDepth + 2) * cellSize;
    return { x: -width / 2, y: -(constructionPadDepth + 1) * cellSize, width, height };
  }
  const opaque = entry.stageOpaqueBounds[Math.max(0, Math.min(4, stage - 1))]!;
  return {
    x: opaque.left - entry.anchor.x,
    y: opaque.top - entry.anchor.y,
    width: opaque.right - opaque.left,
    height: opaque.bottom - opaque.top,
  };
}

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
  | { family: "surface"; key: RoadAtlasSurface }
  | { family: "terrain"; key: "GRASS" | "MEADOW" | "DIRT"; variant: 0 | 1 | 2 };

export function buildingPlatformPresentation(platform: PlatformKind): BuildingPlatformPresentation {
  switch (platform) {
    case "ASPHALT": return { family: "surface", key: "DRIVEWAY" };
    case "STONE":
    case "SERVICE": return { family: "surface", key: "PAVEMENT" };
    case "PARK": return { family: "terrain", key: "MEADOW", variant: 1 };
    case "YARD": return { family: "terrain", key: "GRASS", variant: 1 };
  }
}

/** Compact task buildings use their catalog ground material. */
export function taskPlatformPresentation(entry: BuildingCatalogEntry): BuildingPlatformPresentation {
  return buildingPlatformPresentation(taskBuildingPlatform(entry));
}

/**
 * Planning is fence-only and the foundation stage owns its construction tiles.
 * Authored stages then use exactly the physical slot, with no hidden sky
 * reservation, forecourt extension or facade-depth compression.
 */
export function taskPlatformCells(
  footprint: Cell[],
  stage: number,
): Cell[] {
  return stage <= 2 ? [] : footprint;
}

/** One shared surface family keeps all cells aligned with adjacent sidewalks. */
export function taskPlatformCellPresentation(entry: BuildingCatalogEntry): BuildingPlatformPresentation {
  return taskPlatformPresentation(entry);
}
