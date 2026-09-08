import type { Cell, CityDto, DistrictDto, Rect } from "./contracts";

export const COUNTRY_OVERVIEW_SCHEMA_VERSION = 7 as const;
export const COUNTRY_TERRAIN_KINDS = [
  "grass", "meadow", "forest", "hill", "mountain", "coast", "river", "stone", "deep_water", "shallow_water", "unknown",
] as const;
export type CountryOverviewTerrainKind = typeof COUNTRY_TERRAIN_KINDS[number];
export function encodeCountryTerrain(terrain: readonly CountryOverviewTerrainKind[]): string {
  return terrain.map((kind) => COUNTRY_TERRAIN_KINDS.indexOf(kind).toString(16)).join("");
}
export function decodeCountryTerrain(code: string): CountryOverviewTerrainKind {
  return COUNTRY_TERRAIN_KINDS[Number.parseInt(code, 16)] ?? "grass";
}
export type CountryOverviewDistrictDto = {
  id: string; name: string; status: DistrictDto["status"]; color: string; progress: number; taskCount: number;
};
export type CountryCityMiniature = {
  /** Uniform canonical coordinate scale, not a raster block size. */
  cellSize: number;
  columns: number;
  rows: number;
  blocks: Array<{ id: string; districtId: string; x: number; y: number; family: string }>;
  /** Only completed task-linked airports, never synthetic city markers. */
  airports: Array<{ taskId: string; x: number; y: number }>;
  stations?: Array<{ taskId: string; x: number; y: number }>;
};
export type CountryOverviewCityDto = {
  id: string; name: string; status: CityDto["status"];
  sourceCenter: Cell; sourceBounds: Rect; atlasCenter: Cell; progress: number;
  districts: CountryOverviewDistrictDto[];
  miniature: CountryCityMiniature;
};
export type CountryOverviewDto = {
  schemaVersion: typeof COUNTRY_OVERVIEW_SCHEMA_VERSION;
  countryId: string; revision: string; terrainSeed: number; bounds: Rect;
  geography: { columns: number; rows: number; cellSize: number; topology: "SQUARE_4"; terrainCodes: string; territoryCodes: string };
  cities: CountryOverviewCityDto[];
  /** Logical flight connections only; never rendered as inter-city roads. */
  connections: Array<{ fromCityId: string; toCityId: string }>;
  /** Cartographic read model of actual world roads, separate from flights.
   * corridorCells are indices in the inherited geography grid, not CITY tiles. */
  groundRoads: {
    revision: number;
    routes: Array<{ id: string; fromCityId: string; toCityId: string; points: Cell[]; corridorCells: number[] }>;
    unavailable: Array<{ routeId?: string; fromCityId: string; toCityId: string; reason: string }>;
  };
};
