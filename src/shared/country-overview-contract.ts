import type { Cell, CityDto, DistrictDto, Rect } from "./contracts";

export const COUNTRY_OVERVIEW_SCHEMA_VERSION = 3 as const;

export const COUNTRY_TERRAIN_KINDS = [
  "grass", "meadow", "forest", "hill", "mountain", "coast", "river", "stone", "deep_water", "shallow_water",
] as const;
export type CountryOverviewTerrainKind = typeof COUNTRY_TERRAIN_KINDS[number];

export function encodeCountryTerrain(terrain: readonly CountryOverviewTerrainKind[]): string {
  return terrain.map((kind) => COUNTRY_TERRAIN_KINDS.indexOf(kind).toString(16)).join("");
}

export function decodeCountryTerrain(code: string): CountryOverviewTerrainKind {
  const kind = COUNTRY_TERRAIN_KINDS[Number.parseInt(code, 16)];
  return kind ?? "grass";
}

export type CountryOverviewDistrictDto = {
  id: string;
  name: string;
  status: DistrictDto["status"];
  color: string;
  progress: number;
  taskCount: number;
};

export type CountryOverviewCityDto = {
  id: string;
  name: string;
  status: CityDto["status"];
  sourceCenter: Cell;
  sourceBounds: Rect;
  atlasCenter: Cell;
  progress: number;
  districts: CountryOverviewDistrictDto[];
  /** A semantic city silhouette. Zero means empty; 1..f reference a district. */
  miniature: {
    columns: number;
    rows: number;
    districtCodes: string;
    airportCell: Cell;
  };
};

export type CountryOverviewDto = {
  schemaVersion: typeof COUNTRY_OVERVIEW_SCHEMA_VERSION;
  countryId: string;
  revision: string;
  terrainSeed: number;
  bounds: Rect;
  geography: {
    columns: number;
    rows: number;
    cellSize: number;
    topology: "SQUARE_4";
    terrainCodes: string;
  };
  cities: CountryOverviewCityDto[];
  connections: Array<{ fromCityId: string; toCityId: string }>;
};
