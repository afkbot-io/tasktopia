export const WORLD_LAYER_ORDER = [
  "backdrop",
  "terrain",
  "surface",
  "road",
  "district",
  "platform",
  "featurePlatform",
  "decoration",
  "agent",
  "building",
  "incident",
  "feature",
  "flight",
  "districtTooltip",
  "buildingTooltip",
] as const;

export type WorldLayerName = typeof WORLD_LAYER_ORDER[number];
