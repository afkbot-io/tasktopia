import type { BuildingCatalogEntry } from "../shared/catalog";

export type AtlasBuildingPresentation = {
  width: number;
  height: number;
  roofDepth: number;
  sideDepth: number;
  doorWidth: number;
  facade: string;
  roof: string;
  accent: string;
};

const PALETTE: Record<BuildingCatalogEntry["category"], Pick<AtlasBuildingPresentation, "facade" | "roof" | "accent">> = {
  HOUSE: { facade: "#c48756", roof: "#4b6064", accent: "#e5d3ad" },
  HIGHRISE: { facade: "#77aeb4", roof: "#344c54", accent: "#d8c47f" },
  COMMERCIAL: { facade: "#b99567", roof: "#3f5558", accent: "#76c4c0" },
  CIVIC: { facade: "#c4a36e", roof: "#46545d", accent: "#e2d7b5" },
};

/** Fixed semantic miniatures replace unreadable 6–12% runtime sprites. */
export function atlasBuildingPresentation(
  category: BuildingCatalogEntry["category"],
  sourceSize: { width: number; height: number },
): AtlasBuildingPresentation {
  const aspect = sourceSize.width / Math.max(1, sourceSize.height);
  const width = category === "HIGHRISE" ? 14
    : category === "COMMERCIAL" ? Math.max(18, Math.min(24, Math.round(18 * Math.max(1, aspect))))
      : category === "CIVIC" ? 20 : 18;
  const height = category === "HIGHRISE" ? 30
    : category === "COMMERCIAL" ? 14
      : category === "CIVIC" ? 18 : 18;
  return {
    width,
    height,
    roofDepth: 4,
    sideDepth: category === "HIGHRISE" ? 1 : 2,
    doorWidth: 3,
    ...PALETTE[category],
  };
}
