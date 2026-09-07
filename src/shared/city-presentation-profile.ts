export const BLOCK_V1_CITY_PRESENTATION = Object.freeze({
  version: "block-v1-city-v1",
  logicalCellPx: 4,
  terrainMacroCells: 4,
  terrainMacroPx: 16,
} as const);

if (
  BLOCK_V1_CITY_PRESENTATION.logicalCellPx * BLOCK_V1_CITY_PRESENTATION.terrainMacroCells
  !== BLOCK_V1_CITY_PRESENTATION.terrainMacroPx
) {
  throw new Error("Invalid block-v1 CITY terrain presentation profile");
}

export type CityPresentationProfile = typeof BLOCK_V1_CITY_PRESENTATION;
