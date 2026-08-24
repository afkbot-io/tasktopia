import type {
  Cell,
  CityDto,
  DistrictDto,
  PlatformKind,
  Rect,
  RoadCellDto,
  SurfaceCellDto,
  TaskDto,
  TerrainKind,
  WorldFeatureDto,
  WorkItemType,
} from "./contracts";

export const COUNTRY_ATLAS_TERRAIN_TILE_CELLS = 4;
export const COUNTRY_ATLAS_SCHEMA_VERSION = 5 as const;

export type CountryAtlasScale = 0.5 | 0.375 | 0.25 | 0.125 | 0.0625;

export type CountryAtlasDistrictDto = {
  id: string;
  name: string;
  status: DistrictDto["status"];
  color: string;
  progress: number;
  sourceCenter: { x: number; y: number };
  sourceBounds: Rect;
  atlasCenter: Cell;
  atlasCells: Cell[];
  displayCells: Cell[];
};

export type CountryAtlasBuildingDto = {
  id: string;
  taskNumber: number;
  districtId: string;
  title: string;
  workItemType: WorkItemType;
  status: TaskDto["status"];
  progress: number;
  stage: number;
  buildingType: string;
  visualKind: TaskDto["visualKind"];
  visualAssetKey: string;
  platformType: PlatformKind;
  sourceOrigin: Cell;
  atlasOrigin: Cell;
  atlasFootprint: Cell[];
};

export type CountryAtlasRoadDto = {
  sourceCell: Cell;
  atlasCell: Cell;
  structure: RoadCellDto["structure"];
  roadClass: RoadCellDto["roadClass"];
};

export type CountryAtlasSurfaceDto = {
  sourceCell: Cell;
  atlasCell: Cell;
  kind: SurfaceCellDto["kind"];
  orientation?: SurfaceCellDto["orientation"];
  finish?: SurfaceCellDto["finish"];
};

export type CountryAtlasFeatureDto = {
  id: string;
  districtId: string | null;
  assetKind: WorldFeatureDto["assetKind"];
  assetKey: string;
  developmentStage: WorldFeatureDto["developmentStage"];
  sourceOrigin: Cell;
  atlasOrigin: Cell;
  atlasFootprint: Cell[];
};

export type CountryAtlasTerrainCellDto = {
  atlasCell: Cell;
  sourceCell: Cell;
  terrain: TerrainKind;
  variant: number;
};

export type CountryAtlasMacroTerrainDto = {
  id: string;
  atlasOrigin: Cell;
  widthCells: number;
  heightCells: number;
  atlasCenter: { x: number; y: number };
  sourceCenter: Cell;
  terrain: TerrainKind;
  variant: number;
};

export type CountryAtlasCityDto = {
  id: string;
  name: string;
  status: CityDto["status"];
  sourceCenter: Cell;
  sourceBounds: Rect;
  atlasCenter: Cell;
  atlasBounds: Rect;
  labelBounds: Rect;
  labelAnchor: Cell;
  scale: CountryAtlasScale;
  miniatureSizePx: { width: number; height: number };
  atlasMask: Cell[];
  cutoutMask: Cell[];
  districts: CountryAtlasDistrictDto[];
  buildings: CountryAtlasBuildingDto[];
  roads: CountryAtlasRoadDto[];
  surfaces: CountryAtlasSurfaceDto[];
  features: CountryAtlasFeatureDto[];
};

export type CountryAtlasDto = {
  schemaVersion: typeof COUNTRY_ATLAS_SCHEMA_VERSION;
  worldVersion: number;
  terrainSeed: number;
  bounds: Rect;
  cities: CountryAtlasCityDto[];
  connections: Array<{ fromCityId: string; toCityId: string; path: Cell[] }>;
};
