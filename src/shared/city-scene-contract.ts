import type { Cell, ChunkPayloadDto, ChunkTaskDto, CityDto } from "./contracts";
import type { IntercityRoadRoute } from "./intercity-roads";

export const CITY_SCENE_SCHEMA_VERSION = 4 as const;
export const CITY_AIRPORT_CONNECTION_LIMIT = 8;

export type CityAirportEndpointDto = { taskId: string; cityId: string; point: Cell };
export type CityAirportConnectionDto = {
  id: string;
  from: CityAirportEndpointDto;
  to: CityAirportEndpointDto;
};

export type CityRailConnectionDto = {
  id: string; fromStationId: string; toStationId: string; fromCityId: string; toCityId: string;
  fromCityName?: string; toCityName?: string;
  /** COUNTRY-only visible segment of a foreign route, with full-trip fractions. */
  points?: Cell[]; progressRange?: [number,number];
};

export type CompletedDistrictRenderSnapshotDto = {
  districtId: string;
  revision: string;
  /** One immutable render record per completed task, instead of one copy per intersecting page. */
  tasks: ChunkTaskDto[];
};

export type SeaConnectionDto = {
  id: string; fromPortId: string; toPortId: string; fromCityId: string; toCityId: string;
  fromCityName?: string; toCityName?: string;
  /** Contiguous water-only segment, in this view's coordinates, and its full-trip fractions. */
  points: Cell[]; progressRange: [number, number];
};

export type CityPortDto = { taskId: string; stage: import("./block-world").ConstructionStage; plan: import("./port-site").LocalPortSitePlan };

export type CitySceneDto = {
  schemaVersion: typeof CITY_SCENE_SCHEMA_VERSION;
  sceneRevision: string;
  city: Pick<CityDto, "id" | "name" | "center" | "bounds">;
  lod: "DETAIL";
  chunkSize: number;
  chunks: ChunkPayloadDto[];
  completedDistrictSnapshots: CompletedDistrictRenderSnapshotDto[];
  /** Directed routes between completed task-backed airport slots in this country. */
  airportConnections: CityAirportConnectionDto[];
  /** Server-owned fixed corridor. Undefined only in older scene responses. */
  railway?: import("./city-railway").CityRailway | null;
  ports?: CityPortDto[];
  seaConnections?: SeaConnectionDto[];
  /** Ready domestic routes from the viewer's personal land topology. */
  railConnections?: CityRailConnectionDto[];
  /** Whole canonical roads incident to this city or intersecting its resident
   * chunk envelope, including road width. No remote city entities. */
  intercityRoads: readonly IntercityRoadRoute[];
  /** Complete persisted street geometry of layouts touching resident chunks.
   * Allows exterior rasterization without clipped half-width neighbour roads.
   * Optional for compatibility with already cached schema-v4 responses. */
  roadContext?: import("./semantic-road").SemanticRoadNetwork;
};
