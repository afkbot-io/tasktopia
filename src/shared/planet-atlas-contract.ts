export const PLANET_ATLAS_SCHEMA_VERSION = 1 as const;

export type PlanetCountryDto = {
  id: string;
  name: string;
  seed: number;
  worldVersion: number;
  cityCount: number;
  districtCount: number;
  buildingCount: number;
  progress: number;
};

export type PlanetAtlasDto = {
  schemaVersion: typeof PLANET_ATLAS_SCHEMA_VERSION;
  planetSeed: number;
  revision: string;
  countries: PlanetCountryDto[];
};
