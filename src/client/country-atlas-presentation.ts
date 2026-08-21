import type { BuildingCatalogEntry } from "../shared/catalog";

export type AtlasBuildingPresentation = {
  width: number;
  height: number;
  roofDepth: number;
  sideDepth: number;
  doorWidth: number;
  profile: "gable" | "flat" | "stepped" | "courtyard";
  facade: string;
  roof: string;
  accent: string;
  window: string;
  outline: string;
};

type AtlasPalette = Pick<AtlasBuildingPresentation, "facade" | "roof" | "accent" | "window">;

const PALETTES: Record<BuildingCatalogEntry["category"], readonly AtlasPalette[]> = {
  HOUSE: [
    { facade: "#a88365", roof: "#52605b", accent: "#c7b58e", window: "#6d9694" },
    { facade: "#9b735f", roof: "#5f5550", accent: "#c5a986", window: "#70939a" },
    { facade: "#aa9678", roof: "#4d6261", accent: "#d0c09b", window: "#628b91" },
    { facade: "#8f856e", roof: "#555d67", accent: "#bfb18c", window: "#72969a" },
  ],
  HIGHRISE: [
    { facade: "#718f91", roof: "#48595b", accent: "#a8a47d", window: "#9bb7b5" },
    { facade: "#78888b", roof: "#4d565d", accent: "#b4a88b", window: "#91adaf" },
    { facade: "#66858a", roof: "#43565c", accent: "#9e9c7b", window: "#a0b9b5" },
  ],
  COMMERCIAL: [
    { facade: "#98856c", roof: "#4c5a59", accent: "#7fa5a0", window: "#91b7b2" },
    { facade: "#947761", roof: "#555956", accent: "#b19c78", window: "#79a3a4" },
    { facade: "#8b8372", roof: "#495b5e", accent: "#9ba984", window: "#87aeb0" },
  ],
  CIVIC: [
    { facade: "#a39173", roof: "#505b60", accent: "#c4b892", window: "#719a9c" },
    { facade: "#999079", roof: "#4d5a5c", accent: "#b7ac8c", window: "#779da0" },
    { facade: "#a28770", roof: "#55585d", accent: "#c0ae8e", window: "#70969a" },
  ],
};

const PROFILES: Record<BuildingCatalogEntry["category"], readonly AtlasBuildingPresentation["profile"][]> = {
  HOUSE: ["gable", "stepped", "courtyard", "flat"],
  HIGHRISE: ["stepped", "flat", "stepped"],
  COMMERCIAL: ["flat", "courtyard", "stepped"],
  CIVIC: ["courtyard", "gable", "flat"],
};

export type AtlasBuildingPresentationOptions = {
  identity: string;
  assetKey: string;
  /** Width and depth after the city's power-of-two atlas projection, in SVG px. */
  projectedFootprint: { width: number; height: number };
};

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Footprint-aware semantic miniatures replace unreadable 6–12% runtime sprites. */
export function atlasBuildingPresentation(
  category: BuildingCatalogEntry["category"],
  sourceSize: { width: number; height: number },
  options: AtlasBuildingPresentationOptions = {
    identity: category,
    assetKey: category,
    projectedFootprint: { width: 12, height: 8 },
  },
): AtlasBuildingPresentation {
  const hash = stableHash(`${options.assetKey}:${options.identity}`);
  const aspect = sourceSize.width / Math.max(1, sourceSize.height);
  const footprintWidth = Math.max(1, options.projectedFootprint.width);
  const width = category === "HIGHRISE"
    ? clamp(Math.round(footprintWidth * 0.88), 6, 10)
    : category === "COMMERCIAL"
      ? clamp(Math.round(footprintWidth * Math.min(1, Math.max(0.72, aspect))), 8, 16)
      : category === "CIVIC"
        ? clamp(Math.round(footprintWidth * 0.92), 9, 15)
        : clamp(Math.round(footprintWidth * 0.9), 7, 12);
  const height = category === "HIGHRISE"
    ? clamp(Math.round(width * 1.55) + (hash % 3), 13, 19)
    : category === "COMMERCIAL"
      ? clamp(Math.round(width * 0.62), 7, 11)
      : category === "CIVIC"
        ? clamp(Math.round(width * 0.78), 9, 13)
        : clamp(Math.round(width * 0.88) + (hash % 2), 8, 13);
  const palettes = PALETTES[category];
  const profiles = PROFILES[category];
  return {
    width,
    height,
    roofDepth: category === "HIGHRISE" ? 2 : clamp(Math.round(height * 0.24), 2, 3),
    sideDepth: category === "HIGHRISE" ? 0.75 : 1.25,
    doorWidth: width >= 12 ? 2 : 1.5,
    profile: profiles[hash % profiles.length]!,
    outline: "#2a4140",
    ...palettes[(hash >>> 5) % palettes.length]!,
  };
}
