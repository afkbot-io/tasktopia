import type { Cell, Rect } from "./contracts";

export const PLANET_ATLAS_SCHEMA_VERSION = 4 as const;

export type PlanetCountryDto = {
  id: string;
  name: string;
  seed: number;
  terrainProfile?: import("./world-terrain-profile").WorldTerrainProfile;
  worldVersion: number;
  cityCount: number;
  districtCount: number;
  buildingCount: number;
  unfinishedBuildingCount: number;
  progress: number;
  /** Canonical world extent sampled by every coarser map projection. */
  worldBounds: Rect | null;
  cities: Array<{
    id: string; name?: string; center: Cell;
    /** Bounded real block landmarks, coordinates in canonical CITY space. */
    miniature?: Array<{id:string;districtId:string;x:number;y:number;family:string;stage?:number}>;
    districts: Array<{ id: string; center: Cell }>;
    airports: Array<{ taskId: string; center: Cell }>;
    /** Completed task-linked railway stations; absent in older snapshots. */
    stations?: Array<{ taskId: string; center: Cell }>;
    /** Completed task-backed seaports, in immutable CITY coordinates. */
    ports?: Array<{ taskId: string; berth: Cell; waterOutlet: Cell; stage: 5 }>;
  }>;
};

export type PlanetSeaRouteDto = {
  id: string; fromPortId: string; toPortId: string; fromCityId: string; toCityId: string;
  fromCountryId: string; toCountryId: string; points: Cell[];
};
export type PlanetAtlasDto = {
  /** Server-authorized routes avoid private geographic reserves without exposing them. */
  seaRoutes?: PlanetSeaRouteDto[];
  schemaVersion: typeof PLANET_ATLAS_SCHEMA_VERSION;
  planetSeed: number;
  geography?: import("./planet-geography").VisiblePlanetGeography;
  revision: string;
  countries: PlanetCountryDto[];
};
