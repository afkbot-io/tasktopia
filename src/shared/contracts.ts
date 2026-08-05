export type TaskStatus = "PLANNING" | "STARTED" | "IN_PROGRESS" | "TESTING" | "COMPLETED";
export type DistrictStatus = "PLANNED" | "ACTIVE" | "COMPLETED";
export type CityStatus = "ACTIVE" | "ARCHIVED";
export type TaskPriority = "LOW" | "NORMAL" | "HIGH" | "CRITICAL";
export type Estimate = 1 | 2 | 3 | 6;
export type TerrainKind = "GRASS" | "MEADOW" | "FOREST" | "HILL" | "MOUNTAIN" | "SAND" | "WET_SAND" | "CLAY" | "STONE" | "SHALLOW_WATER" | "DEEP_WATER" | "DIRT";
export type PlatformKind = "YARD" | "STONE" | "ASPHALT" | "SERVICE" | "PARK";
export type CityMorphology = "BALANCED" | "DENSE_CORE" | "GARDEN_CITY" | "POLYCENTRIC";
export type DistrictArchetype = "NEW_BUILD" | "PRIVATE" | "MIXED_URBAN" | "COMMERCIAL" | "CIVIC";
export type SurfaceKind = "SIDEWALK" | "PATH" | "DRIVEWAY" | "SHOULDER" | "CROSSWALK";
export type WorldFeatureKind = "CITY_SIGN" | "BUS_STOP" | "SERVICE_STATION" | "ROADSIDE_DECOR" | "PARK" | "GROVE" | "PARK_DECOR";
export type CardinalOrientation = "N" | "E" | "S" | "W";
export type CountryRole = "OWNER" | "MEMBER" | "VIEWER";
export type McpScope = "country:read" | "cities:write" | "districts:write" | "tasks:read" | "tasks:write" | "comments:write";
export const MCP_SCOPES: readonly McpScope[] = [
  "country:read", "cities:write", "districts:write", "tasks:read", "tasks:write", "comments:write",
];
export const MCP_READ_SCOPES: readonly McpScope[] = ["country:read", "tasks:read"];
export type BlockPattern = "DENSE_SUPERBLOCK_3X3" | "DENSE_ROW" | "PRIVATE_STREET_ROW" | "PRIVATE_TWO_SIDED" | "PRIVATE_MEWS" | "COMMERCIAL_STRIP" | "CIVIC_CLUSTER";
export type PlannedLotRole = "PRIMARY" | "SUPPORT";

export type Cell = { x: number; y: number };
export type Rect = { minX: number; minY: number; maxX: number; maxY: number };

export type CountryDto = {
  id: string;
  name: string;
  worldVersion: number;
  generatorVersion: "square-v7";
  createdAt: string;
};

export type CountryAccessDto = CountryDto & {
  role: CountryRole;
  memberCount: number;
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
  /** Optional V9 metadata. Old square-v7 districts remain valid without it. */
  layoutVersion?: "block-v2";
  groupId?: string;
  pattern?: BlockPattern;
  slotIndex?: number;
  slotCount?: number;
  rowIndex?: number;
  role?: PlannedLotRole;
  frontageSide?: CardinalOrientation;
  facadeFamily?: string;
  alignmentX?: "START" | "CENTER" | "END";
  alignmentY?: "START" | "CENTER" | "END";
  sharedAccess?: Cell[];
};

export type DistrictDto = {
  id: string;
  cityId: string;
  name: string;
  goal: string;
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

export type TaskEventDto = {
  id: number;
  taskId: string;
  type: "CREATED" | "TITLE_CHANGED" | "STATUS_CHANGED" | "COMMENT_ADDED" | "ASSIGNEE_CHANGED";
  actor: string;
  actorUserId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
};

export type TaskDto = {
  id: string;
  cityId: string;
  districtId: string;
  title: string;
  description: string;
  estimate: Estimate;
  priority: TaskPriority;
  status: TaskStatus;
  progress: number;
  dueAt: string | null;
  buildingType: string;
  platformType: PlatformKind;
  origin: Cell;
  footprint: Cell[];
  entrance: Cell;
  accessPath: Cell[];
  accessKind: Extract<SurfaceKind, "PATH" | "DRIVEWAY">;
  stage: number;
  createdAt: string;
  updatedAt: string;
  comments?: TaskCommentDto[];
  creator?: AccountRefDto | null;
  assignee?: AccountRefDto | null;
  events?: TaskEventDto[];
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
};

export type DecorationDto = {
  id: string;
  kind: string;
  origin: Cell;
};

export type ChunkDistrictDto = Pick<DistrictDto, "id" | "cityId" | "status" | "color" | "archetype"> & {
  cells: Cell[];
};

export type ChunkTaskDto = Pick<TaskDto,
  "id" | "cityId" | "districtId" | "title" | "status" | "progress" | "stage" | "buildingType" | "platformType" | "origin" | "footprint"
> & { descriptionPreview?: string };

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

export type BootstrapDto = {
  user: { id: string; email: string; name: string };
  country: CountryDto;
  countries: CountryAccessDto[];
  countryRole: CountryRole;
  initialCity: CityDto | null;
  viewBounds: Rect;
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
  "id" | "cityId" | "name" | "goal" | "status" | "capacitySp" | "archetype" | "color" | "createdAt"
> & {
  taskCount: number;
};

export type PlanTaskDto = Pick<TaskDto,
  "id" | "cityId" | "districtId" | "title" | "estimate" | "priority" | "status" | "progress" | "dueAt" | "stage" | "updatedAt"
>;

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
