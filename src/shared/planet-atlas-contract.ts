import type { Cell, Rect } from "./contracts";

export const PLANET_ATLAS_SCHEMA_VERSION = 4 as const;

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
  cities: Array<{
    id: string; center: Cell;
    districts: Array<{ id: string; center: Cell }>;
    airports: Array<{ taskId: string; center: Cell }>;
  }>;
};

export type PlanetAtlasDto = {
  schemaVersion: typeof PLANET_ATLAS_SCHEMA_VERSION;
  planetSeed: number;
  revision: string;
  countries: PlanetCountryDto[];
};
