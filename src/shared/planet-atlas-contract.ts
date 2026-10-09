import type { Cell, Rect } from "./contracts";

export const PLANET_ATLAS_SCHEMA_VERSION = 5 as const;

export type PlanetCountryDto = {
  id: string;
  name: string;
  seed: number;
  terrainProfile?: import("./world-terrain-profile").WorldTerrainProfile;
  transportNetworks?: {schemaVersion:1;AIR:import("./transport-network").TimetabledAirEdge[];RAIL:import("./transport-network").TimetabledRailEdge[]};
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
  fromCountryId: string; toCountryId: string; points: Cell[];scheduleOffsetMs?:number;
};
export type PlanetRailRouteDto=Omit<PlanetSeaRouteDto,"fromPortId"|"toPortId">&{fromStationId:string;toStationId:string};
export type PlanetAirRouteDto = {
  id: string; fromAirportId: string; toAirportId: string;
  fromCityId: string; toCityId: string; fromCountryId: string; toCountryId: string;
  scheduleOffsetMs: number;
};
export type PlanetAtlasDto = {
  airRoutes?: PlanetAirRouteDto[];
  /** Server-authorized routes avoid private geographic reserves without exposing them. */
  seaRoutes?: PlanetSeaRouteDto[];
  railRoutes?:PlanetRailRouteDto[];
  schemaVersion: typeof PLANET_ATLAS_SCHEMA_VERSION | 4;
  planetSeed: number;
  geography?: import("./planet-geography").VisiblePlanetGeography;
  revision: string;
  countries: PlanetCountryDto[];
};
