import type { SemanticRoadNetwork } from "./semantic-road";

export const BLOCK_WORLD_GENERATOR_VERSION = "block-v1" as const;

export type BlockWorldBounds = { minX: number; minY: number; maxX: number; maxY: number };
export type BlockWorldLayoutStatus = "GENERATING" | "VALIDATING" | "READY" | "ACTIVE" | "SUPERSEDED" | "FAILED";
export type BlockWorldKind = "RESIDENTIAL" | "CIVIC" | "PARK" | "WATER" | "INDUSTRIAL" | "TRANSPORT";
export type ConstructionStage = 1 | 2 | 3 | 4 | 5;

export type DistrictLayoutV1 = {
  id: string;
  districtId: string;
  sequence: number;
  archetype: string;
  bounds: BlockWorldBounds;
};

export type CityBlockV1 = {
  id: string;
  districtLayoutId: string;
  sequence: number;
  kind: BlockWorldKind;
  templateKey: string;
  templateVersion: number;
  variant: string;
  seed: number;
  origin: { x: number; y: number };
  width: number;
  height: number;
  parameters: Record<string, unknown>;
  summary: Record<string, unknown>;
};

export type TaskPlacementV1 = {
  taskId: string;
  blockId: string;
  slotKey: string;
  buildingFamily: string;
  facadeVariant: string;
  constructionStage: ConstructionStage;
};

export type SiteMarkerKind = "RUINED" | "RELOCATED";
export type SiteMarkerV1 = {
  id: string;
  blockId: string;
  slotKey: string;
  kind: SiteMarkerKind;
  targetTaskId?: string;
  snapshot: Record<string, unknown>;
  assetVariant: string;
};

export type CompiledBlockLayoutV1 = {
  id: string;
  countryId: string;
  cityId: string;
  generatorVersion: typeof BLOCK_WORLD_GENERATOR_VERSION;
  seed: number;
  revision: number;
  status: "READY";
  bounds: BlockWorldBounds;
  checksum: string;
  districtLayouts: DistrictLayoutV1[];
  blocks: CityBlockV1[];
  placements: TaskPlacementV1[];
  siteMarkers: SiteMarkerV1[];
  roadNetwork: SemanticRoadNetwork & { id: string; checksum: string };
};
