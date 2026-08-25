import type { Cell, CityDto, DistrictDto, Rect } from "./contracts";

export const COUNTRY_OVERVIEW_SCHEMA_VERSION = 1 as const;

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
};

export type CountryOverviewDto = {
  schemaVersion: typeof COUNTRY_OVERVIEW_SCHEMA_VERSION;
  revision: string;
  terrainSeed: number;
  bounds: Rect;
  cities: CountryOverviewCityDto[];
  connections: Array<{ fromCityId: string; toCityId: string }>;
};
