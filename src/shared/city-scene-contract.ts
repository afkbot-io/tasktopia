import type { ChunkPayloadDto, ChunkTaskDto, CityDto } from "./contracts";

export const CITY_SCENE_SCHEMA_VERSION = 1 as const;

export type CompletedDistrictRenderSnapshotDto = {
  districtId: string;
  revision: string;
  tasks: Array<Pick<ChunkTaskDto,
    "id" | "taskNumber" | "status" | "stage" | "buildingType" | "visualKind" | "visualAssetKey" | "platformType" | "origin" | "footprint"
  >>;
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
