import type { ChunkPayloadDto, ChunkTaskDto, CityDto } from "./contracts";

export const CITY_SCENE_SCHEMA_VERSION = 2 as const;

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
};
