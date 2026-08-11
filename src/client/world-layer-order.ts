export const WORLD_LAYER_ORDER = [
  "backdrop",
  "terrain",
  "surface",
  "road",
  "district",
  "platform",
  "featurePlatform",
  "worldObject",
  "flight",
  "agentOverlay",
  "districtTooltip",
  "buildingTooltip",
] as const;

export type WorldLayerName = typeof WORLD_LAYER_ORDER[number];
