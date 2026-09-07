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

export type CompletedDistrictRenderSnapshotDto = {
  districtId: string;
  revision: string;
  /** One immutable render record per completed task, instead of one copy per intersecting page. */
  tasks: ChunkTaskDto[];
};

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
  /** Whole canonical roads incident to this city or intersecting its resident
   * chunk envelope, including road width. No remote city entities. */
  intercityRoads: readonly IntercityRoadRoute[];
};
