import type { Rect } from "./contracts";

export const PLANET_ATLAS_SCHEMA_VERSION = 3 as const;

export type PlanetCountryDto = {
  id: string;
  name: string;
  seed: number;
  worldVersion: number;
  cityCount: number;
  districtCount: number;
  buildingCount: number;
  unfinishedBuildingCount: number;
  progress: number;
  /** Canonical world extent sampled by every coarser map projection. */
  worldBounds: Rect | null;
};

export type PlanetAtlasDto = {
  schemaVersion: typeof PLANET_ATLAS_SCHEMA_VERSION;
  planetSeed: number;
  revision: string;
  countries: PlanetCountryDto[];
};
