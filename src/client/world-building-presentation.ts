import type { PlatformKind } from "../shared/contracts";

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
  | { family: "terrain"; key: "GRASS" | "MEADOW"; variant: 1 };

export function buildingPlatformPresentation(platform: PlatformKind): BuildingPlatformPresentation {
  switch (platform) {
    case "ASPHALT": return { family: "tile", key: "road" };
    case "STONE":
    case "SERVICE": return { family: "tile", key: "pavement" };
    case "PARK": return { family: "terrain", key: "MEADOW", variant: 1 };
    case "YARD": return { family: "terrain", key: "GRASS", variant: 1 };
  }
}
