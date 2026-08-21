export type TaskStatus = "PLANNING" | "STARTED" | "IN_PROGRESS" | "TESTING" | "COMPLETED";
export type DistrictStatus = "PLANNED" | "ACTIVE" | "COMPLETED" | "ABANDONED";
export type CityStatus = "ACTIVE" | "ARCHIVED";
export type TaskPriority = "LOW" | "NORMAL" | "HIGH" | "CRITICAL";
export type WorkItemType = "TASK" | "BUG" | "RELEASE" | "HOTFIX";
export type TaskDefectStatus = "OPEN" | "IN_PROGRESS" | "VERIFYING" | "FIXED";
export type Estimate = 1 | 2 | 3 | 6;
export type TerrainKind = "GRASS" | "MEADOW" | "FOREST" | "HILL" | "MOUNTAIN" | "SAND" | "WET_SAND" | "CLAY" | "STONE" | "SHALLOW_WATER" | "DEEP_WATER" | "DIRT";
export type PlatformKind = "YARD" | "STONE" | "ASPHALT" | "SERVICE" | "PARK";
export type CityMorphology = "BALANCED" | "DENSE_CORE" | "GARDEN_CITY" | "POLYCENTRIC";
export type DistrictArchetype = "NEW_BUILD" | "PRIVATE" | "MIXED_URBAN" | "COMMERCIAL" | "CIVIC";
export type SurfaceKind = "SIDEWALK" | "PATH" | "DRIVEWAY" | "SHOULDER" | "CROSSWALK";
export type WorldFeatureKind = "CITY_SIGN" | "BUS_STOP" | "SERVICE_STATION" | "ROADSIDE_DECOR" | "PARK" | "GROVE" | "PARK_DECOR" | "RUIN" | "LANDMARK" | "COUNTRY_ARCHIVE";
export type CardinalOrientation = "N" | "E" | "S" | "W";
export type CountryRole = "OWNER" | "MEMBER" | "VIEWER";
export type McpScope = "country:read" | "cities:write" | "districts:write" | "tasks:read" | "tasks:write" | "comments:write";
export const MCP_SCOPES: readonly McpScope[] = [
  "country:read", "cities:write", "districts:write", "tasks:read", "tasks:write", "comments:write",
];
export const MCP_READ_SCOPES: readonly McpScope[] = ["country:read", "tasks:read"];
export type BlockPattern = "COMPLEX_ROW" | "COMPLEX_SLAB" | "COMPLEX_SQUARE" | "COMPLEX_L_SHAPE" | "COMPLEX_COURT" | "COMPLEX_POINT";
export type PlannedLotRole = "PRIMARY" | "SUPPORT";
export type PlannedLotPosition = "FRONTAGE" | "CORNER" | "COURTYARD";

export type Cell = { x: number; y: number };
export type Rect = { minX: number; minY: number; maxX: number; maxY: number };

export type CountryDto = {
  id: string;
  name: string;
  description: string;
  goal: string;
  productContext: string;
  successCriteria: string;
  constraints: string;
  worldVersion: number;
  generatorVersion: "square-v7";
  createdAt: string;
};

export type CountryAccessDto = CountryDto & {
  role: CountryRole;
  memberCount: number;
};

export type WorldManifestDto = {
  terrainSeed: number;
  generatorVersion: CountryDto["generatorVersion"];
  assetRevision: string;
  worldRevision: number;
  chunkSize: number;
  viewBounds: Rect;
};

export type CountryMemberDto = {
  userId: string;
  email: string;
  name: string;
  role: CountryRole;
  joinedAt: string;
};

export type AccountRefDto = { id: string; email: string; name: string };

export type CityDto = {
  id: string;
  name: string;
  description: string;
  goal: string;
  acceptanceCriteria: string;
  deadline: string | null;
  status: CityStatus;
  center: Cell;
  bounds: Rect;
  styleId: string;
  morphology: CityMorphology;
  createdAt: string;
};

export type PlannedLotDto = {
  id: string;
  origin: Cell;
  width: number;
  height: number;
  taskId: string | null;
  /** V10 complex planning metadata. */
  layoutVersion?: "block-v3";
  /** Complex (ЖК) identifier — one perimeter block along one street group. */
  groupId?: string;
  pattern?: BlockPattern;
  slotIndex?: number;
  slotCount?: number;
  role?: PlannedLotRole;
  /** Position inside the complex: street frontage, street corner or courtyard infill. */
  position?: PlannedLotPosition;
  frontageSide?: CardinalOrientation;
  facadeFamily?: string;
  /** Courtyard-loop skeleton; published as PATH only once the lot is committed. */
  sharedAccess?: Cell[];
  /** Demolished building site (пустырь): kept reserved until redevelopment. */
  vacant?: boolean;
};

export type DistrictDto = {
  id: string;
  cityId: string;
  name: string;
  goal: string;
  description: string;
  deadline: string | null;
  status: DistrictStatus;
  capacitySp: number;
  cells: Cell[];
  lots: PlannedLotDto[];
  growthDirection: "N" | "E" | "S" | "W";
  archetype: DistrictArchetype;
  color: string;
  createdAt: string;
};

export type TaskCommentDto = {
  id: string;
  taskId: string;
  body: string;
  actor: string;
  createdAt: string;
};

export type TaskLinkDto = {
  url: string;
  title: string;
  actor: string;
  addedAt: string;
};

export type TaskAttachmentDto = {
  id: string;
  taskId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  actor: string;
  createdAt: string;
};

export type TaskDocumentDto = {
  id: string;
  taskId: string;
  fileName: string;
  title: string;
  content: string;
  isDefault: boolean;
  position: number;
  actor: string;
  updatedAt: string;
};

export type TaskChecklistItemDto = {
  id: string;
  taskId: string;
  title: string;
  done: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
};

export type ArchiveRecordKind = "PROJECT" | "REPOSITORY" | "ARCHITECTURE" | "CONVENTION" | "ENVIRONMENT" | "TEMPLATE";

export type CountryArchiveDto = {
  id: string;
  countryId: string;
  name: "Государственный архив";
  stage: 1 | 2 | 3 | 4;
  recordCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ArchiveRecordDto = {
  id: string;
  archiveId: string;
  countryId: string;
  kind: ArchiveRecordKind;
  title: string;
  body: string;
  sourceUrl: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

export type TaskSearchResultDto = {
  id: string;
  taskNumber: number;
  title: string;
  workItemType: WorkItemType;
  status: TaskStatus;
  progress: number;
  stage: number;
  cityId: string;
  cityName: string;
  districtId: string;
  districtName: string;
  origin: Cell;
};

export type TaskEventDto = {
  id: number;
  taskId: string;
  type: "CREATED" | "TITLE_CHANGED" | "STATUS_CHANGED" | "COMMENT_ADDED" | "ASSIGNEE_CHANGED" | "FIELDS_UPDATED" | "DEFECT_CREATED" | "DEFECT_UPDATED" | "LINK_ADDED" | "LINK_REMOVED" | "ATTACHMENT_ADDED" | "DOCUMENT_UPDATED" | "DOCUMENT_DELETED" | "CHECKLIST_REPLACED" | "CHECKLIST_ITEM_UPDATED";
  actor: string;
  actorUserId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
};

export type TaskDefectDto = {
  id: string;
  taskId: string;
  title: string;
  description: string;
  reproductionSteps: string;
  actualResult: string;
  expectedResult: string;
  status: TaskDefectStatus;
  fixedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TaskDto = {
  id: string;
  taskNumber: number;
  cityId: string;
  districtId: string;
  title: string;
  description: string;
  workItemType: WorkItemType;
  acceptanceCriteria: string;
  systemAnalysis: string;
  architecture: string;
  designSystem: string;
  implementationPlan: string;
  estimate: Estimate;
  priority: TaskPriority;
  status: TaskStatus;
  progress: number;
  dueAt: string | null;
  buildingType: string;
  visualKind: "BUILDING" | "PARK";
  visualAssetKey: string;
  platformType: PlatformKind;
  origin: Cell;
  footprint: Cell[];
  entrance: Cell;
  accessPath: Cell[];
  accessKind: Extract<SurfaceKind, "PATH" | "DRIVEWAY">;
  stage: number;
  createdAt: string;
  updatedAt: string;
  mergeRequests: TaskLinkDto[];
  attachments?: TaskAttachmentDto[];
  documents?: TaskDocumentDto[];
  checklist?: TaskChecklistItemDto[];
  comments?: TaskCommentDto[];
  creator?: AccountRefDto | null;
  assignee?: AccountRefDto | null;
  assigneeRole?: string | null;
  forUser?: AccountRefDto | null;
  dependencies?: { id: string; taskNumber: number; title: string; status: TaskStatus }[];
  events?: TaskEventDto[];
  defects?: TaskDefectDto[];
};

export type RoadCellDto = Cell & {
  mask: number;
  structure: "ROAD" | "BRIDGE";
  roadClass: "LOCAL" | "COLLECTOR" | "ARTERIAL" | "HIGHWAY";
};

export type TerrainCellDto = Cell & {
  terrain: TerrainKind;
  variant: number;
};

export type SurfaceCellDto = Cell & {
  kind: SurfaceKind;
  orientation?: "H" | "V";
  finish?: "EARTH" | "PAVERS" | "ASPHALT";
};

export type WorldFeatureDto = {
  id: string;
  cityId: string | null;
  districtId: string | null;
  parentFeatureId: string | null;
  kind: WorldFeatureKind;
  assetKind: "PROP" | "BUILDING" | "AREA";
  assetKey: string;
  origin: Cell;
  footprint: Cell[];
  orientation: CardinalOrientation;
  accessPath: Cell[];
  developmentStage: 1 | 2 | 3 | 4 | 5;
  label?: string;
};

export type DecorationDto = {
  id: string;
  kind: string;
  origin: Cell;
};

export type ChunkDistrictDto = Pick<DistrictDto, "id" | "cityId" | "name" | "deadline" | "status" | "color" | "archetype"> & {
  cells: Cell[];
};

export type ChunkTaskDto = Pick<TaskDto,
  "id" | "taskNumber" | "cityId" | "districtId" | "title" | "workItemType" | "status" | "progress" | "stage" | "buildingType" | "visualKind" | "visualAssetKey" | "platformType" | "origin" | "footprint" | "accessPath"
> & {
  defectSummary?: { open: number; inProgress: number; verifying: number; active: number };
};

export type ChunkDto = {
  chunkX: number;
  chunkY: number;
  size: number;
  terrain: TerrainCellDto[];
  roads: RoadCellDto[];
  surfaces: SurfaceCellDto[];
  districts: ChunkDistrictDto[];
  tasks: ChunkTaskDto[];
  decorations: DecorationDto[];
  worldFeatures: WorldFeatureDto[];
  worldVersion: number;
};

export type ChunkLod = "DETAIL" | "OVERVIEW";

export type CellRunDto = { start: Cell; end: Cell };
export type RoadRunDto = CellRunDto & Pick<RoadCellDto, "mask" | "structure" | "roadClass">;
export type SurfaceRunDto = CellRunDto & Pick<SurfaceCellDto, "kind" | "finish">;

/**
 * Compact persisted/wire representation. Deterministic environment arrays are
 * reconstructed in a browser worker instead of crossing the network.
 */
export type ChunkPayloadV1Dto = Omit<ChunkDto, "terrain" | "decorations" | "worldVersion"> & {
  payloadVersion: 1;
  contentHash: string;
  generatorVersion: "square-v7";
  terrainSeed: number;
  publishedVersion: number;
  lod: ChunkLod;
  /** Client-only fast path used before authoritative overlays arrive. */
  baseLayerOnly?: true;
  decorationContext: {
    cityBounds: Rect[];
    // One-cell ownership halo prevents clipped district boundaries from
    // turning chunk seams into artificial fence lines.
    districts: Array<Pick<ChunkDistrictDto, "id" | "status" | "archetype" | "cells">>;
    // Decoration generation needs neighbouring task access paths even when a
    // task footprint itself belongs to the adjacent chunk.
    tasks: Array<Pick<ChunkTaskDto, "id" | "taskNumber" | "visualKind" | "stage" | "footprint" | "accessPath">>;
  };
};

export type CompactChunkDistrictDto = Omit<ChunkDistrictDto, "cells"> & { cellRuns: CellRunDto[] };
export type CompactDecorationDistrictDto = Omit<
  Pick<ChunkDistrictDto, "id" | "status" | "archetype" | "cells">,
  "cells"
> & { cellRuns: CellRunDto[] };

/**
 * Endpoint-based read model. Canonical editing and generation may keep cells,
 * but the browser receives linear geometry once and expands it in its worker.
 */
export type ChunkPayloadV2Dto = Pick<ChunkDto, "chunkX" | "chunkY" | "size" | "tasks" | "worldFeatures"> & {
  payloadVersion: 2;
  contentHash: string;
  generatorVersion: "square-v8";
  terrainSeed: number;
  publishedVersion: number;
  lod: ChunkLod;
  baseLayerOnly?: true;
  roadRuns: RoadRunDto[];
  surfaceRuns: SurfaceRunDto[];
  districts: CompactChunkDistrictDto[];
  decorationContext: {
    cityBounds: Rect[];
    districts: CompactDecorationDistrictDto[];
    tasks: Array<Pick<ChunkTaskDto, "id" | "taskNumber" | "visualKind" | "stage" | "footprint" | "accessPath">>;
  };
};

export type ChunkPayloadDto = ChunkPayloadV1Dto | ChunkPayloadV2Dto;

export type ViewportPayloadDto = {
  payloadVersion: 1;
  lod: ChunkLod;
  chunks: ChunkPayloadDto[];
};

export type BootstrapDto = {
  user: { id: string; email: string; name: string };
  country: CountryDto;
  countries: CountryAccessDto[];
  countryRole: CountryRole;
  archive: CountryArchiveDto;
  initialCity: CityDto | null;
  viewBounds: Rect;
  worldManifest: WorldManifestDto;
  /** Durable events at or below this id are already reflected in bootstrap. */
  eventCursor: number;
  stats: { cities: number; districts: number; tasks: number; activeDistricts: number; unfinishedBuildings: number };
  chunkSize: number;
  assetVersion: 4;
};

export type PlanCityDto = CityDto & {
  districtCount: number;
  taskCount: number;
};

export type PlanCityPageDto = {
  items: PlanCityDto[];
  nextCursor: string | null;
};

export type McpTokenDto = {
  id: string;
  name: string;
  prefix: string;
  scopes: McpScope[];
  expiresAt: string | null;
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
};

export type PlanDistrictDto = Pick<DistrictDto,
  "id" | "cityId" | "name" | "goal" | "description" | "deadline" | "status" | "capacitySp" | "archetype" | "color" | "createdAt"
> & {
  taskCount: number;
};

export type PlanTaskDto = Pick<TaskDto,
  "id" | "taskNumber" | "cityId" | "districtId" | "title" | "workItemType" | "estimate" | "priority" | "status" | "progress" | "dueAt" | "stage" | "updatedAt"
> & { activeDefectCount: number };

export type RealtimeEvent = {
  id: number;
  countryId: string;
  type: string;
  worldVersion: number;
  payload: Record<string, unknown>;
  createdAt: string;
};

export const TASK_STAGE: Record<TaskStatus, number> = {
  PLANNING: 1,
  STARTED: 2,
  IN_PROGRESS: 3,
  TESTING: 4,
  COMPLETED: 5,
};

export const STATUS_PROGRESS_RANGE: Record<TaskStatus, readonly [number, number]> = {
  PLANNING: [0, 0], STARTED: [0, 0], IN_PROGRESS: [1, 79], TESTING: [80, 99], COMPLETED: [100, 100],
};
