import { useEffect, useMemo, useRef, useState } from "react";
import "pixi.js/unsafe-eval";
import { Application, Assets, Cache, Container, FederatedPointerEvent, Graphics, Rectangle, Sprite, Text, TextStyle, Texture } from "pixi.js";
import { PROP_ATLAS, PROP_CATALOG, PROP_SPRITES, TILE_SPRITES, gameAssetUrl, getBuilding, illuminatedPropKey } from "../../shared/catalog";
import { MICRO_ANIMAL_SPECIES, microAmbientAssetUrls, microAmbientSprite } from "../../shared/micro-ambient";
import { microIncidentResponder } from "../micro-incident-responder";
import { roadBandRole, roadMarkingAxis } from "../../shared/road-profile";
import {
  roadAtlasConnectionMask,
  roadAtlasOverlayTile,
  roadAtlasSurfaceTile,
  roadAtlasTile,
  type RoadAtlasOverlay,
  type RoadAtlasSurface,
} from "../../shared/road-atlas";
import type { BootstrapDto, Cell, ChunkDistrictDto, ChunkDto, ChunkPayloadDto, ChunkTaskDto, PlannedSiteDto, Rect, RoadCellDto, SurfaceCellDto, ViewportPayloadDto, WorldFeatureDto, WorldManifestDto } from "../../shared/contracts";
import { CITY_SCENE_SCHEMA_VERSION, type CitySceneDto } from "../../shared/city-scene-contract";
import { loadCityScene } from "../map-scene-cache";
import { isBuildableTerrain, terrainAt } from "../../shared/world-terrain";
import { encodeTerrainSample } from "../../shared/world-chunk-payload";
import { apiWithMetrics, type ApiResult } from "../api";
import { ChunkMaterializer } from "../chunk-materializer";
import { patchChunkPayloadTaskStatuses, patchChunkTaskStatuses, type ChunkTaskStatusPatch } from "../chunk-task-patches";
import { loadGameAssets } from "../game-asset-loader";
import { AssetLease, leasedAssetCount } from "../asset-lease-registry";
import { mapInvalidationAffectsCity, mapInvalidationImpact, type MapInvalidation } from "../map-invalidation";
import { CoalescedRefresh } from "../coalesced-refresh";
import { drainGroundBakeFrame, INITIAL_GROUND_BAKE_BUDGET_MS, type GroundBakeWork } from "../ground-bake-budget";
import { createGroundTerrainSampler } from "../ground-terrain-sampler";
import { CityRoadPadding, type CityRoadPaddingChunk } from "../city-road-padding";
import { CityTerrainPadding, type TerrainGroundChunk } from "../city-terrain-padding";
import { GroundTextureBaker } from "../ground-texture-baker";
import { CityTreePadding } from "../city-tree-padding";
import { retryFailedPadding } from "../padding-retry";
import { IMMEDIATE_PADDING_CELL_LIMIT, planImmediatePadding } from "../immediate-padding-plan";
import { createDistrictTerritory } from "../district-territory";
import { RollingPerformanceMetric } from "../rolling-performance-metric";
import { nextSeededRandom, nextWithoutUTurn, planAgentRoute } from "../agent-routing";
import { createCityMobility } from "../city-mobility";
import { buildCityWalkNetwork } from "../city-walk-network";
import { placeCityMobilitySignalPosts } from "../city-mobility-signal-posts";
import { reconcileEntityViews, type EntityViewRecord } from "../entity-reconciler";
import { incidentMode, incidentRenderSignature, incidentVisualLayout, incidentVisualProfile, incidentWaterJetFrame, incidentWaterTargetFrame, planIncidentEngines, type IncidentMode, type IncidentVisualProfile } from "../task-incidents";
import { INCIDENT_FRAME_MS, incidentBadge, incidentEffectPixels } from "../incident-pixels";
import { siteMarkerPresentation, siteRubbleLayout } from "../site-marker-presentation";
import { cityMicroFlightRoutes, cityMicroFlightPosition, cityMicroFlightDuration, cityMicroFlightIsCurrent, type CityMicroFlightRoute } from "../city-micro-flights";
import {
  chunkRangeForViewport,
  cameraTerrainPadding,
  progressiveChunkPlan,
  clampCameraPosition,
  fitCameraScale,
  CITY_CAMERA_MIN_SCALE,
  cityDetailFocusBounds,
  nextCameraTargetScale,
  pixelPerfectCameraScale,
  smoothCameraScale,
} from "../world-camera";
import type { AtlasWheelNavigation } from "../atlas-zoom-navigation";
import { WORLD_LAYER_ORDER, type WorldLayerName } from "../world-layer-order";
import { readWorldLighting } from "../world-light-clock";
import {
  buildingBadgePresentation,
  buildingInteractiveBounds,
  buildingPlatformPresentation,
  taskPlatformCellPresentation,
  taskPlatformCells,
} from "../world-building-presentation";
import { residentGroundPosition } from "../resident-presentation";
import { SEED_TERRAIN_COLORS, seedTerrainCellPresentation } from "../seed-terrain-presentation";
import { compareWorldObjects, type WorldObjectKind } from "../world-object-depth";
import { overviewFromDetailChunk } from "../world-chunk-cache";
import { greenAreaDecorStage, greenAreaSurfaceLayout, type GreenAreaDevelopmentStage } from "../../shared/green-area";
import { taskParkDecorLayout, taskParkingMarkings } from "../../shared/task-park";
import { publicSpaceRenderStage } from "../../shared/public-space-stage";
import type { BlockPlaqueDto } from "../../shared/contracts";
import {
  CONSTRUCTION_DETAIL_SPEC_BY_KEY,
  CONSTRUCTION_TILE_KEYS,
  constructionStageLayout,
  type ConstructionDetailPlacement,
  type ConstructionTile,
} from "../../shared/construction-stage";
import { atlasTerrainConnectionMask, atlasTerrainKindFromWorld, atlasTerrainTile, type AtlasTerrainKind } from "../../shared/atlas-scene";
import { bindMapPointerGestures } from "../map-pointer-gesture";
import { decorationWorldAnchor } from "../decoration-placement";
import { pixelAtlasFrame } from "../pixel-atlas-frame";
import { stopPixiApplication } from "../pixi-app-lifecycle";

const CELL_SIZE = 8;
const DETAIL_LOD_SCALE = 1;
const DETAIL_LOD_ENTER_SCALE = 1;
const DETAIL_LOD_EXIT_SCALE = 1;
// JSON and PNG decoding are deliberately separate pipelines. Holding a chunk
// request slot while Pixi downloads sprites made every slow image stall all
// following chunks in waves of three.
const CHUNK_FETCH_CONCURRENCY = 8;
const CHUNK_ASSET_CONCURRENCY = 6;
const CHUNK_DATA_CACHE_LIMIT = 48;
const CHUNK_PAYLOAD_CACHE_LIMIT = 160;
const OVERVIEW_GROUND_TEXTURE_RESOLUTION = 0.5;
const GROUND_CACHE_LIMIT = 48;
// Ultra-wide overview cameras can keep more than the base GPU-cache budget
// visible at once. Bake those large offscreen surfaces at one pixel per eight
// source pixels; nearest-neighbour upscaling preserves the pixel-art contract
// while keeping the coherent LOD swap bounded on low-throughput GPUs.
const ULTRA_WIDE_GROUND_TEXTURE_RESOLUTION = 0.125;
const TASK_STATUS_PATCH_LIMIT = 512;
type MapLod = "DETAIL" | "OVERVIEW";
const GROUND_PRESERVING_EVENTS = new Set([
  "task.fields_updated", "task.renamed", "task.defect_created", "task.defect_updated",
  "city.updated", "city.renamed", "district.updated", "district.renamed",
  "district.activated", "district.completed",
  "archive.record_created", "archive.record_deleted",
]);
type FocusArea = { point: Cell; bounds: Rect };
function buildingFocusArea(origin: Cell): FocusArea {
  return {
    point: origin,
    bounds: { minX: origin.x - 14, minY: origin.y - 14, maxX: origin.x + 14, maxY: origin.y + 14 },
  };
}
type IncidentView = {
  signature: string;
  container: Container;
  mode: IncidentMode;
  profile: IncidentVisualProfile;
  fullResponse: boolean;
  flames: Array<{ frameA: Graphics; frameB: Graphics }>;
  smokePlumes: Array<{ frameA: Graphics; frameB: Graphics }>;
  beacon: Graphics;
  water: Graphics;
  waterJet: { source: { x: number; y: number }; targets: Array<{ x: number; y: number }>; targetIndex: number };
  phaseMs: number;
  animationFrame: number;
};
type WorldRuntime = {
  setActive(active: boolean): void;
  focus(area: FocusArea): void;
  invalidateBatch(events: readonly MapInvalidation[]): void;
  retry(): void;
  setViewBounds(bounds: Rect): void;
};

function exposeRollingMetric(
  host: HTMLDivElement,
  prefix: string,
  metric: RollingPerformanceMetric,
  value: number,
  unit: "Ms" | "Bytes" = "Ms",
): void {
  const snapshot = metric.record(value);
  const format = (sample: number) => unit === "Bytes" ? String(Math.round(sample)) : sample.toFixed(1);
  host.dataset[`${prefix}${unit}`] = format(snapshot.last);
  host.dataset[`${prefix}Max${unit}`] = format(snapshot.max);
  host.dataset[`${prefix}P50${unit}`] = format(snapshot.p50);
  host.dataset[`${prefix}P95${unit}`] = format(snapshot.p95);
  host.dataset[`${prefix}P99${unit}`] = format(snapshot.p99);
  host.dataset[`${prefix}Samples`] = String(snapshot.samples);
}

const TERRAIN_COLORS = SEED_TERRAIN_COLORS;
const GRID_DIRECTIONS = [
  { x: 0, y: -1, bit: 1 }, { x: 1, y: 0, bit: 2 }, { x: 0, y: 1, bit: 4 }, { x: -1, y: 0, bit: 8 },
] as const;

const parkStage = publicSpaceRenderStage;

const TASK_STATUS_LABEL: Record<ChunkTaskDto["status"], string> = {
  PLANNING: "Планируется", STARTED: "Начата", IN_PROGRESS: "В работе", TESTING: "Проверяется", COMPLETED: "Завершена",
};

function position(cell: Cell): { x: number; y: number } {
  return { x: cell.x * CELL_SIZE, y: cell.y * CELL_SIZE };
}

function key(cell: Cell): string { return `${cell.x},${cell.y}`; }

function chunkKey(chunkX: number, chunkY: number): string { return `${chunkX},${chunkY}`; }

function concurrencyGate(limit: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const queue: Array<() => void> = [];
  const release = () => {
    active -= 1;
    queue.shift()?.();
  };
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= limit) await new Promise<void>((resolve) => queue.push(resolve));
    active += 1;
    try { return await task(); }
    finally { release(); }
  };
}

function loadTextureAssets(urls: string[]): Promise<void> {
  return loadGameAssets({
    load: (assets) => Assets.load(assets),
    add: (assets) => {
      for (const asset of assets) Assets.resolver.removeAlias(asset.alias);
      Assets.add(assets);
    },
  }, urls);
}

function cachedTexture(url: string): Texture | undefined {
  return Cache.has(url) ? Cache.get<Texture>(url) : undefined;
}

// A sheet frame is immutable and shared by every matching terrain or road cell. This
// bounds derived Pixi textures to the authored atlas vocabulary instead of
// allocating one wrapper per cell and per visited city.
const atlasFrameTextureCache = new Map<string, Texture>();

function atlasFrameTexture(url: string, sourceX: number, sourceY: number, size: number): Texture {
  const cacheKey = `${url}:${sourceX}:${sourceY}:${size}`;
  const cached = atlasFrameTextureCache.get(cacheKey);
  const sheet = cachedTexture(url);
  if (cached && sheet && cached.source === sheet.source) return cached;
  if (cached) atlasFrameTextureCache.delete(cacheKey);
  if (!sheet) return Texture.EMPTY;
  const texture = new Texture({
    source: sheet.source,
    frame: new Rectangle(sourceX, sourceY, size, size),
  });
  texture.source.scaleMode = "nearest";
  atlasFrameTextureCache.set(cacheKey, texture);
  return texture;
}

function sprite(url: string, x: number, y: number): Sprite {
  const result = new Sprite(cachedTexture(url) ?? Texture.EMPTY);
  result.texture.source.scaleMode = "nearest";
  result.position.set(x, y);
  return result;
}

function terrainSprite(cell: ChunkDto["terrain"][number], terrainAtCell: (column: number, row: number) => AtlasTerrainKind | undefined): Sprite {
  const kind = atlasTerrainKindFromWorld(cell.terrain);
  const tile = atlasTerrainTile(kind, "city", cell.x, cell.y, atlasTerrainConnectionMask(kind, cell.x, cell.y, terrainAtCell));
  const texture = atlasFrameTexture(gameAssetUrl(tile.url), tile.sourceX, tile.sourceY, tile.tileSize);
  const p = position(cell);
  const result = new Sprite(texture);
  result.position.set(p.x, p.y);
  return result;
}

function atlasSprite(tile: { url: string; sourceX: number; sourceY: number; tileSize: number }, cell: Cell): Sprite {
  const p = position(cell);
  const result = new Sprite(atlasFrameTexture(gameAssetUrl(tile.url), tile.sourceX, tile.sourceY, tile.tileSize));
  result.position.set(p.x, p.y);
  return result;
}

type SurfacePlacement = Cell & { family: RoadAtlasSurface };
type TerrainPlacement = Cell & { kind: AtlasTerrainKind };

function addSurfacePlacements(group: Container, placements: SurfacePlacement[]): void {
  const families = new Map(placements.map((cell) => [key(cell), cell.family]));
  const unique = new Map(placements.map((cell) => [key(cell), cell]));
  for (const cell of unique.values()) {
    const mask = roadAtlasConnectionMask(cell.family, cell.x, cell.y, (column, row) => families.get(key({ x: column, y: row })));
    group.addChild(atlasSprite(roadAtlasSurfaceTile(cell.family, cell.x, cell.y, mask), cell));
  }
}

function addTerrainPlacements(group: Container, placements: TerrainPlacement[]): void {
  const kinds = new Map(placements.map((cell) => [key(cell), cell.kind]));
  for (const cell of placements) {
    const mask = atlasTerrainConnectionMask(cell.kind, cell.x, cell.y, (column, row) => kinds.get(key({ x: column, y: row })));
    const tile = atlasTerrainTile(cell.kind, "city", cell.x, cell.y, mask);
    group.addChild(atlasSprite(tile, cell));
  }
}

function surfaceAtlasFamily(cell: SurfaceCellDto): RoadAtlasSurface | undefined {
  if (cell.kind === "SIDEWALK") return "PAVEMENT";
  if (cell.kind === "DRIVEWAY") return "DRIVEWAY";
  if (cell.kind === "PATH") {
    if (cell.finish === "PAVERS") return "PATH_PAVERS";
    if (cell.finish === "ASPHALT") return "PATH_ASPHALT";
    return "PATH_EARTH";
  }
  return undefined;
}

function drawSurface(cell: SurfaceCellDto, surfaces: Map<string, SurfaceCellDto>): Sprite | undefined {
  const family = surfaceAtlasFamily(cell);
  if (!family) return undefined;
  const mask = roadAtlasConnectionMask(family, cell.x, cell.y, (column, row) => {
    const neighbor = surfaces.get(key({ x: column, y: row }));
    return neighbor ? surfaceAtlasFamily(neighbor) : undefined;
  });
  return atlasSprite(roadAtlasSurfaceTile(family, cell.x, cell.y, mask), cell);
}

function drawRoad(cell: RoadCellDto, surfaces: Map<string, SurfaceCellDto>, roads: Map<string, RoadCellDto>): Container {
  const group = new Container();
  group.addChild(atlasSprite(roadAtlasTile(cell), cell));
  const addOverlay = (kind: RoadAtlasOverlay) => group.addChild(atlasSprite(roadAtlasOverlayTile(kind, cell.x, cell.y), cell));
  const crossing = surfaces.get(key(cell));
  if (crossing?.kind === "CROSSWALK") {
    addOverlay(crossing.orientation === "V" ? "CROSSWALK_V" : "CROSSWALK_H");
  } else {
    const markingAxis = roadMarkingAxis(roads, cell);
    if (markingAxis) addOverlay(markingAxis === "H" ? "MARKING_H" : "MARKING_V");
  }
  const directionNames = ["N", "E", "S", "W"] as const;
  for (let direction = 0; direction < GRID_DIRECTIONS.length; direction += 1) {
    const config = GRID_DIRECTIONS[direction]!;
    const directionName = directionNames[direction]!;
    const neighborRoad = roads.get(key({ x: cell.x + config.x, y: cell.y + config.y }));
    if (cell.structure === "ROAD" && neighborRoad?.structure === "BRIDGE") {
      addOverlay(`BRIDGE_PORTAL_${directionName}`);
    }
    if (cell.mask & config.bit) continue;
    if (cell.structure === "BRIDGE") addOverlay(`BRIDGE_RAIL_${directionName}`);
  }
  return group;
}

function drawDistrictBoundary(district: ChunkDistrictDto, tooltipLayer: Container): Container {
  const group = new Container();
  group.eventMode = "static";
  group.cursor = "help";
  const territory = createDistrictTerritory(district.cells, CELL_SIZE);
  group.hitArea = territory;
  group.interactiveChildren = false;
  const graphics = new Graphics();
  const hit = new Graphics();
  const cells = new Set(district.cells.map(key));
  const color = Number.parseInt(district.color.slice(1), 16);
  for (const cell of district.cells) {
    const p = position(cell);
    hit.rect(p.x, p.y, CELL_SIZE, CELL_SIZE);
    for (let direction = 0; direction < GRID_DIRECTIONS.length; direction += 1) {
      const delta = GRID_DIRECTIONS[direction]!;
      if (cells.has(key({ x: cell.x + delta.x, y: cell.y + delta.y }))) continue;
      if (direction === 0) graphics.moveTo(p.x, p.y).lineTo(p.x + CELL_SIZE, p.y);
      else if (direction === 1) graphics.moveTo(p.x + CELL_SIZE, p.y).lineTo(p.x + CELL_SIZE, p.y + CELL_SIZE);
      else if (direction === 2) graphics.moveTo(p.x, p.y + CELL_SIZE).lineTo(p.x + CELL_SIZE, p.y + CELL_SIZE);
      else graphics.moveTo(p.x, p.y).lineTo(p.x, p.y + CELL_SIZE);
    }
  }
  graphics.stroke({ color, width: district.status === "ACTIVE" ? 2.6 : 1.2, alpha: district.status === "ACTIVE" ? 1 : 0.62, cap: "square" });
  hit.fill({ color, alpha: 0.001 });
  group.addChild(hit, graphics);
  if (district.status === "ACTIVE" && district.cells.length > 0) {
    const markerCell = district.cells.reduce((best, cell) => cell.y < best.y || cell.y === best.y && cell.x < best.x ? cell : best, district.cells[0]!);
    const marker = sprite(PROP_SPRITES["active-district-flag"]!, markerCell.x * CELL_SIZE + CELL_SIZE / 2, markerCell.y * CELL_SIZE + CELL_SIZE);
    marker.anchor.set(0.5, 1);
    group.addChild(marker);
  }
  let tooltip: Container | undefined;
  let tooltipHeight = 0;
  const showTooltip = (event: FederatedPointerEvent) => {
    const point = event.getLocalPosition(group);
    const anchor = territory.anchorAt(point.x, point.y);
    if (!anchor) { if (tooltip) tooltip.visible = false; return; }
    if (!tooltip) {
      const deadline = district.deadline ? `\nДедлайн: ${new Date(district.deadline).toLocaleDateString("ru-RU")}` : "\nДедлайн не задан";
      const label = new Text({
        text: `${district.name}${deadline}`, resolution: 4,
        style: new TextStyle({ fontFamily: "Arial, sans-serif", fontSize: 8, fontWeight: "700", lineHeight: 11, fill: 0xf2f5ed }),
      });
      const panel = new Graphics().roundRect(-5, -5, label.width + 10, label.height + 10, 3)
        .fill({ color: 0x0b181b, alpha: 0.96 }).stroke({ color, width: 1 });
      tooltip = new Container(); tooltip.eventMode = "none"; tooltip.addChild(panel, label);
      tooltipHeight = label.height;
      tooltipLayer.addChild(tooltip);
    }
    tooltip.position.set(anchor.x * CELL_SIZE, anchor.y * CELL_SIZE - tooltipHeight - 12);
    tooltip.visible = true;
  };
  group.on("pointerover", showTooltip);
  group.on("pointermove", showTooltip);
  group.on("pointerout", () => { if (tooltip) tooltip.visible = false; });
  group.once("destroyed", () => {
    if (!tooltip?.destroyed) {
      tooltip?.removeFromParent();
      tooltip?.destroy({ children: true });
    }
  });
  return group;
}

function drawAreaPlatform(footprint: Cell[], stage: GreenAreaDevelopmentStage, assetKey: string): Container {
  const group = new Container();
  const surfaces: SurfacePlacement[] = [];
  const terrain: TerrainPlacement[] = [];
  for (const { x, y, role } of greenAreaSurfaceLayout(footprint, stage, assetKey)) {
    if (role === "BOUNDARY") surfaces.push({ x, y, family: "PAVEMENT" });
    else if (role === "PATH") surfaces.push({ x, y, family: "PATH_PAVERS" });
    else if (role === "PARKING") surfaces.push({ x, y, family: "DRIVEWAY" });
    else if (role === "BASIN" || role === "EARTH") surfaces.push({ x, y, family: "PATH_EARTH" });
    else terrain.push({ x, y, kind: role === "WATER" ? "shallow_water" : "meadow" });
  }
  addTerrainPlacements(group, terrain);
  addSurfacePlacements(group, surfaces);
  return group;
}

function drawPlatform(task: ChunkTaskDto): Container {
  const group = new Container();
  const surfaces: SurfacePlacement[] = [];
  const terrain: TerrainPlacement[] = [];
  if (task.visualKind === "PARK") {
    return drawAreaPlatform(task.footprint, parkStage(task.stage), task.visualAssetKey);
  }
  const entry = getBuilding(task.buildingType);
  for (const cell of taskPlatformCells(task.footprint, task.stage)) {
    const presentation = taskPlatformCellPresentation(entry);
    if (presentation.family === "surface") surfaces.push({ ...cell, family: presentation.key });
    else terrain.push({ ...cell, kind: atlasTerrainKindFromWorld(presentation.key) });
  }
  addTerrainPlacements(group, terrain);
  addSurfacePlacements(group, surfaces);
  return group;
}

function updateParkLighting(view: Container, night: boolean): void {
  if (view.label?.startsWith("park-light:")) {
    const kind = view.label.slice("park-light:".length);
    const texture = cachedTexture(PROP_CATALOG[night ? illuminatedPropKey(kind) : kind]!.path);
    if (view instanceof Sprite && texture) view.texture = texture;
  } else if (view.label === "park-light-pool") view.alpha = night ? 1 : 0;
  for (const child of view.children) updateParkLighting(child, night);
}

function drawTaskPark(task: ChunkTaskDto, onSelect: (taskId: string) => void, tooltipLayer: Container): Container {
  const group = new Container();
  const bounds = {
    minX: Math.min(...task.footprint.map((cell) => cell.x)), maxX: Math.max(...task.footprint.map((cell) => cell.x)),
    minY: Math.min(...task.footprint.map((cell) => cell.y)), maxY: Math.max(...task.footprint.map((cell) => cell.y)),
  };
  const width = (bounds.maxX - bounds.minX + 1) * CELL_SIZE;
  const height = (bounds.maxY - bounds.minY + 1) * CELL_SIZE;
  // Root.y is the ground contact for global world sorting, like buildings and
  // permanent sites. Keep authored content in unchanged north-west coordinates.
  group.position.set(bounds.minX * CELL_SIZE, bounds.minY * CELL_SIZE + height);
  const content = new Container(); content.y = -height; group.addChild(content);
  group.eventMode = "static";
  group.cursor = "pointer";
  group.hitArea = new Rectangle(0, -height, width, height);
  if (parkStage(task.stage) < 5) {
    // Public-space works stay inside their ground parcel, including1-cell strips.
    content.addChild(new Graphics().rect(0.5, 0.5, width - 1, height - 1)
      .stroke({ color: 0xc7b782, width: 1 }));
  }
  const decor = taskParkDecorLayout(task.footprint, parkStage(task.stage), task.visualAssetKey, task.taskNumber)
    .sort((left, right) => left.origin.y + left.height - right.origin.y - right.height || left.origin.x - right.origin.x);
  for (const placement of decor) {
    const metadata = PROP_CATALOG[placement.kind];
    if (!metadata) continue;
    const view = sprite(
      metadata.path,
      (placement.origin.x - bounds.minX) * CELL_SIZE + metadata.footprint.width * CELL_SIZE / 2,
      (placement.origin.y - bounds.minY + metadata.footprint.height) * CELL_SIZE,
    );
    view.anchor.set(metadata.anchor.x / metadata.size.width, metadata.anchor.y / metadata.size.height);
    if (illuminatedPropKey(placement.kind) !== placement.kind) {
      view.label = `park-light:${placement.kind}`;
      const pool = new Graphics(); pool.label = "park-light-pool"; pool.eventMode = "none";
      const x = Math.max(0, view.x - 7), y = Math.max(0, view.y - 4);
      pool.rect(x, y, Math.min(14, width - x), Math.min(8, height - y)).fill({ color: 0xffdc8f, alpha: .3 });
      content.addChildAt(pool, 0);
    }
    content.addChild(view);
  }
  updateParkLighting(content, readWorldLighting().lamps >= .4);
  if (task.visualAssetKey === "urban-parking") {
    const paint = new Graphics();
    for (const line of taskParkingMarkings(task.footprint, parkStage(task.stage))) paint.rect(line.x, line.y, line.width, line.height).fill(0xd1c69b);
    content.addChild(paint);
  }
  const badge = buildingBadgePresentation(task.taskNumber, task.stage);
  // A one-cell planting strip remains clickable, but its number must not
  // cover a neighbouring parcel. The hover tooltip retains the full identity.
  if (width >= badge.width + 4 && height >= badge.height + 4) {
    const badgeX = width - badge.width / 2 - 2;
    const badgeY = height - badge.height / 2 - 2;
    content.addChild(new Graphics()
      .roundRect(badgeX - badge.width / 2, badgeY - badge.height / 2, badge.width, badge.height, 1)
      .fill(0x0b171a).stroke({ color: badge.borderColor, width: 1 }));
    const label = new Text({ text: badge.label, resolution: 4, style: new TextStyle({ fontFamily: "Arial, sans-serif", fontSize: badge.fontSize, fontWeight: "900", fill: 0xffffff }) });
    label.anchor.set(0.5); label.position.set(badgeX, badgeY); content.addChild(label);
  }
  let tooltip: Container | undefined;
  group.on("pointerover", () => {
    if (!tooltip) {
      const text = new Text({
        text: `#${task.taskNumber} · ${task.title}\n${TASK_STATUS_LABEL[task.status]} · ${task.progress}%`, resolution: 4,
        style: new TextStyle({ fontFamily: "Arial, sans-serif", fontSize: 8, fontWeight: "600", lineHeight: 11, fill: 0xeaf2ee, wordWrap: true, wordWrapWidth: 144 }),
      });
      const panel = new Graphics().roundRect(-5, -5, text.width + 10, text.height + 10, 3)
        .fill({ color: 0x0b181b, alpha: 0.96 }).stroke({ color: 0x69ad67, width: 1 });
      tooltip = new Container(); tooltip.eventMode = "none"; tooltip.addChild(panel, text);
      tooltip.position.set(group.position.x + width / 2 - text.width / 2, group.position.y - height - text.height - 8);
      tooltipLayer.addChild(tooltip);
    }
    tooltip.visible = true;
  });
  group.on("pointerout", () => { if (tooltip) tooltip.visible = false; });
  group.once("destroyed", () => {
    if (!tooltip?.destroyed) { tooltip?.removeFromParent(); tooltip?.destroy({ children: true }); }
  });
  group.on("pointertap", (event: FederatedPointerEvent) => { event.stopPropagation(); onSelect(task.id); });
  return group;
}

function drawConstructionTiles(tiles: ConstructionTile[], footprintWidth: number): Container {
  const group = new Container();
  const left = -footprintWidth * CELL_SIZE / 2;
  for (const tile of tiles) {
    const view = sprite(TILE_SPRITES[tile.key]!, left + tile.x * CELL_SIZE + CELL_SIZE / 2, tile.y * CELL_SIZE + CELL_SIZE / 2);
    view.anchor.set(0.5);
    view.rotation = (tile.quarterTurns ?? 0) * Math.PI / 2;
    group.addChild(view);
  }
  return group;
}

function drawConstructionDetails(details: ConstructionDetailPlacement[], footprintWidth: number): Container {
  const group = new Container();
  const left = -footprintWidth * CELL_SIZE / 2;
  for (const detail of details) {
    const spec = CONSTRUCTION_DETAIL_SPEC_BY_KEY[detail.key];
    const view = sprite(
      PROP_SPRITES[detail.key]!,
      left + (detail.x + spec.footprint.width / 2) * CELL_SIZE,
      (detail.y + spec.footprint.height) * CELL_SIZE,
    );
    view.anchor.set(0.5, 1);
    group.addChild(view);
  }
  return group;
}

function drawBuilding(task: ChunkTaskDto, onSelect: (taskId: string) => void, tooltipLayer: Container): Container {
  if (task.visualKind === "PARK") return drawTaskPark(task, onSelect, tooltipLayer);
  const entry = getBuilding(task.buildingType);
  const group = new Container();
  group.eventMode = "static";
  group.cursor = "pointer";
  const entranceOffset = entry.entrances[0]?.offset ?? Math.floor(entry.footprint.width / 2);
  const construction = constructionStageLayout(entry.footprint, entranceOffset, task.stage, task.taskNumber);
  const building = task.stage <= 2 ? null : sprite(entry.stages[task.stage - 1]!, 0, 0);
  building?.anchor.set(0.5, 1);
  const x = task.origin.x * CELL_SIZE + entry.footprint.width * CELL_SIZE / 2;
  const y = task.origin.y * CELL_SIZE + entry.footprint.height * CELL_SIZE;
  group.position.set(x, y);
  const interactive = buildingInteractiveBounds(entry, task.stage, construction.padDepth, CELL_SIZE);
  const visualHeight = -interactive.y;
  group.hitArea = new Rectangle(interactive.x, interactive.y, interactive.width, interactive.height);
  group.addChild(drawConstructionTiles(construction.rearFence, entry.footprint.width));
  if (task.stage <= 2) {
    group.addChild(drawConstructionTiles(construction.site, entry.footprint.width));
    group.addChild(drawConstructionDetails(construction.details, entry.footprint.width));
  }
  else if (building) group.addChild(building);
  group.addChild(drawConstructionTiles(construction.frontFence, entry.footprint.width));
  {
    const badge = buildingBadgePresentation(task.taskNumber, task.stage);
    const badgeX = entry.spriteSize.width / 2 - badge.width / 2;
    const badgeY = -badge.height / 2;
    group.addChild(new Graphics()
      .roundRect(badgeX - badge.width / 2, badgeY - badge.height / 2, badge.width, badge.height, 1)
      .fill(0x0b171a)
      .stroke({ color: badge.borderColor, width: 1 }));
    const label = new Text({ text: badge.label, resolution: 4, style: new TextStyle({ fontFamily: "Arial, sans-serif", fontSize: badge.fontSize, fontWeight: "900", fill: 0xffffff }) });
    label.anchor.set(0.5); label.position.set(badgeX, badgeY); group.addChild(label);
  }
  let tooltip: Container | undefined;
  group.on("pointerover", () => {
    if (!tooltip) {
      // Compact card: task number + title, then stage and progress. The
      // long description preview used to turn dense districts into walls of
      // overlapping text; details live in the task modal one tap away.
      tooltip = new Container();
      tooltip.eventMode = "none";
      const tooltipText = new Text({
        text: `#${task.taskNumber} · ${task.title}\n${TASK_STATUS_LABEL[task.status]} · ${task.progress}%`,
        resolution: 4,
        style: new TextStyle({ fontFamily: "Arial, sans-serif", fontSize: 8, fontWeight: "600", lineHeight: 11, fill: 0xeaf2ee, wordWrap: true, wordWrapWidth: 144 }),
      });
      const padding = 5;
      const panel = new Graphics().roundRect(-padding, -padding, tooltipText.width + padding * 2, tooltipText.height + padding * 2, 3)
        .fill({ color: 0x0b181b, alpha: 0.96 }).stroke({ color: 0x4b6870, width: 1 });
      tooltip.addChild(panel, tooltipText);
      tooltip.position.set(
        group.position.x - tooltipText.width / 2,
        group.position.y - visualHeight - tooltipText.height - 8,
      );
      tooltipLayer.addChild(tooltip);
    }
    tooltip.visible = true;
  });
  group.on("pointerout", () => { if (tooltip) tooltip.visible = false; });
  group.once("destroyed", () => {
    if (!tooltip?.destroyed) {
      tooltip?.removeFromParent();
      tooltip?.destroy({ children: true });
    }
  });
  group.on("pointertap", (event: FederatedPointerEvent) => { event.stopPropagation(); onSelect(task.id); });
  return group;
}

function drawOverviewBuilding(task: ChunkTaskDto, onSelect: (taskId: string) => void): Container {
  const entry = getBuilding(task.buildingType);
  const group = new Container();
  group.eventMode = "static";
  group.cursor = "pointer";
  const colors = { HOUSE: 0xd0b27a, HIGHRISE: 0x6aa5b6, COMMERCIAL: 0xb9825e, CIVIC: 0xd2c8a8 } as const;
  const width = Math.max(CELL_SIZE, entry.footprint.width * CELL_SIZE - 2);
  const height = Math.max(CELL_SIZE, entry.footprint.height * CELL_SIZE - 2);
  group.position.set(task.origin.x * CELL_SIZE + 1, task.origin.y * CELL_SIZE + 1);
  group.hitArea = new Rectangle(0, 0, width, height);
  const fill = task.visualKind === "PARK" ? 0x638c4d : colors[entry.category];
  group.addChild(new Graphics().rect(0, 0, width, height).fill(fill).stroke({ color: 0x263945, width: 2 }));
  if (task.visualKind === "PARK") {
    group.addChild(new Graphics()
      .rect(Math.floor(width / 2) - 1, 1, 2, height - 2)
      .rect(1, Math.floor(height / 2) - 1, width - 2, 2)
      .fill(0xb7b8a2));
  }
  const progressWidth = Math.max(2, Math.floor((width - 2) * task.progress / 100));
  group.addChild(new Graphics().rect(1, height - 3, progressWidth, 2).fill(task.status === "COMPLETED" ? 0x69ad67 : 0xf2c84b));
  group.on("pointertap", (event: FederatedPointerEvent) => { event.stopPropagation(); onSelect(task.id); });
  return group;
}

function drawDecoration(decoration: ChunkDto["decorations"][number]): Sprite | null {
  const metadata = PROP_CATALOG[decoration.kind];
  if (!metadata) return null;
  const anchor = decorationWorldAnchor(decoration.kind, decoration.origin, metadata.footprint, CELL_SIZE);
  const result = sprite(
    metadata.path,
    anchor.x,
    anchor.y,
  );
  result.anchor.set(metadata.anchor.x / metadata.size.width, metadata.anchor.y / metadata.size.height);
  return result;
}

function isAnimatedDecoration(kind: string): boolean {
  return kind.startsWith("boat-");
}

function staticDecorationRenderSignature(decorations: Iterable<ChunkDto["decorations"][number]>): string {
  let primary = 0x811c9dc5;
  let secondary = 0x9e3779b9;
  let count = 0;
  const mix = (value: number) => {
    primary = Math.imul(primary ^ value, 0x01000193) >>> 0;
    secondary = Math.imul(secondary ^ value, 0x85ebca6b) >>> 0;
  };
  for (const decoration of decorations) {
    count += 1;
    for (const char of `${decoration.id}\u0000${decoration.kind}`) mix(char.charCodeAt(0));
    mix(decoration.origin.x);
    mix(decoration.origin.y);
  }
  return `${count}:${primary}:${secondary}`;
}

function drawWorldFeature(
  feature: WorldFeatureDto,
  includePlatform: boolean,
  onArchiveSelect: () => void,
  onSiteSelect: (feature: WorldFeatureDto) => void,
  parent?: WorldFeatureDto,
): { platform?: Container; visual?: Container } | null {
  if (!includePlatform) return null;
  if (feature.kind === "RUIN") {
    if (feature.footprint.length === 0) return null;
    const visual = new Container();
    const width = (Math.max(...feature.footprint.map((cell) => cell.x)) - feature.origin.x + 1) * CELL_SIZE;
    const height = (Math.max(...feature.footprint.map((cell) => cell.y)) - feature.origin.y + 1) * CELL_SIZE;
    // Depth sorting uses ground contact, exactly as buildings and props do.
    // Keep drawing coordinates top-left inside a bottom-anchored root.
    visual.position.set(feature.origin.x * CELL_SIZE, feature.origin.y * CELL_SIZE + height);
    const content = new Container(); content.y = -height; visual.addChild(content);
    const foundation = new Graphics();
    for (const [x, y] of [[1, 1], [width - 6, 1], [1, height - 6], [width - 6, height - 6]]) {
      foundation.rect(x!, y!, 5, 1).rect(x!, y!, 1, 5).fill(0x8c9270);
    }
    content.addChild(foundation);
    for (const { key, x, y } of siteRubbleLayout(width, height, feature.siteMarker?.variant ?? "brick")) {
      const rubble = sprite(PROP_SPRITES[key]!, x, y); rubble.anchor.set(0.5, 1); content.addChild(rubble);
    }
    if (feature.siteMarker) {
      const presentation = siteMarkerPresentation(feature.siteMarker);
      const text = new Text({ text: presentation.badge, resolution: 2, style: { fontFamily: "monospace", fontSize: 6, fontWeight: "bold", fill: presentation.color } });
      text.position.set(Math.round((width - text.width) / 2), Math.max(0, height - 8));
      const panel = new Graphics().rect(text.x - 2, text.y - 1, Math.ceil(text.width) + 4, 8).fill(0x30464c);
      content.addChild(panel, text);
      visual.eventMode = "static"; visual.cursor = "pointer";
      visual.hitArea = new Rectangle(0, -height, width, height);
      visual.on("pointertap", (event: FederatedPointerEvent) => { event.stopPropagation(); onSiteSelect(feature); });
    } else visual.eventMode = "none";
    return { visual };
  }
  if (feature.assetKind === "AREA") {
    return { platform: drawAreaPlatform(feature.footprint, feature.developmentStage, feature.assetKey) };
  }
  if (feature.assetKind === "PROP") {
    if (parent && parent.assetKind === "AREA" && parent.developmentStage < greenAreaDecorStage(feature.assetKey)) return null;
    const metadata = PROP_CATALOG[feature.assetKey];
    if (!metadata) return null;
    const prop = sprite(
      metadata.path,
      0, 0,
    );
    prop.anchor.set(metadata.anchor.x / metadata.size.width, metadata.anchor.y / metadata.size.height);
    const visual = new Container();
    visual.position.set(feature.origin.x * CELL_SIZE + metadata.footprint.width * CELL_SIZE / 2, feature.origin.y * CELL_SIZE + metadata.footprint.height * CELL_SIZE);
    visual.addChild(prop);
    if (feature.kind === "CITY_SIGN" && feature.label) {
      visual.eventMode = "static"; visual.cursor = "help";
      visual.hitArea = new Rectangle(-metadata.size.width / 2, -metadata.size.height, metadata.size.width, metadata.size.height);
      let tooltip: Container | undefined;
      visual.on("pointerover", () => {
        if (!tooltip) {
          const label = new Text({ text: feature.label!, resolution: 4, style: new TextStyle({ fontFamily: "Arial, sans-serif", fontSize: 8, fontWeight: "800", fill: 0xf2f5ed }) });
          const panel = new Graphics().roundRect(-5, -5, label.width + 10, label.height + 10, 3).fill({ color: 0x0b181b, alpha: 0.96 }).stroke({ color: 0x5ba6ca, width: 1 });
          tooltip = new Container(); tooltip.eventMode = "none"; tooltip.position.set(-label.width / 2, -metadata.size.height - label.height - 8); tooltip.addChild(panel, label); visual.addChild(tooltip);
        }
        tooltip.visible = true;
      });
      visual.on("pointerout", () => { if (tooltip) tooltip.visible = false; });
    }
    return { visual };
  }
  const entry = getBuilding(feature.assetKey);
  const platform = includePlatform ? new Container() : undefined;
  if (platform) {
    const presentation = buildingPlatformPresentation(entry.platform);
    if (presentation.family === "surface") {
      addSurfacePlacements(platform, feature.footprint.map((cell) => ({ ...cell, family: presentation.key })));
    } else {
      addTerrainPlacements(platform, feature.footprint.map((cell) => ({ ...cell, kind: atlasTerrainKindFromWorld(presentation.key) })));
    }
  }
  const visual = sprite(entry.stages[4]!, feature.origin.x * CELL_SIZE + entry.footprint.width * CELL_SIZE / 2, feature.origin.y * CELL_SIZE + entry.footprint.height * CELL_SIZE);
  visual.anchor.set(0.5, 1);
  if (feature.kind === "COUNTRY_ARCHIVE") {
    visual.eventMode = "static";
    visual.cursor = "pointer";
    visual.hitArea = new Rectangle(-entry.spriteSize.width / 2, -entry.spriteSize.height, entry.spriteSize.width, entry.spriteSize.height);
    let tooltip: Container | undefined;
    visual.on("pointerover", () => {
      if (!tooltip) {
        const label = new Text({ text: "Государственный архив", resolution: 4, style: new TextStyle({ fontFamily: "Arial, sans-serif", fontSize: 8, fontWeight: "800", fill: 0xf2f5ed }) });
        const panel = new Graphics().roundRect(-5, -5, label.width + 10, label.height + 10, 3).fill({ color: 0x0b181b, alpha: 0.96 }).stroke({ color: 0xd3ad58, width: 1 });
        tooltip = new Container();
        tooltip.eventMode = "none";
        tooltip.position.set(-label.width / 2, -entry.spriteSize.height - label.height - 8);
        tooltip.addChild(panel, label);
        visual.addChild(tooltip);
      }
      tooltip.visible = true;
    });
    visual.on("pointerout", () => { if (tooltip) tooltip.visible = false; });
    visual.on("pointertap", (event: FederatedPointerEvent) => { event.stopPropagation(); onArchiveSelect(); });
  }
  return { platform, visual };
}
function drawIncidentWaterJet(
  graphics: Graphics, source: { x: number; y: number }, target: { x: number; y: number },
  timeMs: number, phaseMs: number,
): void {
  const frame = incidentWaterJetFrame(source, target, timeMs, phaseMs);
  graphics.clear();
  for (const pixel of frame.core) graphics.rect(pixel.x, pixel.y, 1, 1);
  graphics.fill(0x4b9fb9);
  for (const pixel of frame.highlights) graphics.rect(pixel.x, pixel.y, 1, 1);
  graphics.fill(0xc3f2f5);
  for (const pixel of frame.spray) graphics.rect(pixel.x, pixel.y, 1, 1);
  graphics.fill(0x77cddd);
}

function drawTaskIncident(task: ChunkTaskDto, mode: Exclude<IncidentMode, "NONE">, signature: string, fullResponse: boolean): IncidentView {
  const entry = getBuilding(task.buildingType);
  const building = task.visualKind === "BUILDING";
  const width = building ? entry.spriteSize.width : Math.max(8, ...task.footprint.map((cell) => (cell.x - task.origin.x + 1) * CELL_SIZE));
  const height = building ? entry.spriteSize.height : Math.max(8, ...task.footprint.map((cell) => (cell.y - task.origin.y + 1) * CELL_SIZE));
  const profile = incidentVisualProfile(task);
  const container = new Container();
  container.eventMode = "none";
  container.position.set(task.origin.x * CELL_SIZE + width / 2, task.origin.y * CELL_SIZE + height);
  const visualSeed = [...task.id].reduce((value, char) => ((value * 33) ^ char.charCodeAt(0)) >>> 0, 5381);
  const phaseMs = visualSeed % 700;
  const stageBounds = building ? entry.stageOpaqueBounds[task.stage - 1]! : undefined;
  const layout = incidentVisualLayout(width, height, profile, stageBounds);
  const makeFrames = (kind: "flame" | "smoke", anchor: { x: number; y: number }) => {
    const frames = [0, 1].map((frame) => {
      const graphics = new Graphics();
      for (const pixel of incidentEffectPixels(kind, frame)) graphics.rect(pixel.x, pixel.y, 1, 1).fill(pixel.color);
      graphics.position.set(anchor.x, anchor.y);
      graphics.visible = frame === 0;
      return graphics;
    });
    return { frameA: frames[0]!, frameB: frames[1]! };
  };
  const flames = layout.flameAnchors.map((anchor) => makeFrames("flame", anchor));
  const smokePlumes = layout.smokeAnchors.map((anchor) => makeFrames("smoke", anchor));
  const presentation = incidentBadge(mode);
  const badge = new Graphics().rect(-1, -1, 7, 7).fill(0x30464c);
  for (const pixel of presentation.pixels) badge.rect(pixel.x, pixel.y, 1, 1).fill(pixel.color);
  badge.position.set(Math.floor(width / 2) - 8, -height + 3);
  container.addChild(badge);

  // The response vehicle is an on-site overlay in the reserved one-cell
  // clearance, not a simulated traffic agent or a claim of road dispatch.
  const responder = microIncidentResponder(width);
  const beacon = new Graphics().rect(0, 0, 1, 1).fill(0x71d7f2);
  beacon.position.set(responder.beacon.x, responder.beacon.y);
  beacon.visible = fullResponse;
  if (fullResponse) {
    const engine = sprite(responder.visual.url, responder.center.x, responder.center.y);
    engine.anchor.set(0.5);
    container.addChild(engine);
  }
  const water = new Graphics();
  const targets = layout.flameAnchors.map((anchor) => ({ x: anchor.x, y: anchor.y - 2 }));
  const initialTarget = incidentWaterTargetFrame(targets, 0, phaseMs);
  const waterJet = { source: responder.hose, targets, targetIndex: initialTarget?.index ?? 0 };
  water.visible = fullResponse && profile.burning && Boolean(initialTarget);
  if (water.visible && initialTarget) drawIncidentWaterJet(water, waterJet.source, initialTarget.target, 0, phaseMs);
  container.addChild(water, ...smokePlumes.flatMap((plume) => [plume.frameA, plume.frameB]), ...flames.flatMap((flame) => [flame.frameA, flame.frameB]), beacon);
  return { signature, container, mode, profile, fullResponse, flames, smokePlumes, beacon, water, waterJet, phaseMs, animationFrame: -1 };
}

function requiredGroundAssets(chunks: Iterable<Pick<ChunkDto, "terrain">>, lod: MapLod): string[] {
  if (lod !== "DETAIL") return [];
  const urls = new Set<string>([
    gameAssetUrl("atlas/road-v2/road.png"),
    gameAssetUrl("atlas/road-v2/surface.png"),
    gameAssetUrl("atlas/road-v2/overlay.png"),
  ]);
  for (const chunk of chunks) for (const cell of chunk.terrain) urls.add(gameAssetUrl(
    atlasTerrainTile(atlasTerrainKindFromWorld(cell.terrain), "city", cell.x, cell.y, 0).url,
  ));
  return [...urls];
}

function requiredEntityAssets(chunks: Iterable<ChunkDto>, lod: MapLod, extraTasks: Iterable<ChunkTaskDto> = []): string[] {
  const urls = new Set<string>();
  let hasStaticDecorations = false;
  urls.add(PROP_SPRITES["active-district-flag"]!);
  const addTaskAssets = (tasks: Iterable<ChunkTaskDto>) => {
    for (const task of tasks) {
      const entry = getBuilding(task.buildingType);
      if (lod === "DETAIL") {
        if (task.visualKind === "PARK") {
          for (const { x, y, role } of greenAreaSurfaceLayout(task.footprint, parkStage(task.stage), task.visualAssetKey)) {
            if (role === "WATER" || role === "MEADOW") urls.add(gameAssetUrl(atlasTerrainTile(role === "WATER" ? "shallow_water" : "meadow", "city", x, y, 0).url));
          }
          for (const placement of taskParkDecorLayout(task.footprint, parkStage(task.stage), task.visualAssetKey, task.taskNumber)) {
            const metadata = PROP_CATALOG[placement.kind];
            if (metadata) urls.add(metadata.path);
            const litKey = illuminatedPropKey(placement.kind);
            if (litKey !== placement.kind && PROP_CATALOG[litKey]) urls.add(PROP_CATALOG[litKey]!.path);
          }
        } else {
          if (task.stage < 5) for (const key of CONSTRUCTION_TILE_KEYS) urls.add(TILE_SPRITES[key]!);
          if (task.stage <= 2) {
          const entranceOffset = entry.entrances[0]?.offset ?? Math.floor(entry.footprint.width / 2);
          const construction = constructionStageLayout(entry.footprint, entranceOffset, task.stage, task.taskNumber);
          for (const detail of construction.details) urls.add(PROP_SPRITES[detail.key]!);
          }
          if (task.stage > 2) urls.add(entry.stages[task.stage - 1]!);
          for (const cell of taskPlatformCells(task.footprint, task.stage)) {
            const presentation = taskPlatformCellPresentation(entry);
            if (presentation.family === "terrain") urls.add(gameAssetUrl(
              atlasTerrainTile(atlasTerrainKindFromWorld(presentation.key), "city", cell.x, cell.y, 0).url,
            ));
          }
        }
        if (incidentVisualProfile(task).burning) {
          urls.add(microIncidentResponder(entry.spriteSize.width).visual.url);
        }
      }
    }
  };
  addTaskAssets(extraTasks);
  for (const chunk of chunks) {
    addTaskAssets(chunk.tasks);
    for (const feature of lod === "DETAIL" ? chunk.worldFeatures : []) {
      if (feature.kind === "RUIN") {
        urls.add(PROP_SPRITES["compact-construction-bricks"]!);
        urls.add(PROP_SPRITES["compact-construction-sand"]!);
      }
      if (feature.assetKind === "PROP") {
        const metadata = PROP_CATALOG[feature.assetKey];
        if (metadata) urls.add(metadata.path);
      } else if (feature.assetKind === "BUILDING") {
        urls.add(getBuilding(feature.assetKey).stages[4]!);
      }
    }
    if (lod !== "DETAIL") continue;
    for (const decoration of chunk.decorations) {
      const metadata = PROP_CATALOG[decoration.kind];
      if (!metadata) continue;
      if (isAnimatedDecoration(decoration.kind)) urls.add(metadata.path);
      else hasStaticDecorations = true;
    }
  }
  if (lod === "DETAIL") {
    if (hasStaticDecorations) urls.add(PROP_ATLAS.path);
    urls.add(gameAssetUrl(atlasTerrainTile("grass", "city", 0, 0, 0).url));
    urls.add(gameAssetUrl(atlasTerrainTile("meadow", "city", 0, 0, 0).url));
    urls.add(PROP_SPRITES["traffic-light-red"]!);
    urls.add(PROP_SPRITES["traffic-light-green"]!);
  }
  return [...urls];
}

function ambientDetailAssets(): string[] {
  return microAmbientAssetUrls();
}

export function WorldCanvas({ countryId, chunkSize, worldManifest, viewBounds, focusCity, initialCityScene, startAtMinimumScale = false, active = true, focusTask, invalidations, onInvalidationsProcessed, showDistricts, onTaskSelect, onArchiveSelect, onSiteSelect, onReady, onFatalError, onZoomOutToCountry, wheelNavigation }: {
  countryId: string;
  chunkSize: number;
  worldManifest: WorldManifestDto;
  viewBounds: Rect;
  focusCity?: Pick<NonNullable<BootstrapDto["initialCity"]>, "id" | "name" | "center" | "bounds"> | null;
  initialCityScene?: CitySceneDto;
  startAtMinimumScale?: boolean;
  active?: boolean;
  focusTask?: { origin: Cell; token: number } | null;
  invalidations: readonly MapInvalidation[];
  onInvalidationsProcessed: (cursor: number) => void;
  showDistricts: boolean;
  onTaskSelect: (taskId: string) => void;
  onArchiveSelect: () => void;
  onSiteSelect: (feature: WorldFeatureDto) => void;
  onReady?: () => void;
  onFatalError?: (message: string) => void;
  onZoomOutToCountry?: (focus?: { x: number; y: number }) => void;
  wheelNavigation: AtlasWheelNavigation;
}) {
  const [firstFrameReady, setFirstFrameReady] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [mapLoadError, setMapLoadError] = useState<string>();
  const [rendererAttempt, setRendererAttempt] = useState(0);
  const hostRef = useRef<HTMLDivElement>(null);
  const districtLayerRef = useRef<Container | null>(null);
  const districtTooltipLayerRef = useRef<Container | null>(null);
  const runtimeRef = useRef<WorldRuntime | null>(null);
  const invalidationCursorRef = useRef(0);
  const activeRef = useRef(active);
  const showDistrictsRef = useRef(showDistricts);
  const onTaskSelectRef = useRef(onTaskSelect);
  const onArchiveSelectRef = useRef(onArchiveSelect);
  const onSiteSelectRef = useRef(onSiteSelect);
  const onZoomOutToCountryRef = useRef(onZoomOutToCountry);
  const wheelNavigationRef = useRef(wheelNavigation);
  const onFatalErrorRef = useRef(onFatalError);
  const terrainSeed = worldManifest.terrainSeed;
  const focusCityId = focusCity?.id;
  const focusArea = useMemo(() => {
    if (!focusCity) return undefined;
    return { point: focusCity.center, bounds: cityDetailFocusBounds(focusCity.center, focusCity.bounds) };
  }, [focusCity]);
  const focusX = focusArea?.point.x;
  const focusY = focusArea?.point.y;
  const focusMinX = focusArea?.bounds.minX;
  const focusMinY = focusArea?.bounds.minY;
  const focusMaxX = focusArea?.bounds.maxX;
  const focusMaxY = focusArea?.bounds.maxY;
  const viewBoundsKey = `${viewBounds.minX},${viewBounds.minY},${viewBounds.maxX},${viewBounds.maxY}`;
  const initialFocusRef = useRef(focusTask ? buildingFocusArea(focusTask.origin) : focusArea);
  const initialViewBoundsRef = useRef(viewBounds);
  const initialCitySceneRef = useRef(initialCityScene);
  const initialMinimumScaleRef = useRef(startAtMinimumScale);
  const initialWorldRevisionRef = useRef(worldManifest.worldRevision);

  useEffect(() => {
    showDistrictsRef.current = showDistricts;
    if (districtLayerRef.current) districtLayerRef.current.visible = showDistricts;
    if (districtTooltipLayerRef.current) districtTooltipLayerRef.current.visible = showDistricts;
    if (hostRef.current) hostRef.current.dataset.districtBoundaryVisible = String(showDistricts);
  }, [showDistricts]);

  useEffect(() => {
    onTaskSelectRef.current = onTaskSelect;
    onArchiveSelectRef.current = onArchiveSelect;
    onSiteSelectRef.current = onSiteSelect;
    onZoomOutToCountryRef.current = onZoomOutToCountry;
    wheelNavigationRef.current = wheelNavigation;
    onFatalErrorRef.current = onFatalError;
  }, [onArchiveSelect, onSiteSelect, onFatalError, onTaskSelect, onZoomOutToCountry, wheelNavigation]);

  useEffect(() => {
    if (focusX == null || focusY == null || focusMinX == null || focusMinY == null || focusMaxX == null || focusMaxY == null) return;
    runtimeRef.current?.focus({
      point: { x: focusX, y: focusY },
      bounds: { minX: focusMinX, minY: focusMinY, maxX: focusMaxX, maxY: focusMaxY },
    });
  }, [focusMaxX, focusMaxY, focusMinX, focusMinY, focusX, focusY]);

  useEffect(() => {
    if (!firstFrameReady || !runtimeRef.current) return;
    const pending = invalidations.filter(event => event.id > invalidationCursorRef.current).sort((a, b) => a.id - b.id);
    if (pending.length === 0) return;
    runtimeRef.current.invalidateBatch(pending);
    const cursor = pending.at(-1)!.id;
    invalidationCursorRef.current = cursor;
    onInvalidationsProcessed(cursor);
  }, [invalidations, firstFrameReady, onInvalidationsProcessed]);

  // Search-driven focus: jump the camera to the found building with a
  // neighbourhood-sized window around it.
  const focusTaskToken = focusTask?.token;
  useEffect(() => {
    if (!focusTaskToken || !focusTask) return;
    runtimeRef.current?.focus(buildingFocusArea(focusTask.origin));
  }, [focusTaskToken, focusTask, firstFrameReady]);

  useEffect(() => {
    const [minX, minY, maxX, maxY] = viewBoundsKey.split(",").map(Number);
    runtimeRef.current?.setViewBounds({ minX: minX!, minY: minY!, maxX: maxX!, maxY: maxY! });
  }, [viewBoundsKey]);

  useEffect(() => {
    activeRef.current = active;
    runtimeRef.current?.setActive(active);
  }, [active, firstFrameReady]);

  // A new parent callback is not a renderer activation. Re-running setActive
  // on bootstrap/card renders used to retry dirty scenes and schedule loads.
  useEffect(() => {
    if (active && firstFrameReady) onReady?.();
  }, [active, firstFrameReady, onReady]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    setFirstFrameReady(false);
    setMapLoadError(undefined);
    delete host.dataset.residentChunks;
    delete host.dataset.chunkRange;
    let disposed = false;
    let paintedFrame = false;
    let streamingTimer = 0;
    let suppressSelectionUntil = 0;
    const selectTask = (taskId: string) => {
      if (performance.now() >= suppressSelectionUntil) onTaskSelectRef.current(taskId);
    };
    const selectArchive = () => {
      if (performance.now() >= suppressSelectionUntil) onArchiveSelectRef.current();
    };
    const selectSite = (feature: WorldFeatureDto) => {
      if (performance.now() >= suppressSelectionUntil) onSiteSelectRef.current(feature);
    };
    const beginStreamingFeedback = () => {
      window.clearTimeout(streamingTimer);
      if (!paintedFrame) return;
      streamingTimer = window.setTimeout(() => { if (!disposed) setStreaming(true); }, 160);
    };
    const endStreamingFeedback = () => {
      window.clearTimeout(streamingTimer);
      if (!disposed) setStreaming(false);
    };
    const app = new Application();
    const startupDisposers: Array<() => void> = [];
    let startupResourcesCleaned = false;
    let appDestroyed = false;
    const cleanupStartupResources = () => {
      if (startupResourcesCleaned) return;
      startupResourcesCleaned = true;
      for (const dispose of startupDisposers.reverse()) {
        try { dispose(); } catch (error) { console.error("Failed to dispose partial world resource", error); }
      }
    };
    const destroyApp = () => {
      if (appDestroyed) return;
      appDestroyed = true;
      try { stopPixiApplication(app); } catch (error) { console.error("Failed to stop partial world renderer", error); }
      try {
        if (app.renderer) app.destroy({ removeView: true }, { children: true });
      } catch (error) {
        console.error("Failed to destroy partial world renderer", error);
      }
    };
    const chunks = new Map<string, ChunkDto>();
    const entityChunks = new Map<string, ChunkDto>();
    const entityChunkLods = new Map<string, MapLod>();
    const chunkLods = new Map<string, MapLod>();
    const chunkDataCache = new Map<string, ChunkDto>();
    const chunkPayloadCache = new Map<string, ChunkPayloadDto>();
    let cityScene: CitySceneDto | undefined;
    let citySceneChunkCount = 0;
    const completedSnapshotTasks = new Map<string, ChunkTaskDto>();
    const installCompletedSnapshotTasks = (scene: CitySceneDto): void => {
      completedSnapshotTasks.clear();
      for (const snapshot of scene.completedDistrictSnapshots) {
        for (const task of snapshot.tasks) completedSnapshotTasks.set(task.id, task);
      }
    };
    // Seed terrain is immutable for a (seed, chunk, LOD) tuple. Infrastructure
    // is a separate transparent overlay, so an API response never destroys and
    // re-bakes the already visible first-frame terrain texture.
    type GroundRecord = { terrainView: Sprite; overlayView?: Sprite; lod: MapLod; usedAt: number };
    type PreparedGround = { terrainView?: Sprite; overlayView?: Sprite };
    const groundContainers = new Map<string, GroundRecord>();
    const pendingChunks = new Map<string, { promise: Promise<ChunkDto>; controller: AbortController }>();
    const chunkMaterializer = new ChunkMaterializer();
    startupDisposers.push(() => chunkMaterializer.destroy());
    const assetLease = new AssetLease();
    startupDisposers.push(() => {
      assetLease.dispose();
      host.dataset.assetLease = "released";
      host.dataset.leasedAssets = String(leasedAssetCount());
    });
    const chunkPayloadMetric = new RollingPerformanceMetric();
    const chunkRequestMetric = new RollingPerformanceMetric();
    const chunkParseMetric = new RollingPerformanceMetric();
    const chunkMaterializeMetric = new RollingPerformanceMetric();
    const groundBakeMetric = new RollingPerformanceMetric();
    const latestTaskStatusPatches = new Map<string, ChunkTaskStatusPatch>();
    const invalidatedGroundKeys = new Set<string>();
    const seedGroundKeys = new Set<string>();
    const seedTerrainSamples = new Map<string, Uint8Array>();
    const pendingSeedGrounds = new Map<string, Promise<void>>();
    const groundFades: Array<{ containers: Container[]; elapsed: number; duration: number }> = [];
    const initialFocus = initialFocusRef.current;

    void (async () => {
      await app.init({ resizeTo: host, backgroundColor: 0x101d20, antialias: false, autoDensity: true, resolution: Math.min(devicePixelRatio, 2), preference: "webgl" });
      if (!activeRef.current) app.stop();
      if (disposed) { app.destroy({ removeView: true }, { children: true }); return; }
      const canvas = app.canvas;
      canvas.className = "world-canvas-element";
      canvas.setAttribute("aria-label", "Интерактивная карта города");
      host.appendChild(canvas);

      const world = new Container();
      const backdropLayer = new Graphics();
      const terrainLayer = new Container();
      const surfaceLayer = new Container();
      const roadLayer = new Container();
      const districtLayer = new Container();
      districtLayerRef.current = districtLayer;
      const districtTooltipLayer = new Container();
      districtTooltipLayerRef.current = districtTooltipLayer;
      const buildingTooltipLayer = new Container();
      buildingTooltipLayer.eventMode = "none";
      const blockPlaqueLayer = new Container();
      blockPlaqueLayer.eventMode = "none";
      buildingTooltipLayer.addChild(blockPlaqueLayer);
      let blockPlaqueSignature = "";
      const platformLayer = new Container();
      const plannedSiteMarks = new Graphics();
      plannedSiteMarks.eventMode = "none";
      platformLayer.addChild(plannedSiteMarks);
      const featurePlatformLayer = new Container();
      const worldObjectLayer = new Container();
      const agentOverlayLayer = new Container();
      agentOverlayLayer.eventMode = "none";
      const flightLayer = new Container();
      flightLayer.eventMode = "none";
      districtLayer.visible = showDistrictsRef.current;
      districtTooltipLayer.visible = showDistrictsRef.current;
      const worldLayers: Record<WorldLayerName, Container | Graphics> = {
        backdrop: backdropLayer,
        terrain: terrainLayer,
        surface: surfaceLayer,
        road: roadLayer,
        platform: platformLayer,
        featurePlatform: featurePlatformLayer,
        worldObject: worldObjectLayer,
        flight: flightLayer,
        agentOverlay: agentOverlayLayer,
        district: districtLayer,
        districtTooltip: districtTooltipLayer,
        buildingTooltip: buildingTooltipLayer,
      };
      world.addChild(...WORLD_LAYER_ORDER.map((name) => worldLayers[name]));
      const lampGlow = new Graphics();
      const propShadows = new Graphics();
      propShadows.eventMode = "none";
      world.addChildAt(propShadows, world.getChildIndex(worldObjectLayer));
      lampGlow.eventMode = "none";
      world.addChildAt(lampGlow, world.getChildIndex(worldObjectLayer));
      let lampSignature = "";
      let lightElapsed = 500;
      let lampSprites: Array<{ view: Sprite; day: Texture; night: Texture }> = [];
      let lampsOn = false;
      app.stage.addChild(world);
      type RenderNode = Container | Graphics | Sprite;
      const worldObjectKinds = new WeakMap<RenderNode, WorldObjectKind>();
      const registerWorldObject = <T extends RenderNode>(view: T, kind: WorldObjectKind): T => {
        worldObjectKinds.set(view, kind);
        return view;
      };
      const sortWorldObjects = (): void => {
        worldObjectLayer.children.sort((left, right) => compareWorldObjects(
          { groundY: left.y, kind: worldObjectKinds.get(left as RenderNode) ?? "FEATURE", id: left.label },
          { groundY: right.y, kind: worldObjectKinds.get(right as RenderNode) ?? "FEATURE", id: right.label },
        ));
        host.dataset.worldObjectDepthErrors = String(worldObjectLayer.children.slice(1).filter((child, index) => compareWorldObjects(
          { groundY: worldObjectLayer.children[index]!.y, kind: worldObjectKinds.get(worldObjectLayer.children[index] as RenderNode) ?? "FEATURE", id: worldObjectLayer.children[index]!.label },
          { groundY: child.y, kind: worldObjectKinds.get(child as RenderNode) ?? "FEATURE", id: child.label },
        ) > 0).length);
        host.dataset.worldObjects = String(worldObjectLayer.children.length);
      };
      const districtViews = new Map<string, EntityViewRecord<Container>>();
      const taskPlatformViews = new Map<string, EntityViewRecord<Container>>();
      const taskBuildingViews = new Map<string, EntityViewRecord<Container>>();
      const incidentViews = new Map<string, IncidentView>();
      const decorationViews = new Map<string, EntityViewRecord<Sprite>>();
      const ambientDecorationViews = new Map<string, { view: Sprite; baseX: number; baseY: number; phase: number; kind: string }>();
      let staticDecorationLayers: Container[] = [];
      let staticDecorationSignature = "";
      let staticDecorationParticleCount = 0;
      const propAtlasTextures = new Map<string, Texture>();
      startupDisposers.push(() => {
        for (const texture of propAtlasTextures.values()) texture.destroy(false);
        propAtlasTextures.clear();
      });
      const featureViews = new Map<string, { signature: string; platform?: Container; visual?: Container }>();
      let entityReplacementCount = 0;
      // `focusArea` controls only the opening composition. Navigation and
      // visibility are bounded by the complete city supplied through
      // `viewBounds`, otherwise the camera appears frozen at 160x100 cells.
      let currentViewBounds = initialViewBoundsRef.current;
      let currentLod: MapLod = focusCityId ? "DETAIL" : world.scale.x < DETAIL_LOD_SCALE ? "OVERVIEW" : "DETAIL";
      let ambientAssetsReady = false;
      let ambientAssetsPromise: Promise<void> | undefined;
      const redrawBackdrop = () => {
        backdropLayer.clear().rect(
          currentViewBounds.minX * CELL_SIZE,
          currentViewBounds.minY * CELL_SIZE,
          (currentViewBounds.maxX - currentViewBounds.minX + 1) * CELL_SIZE,
          (currentViewBounds.maxY - currentViewBounds.minY + 1) * CELL_SIZE,
        ).fill(TERRAIN_COLORS.GRASS);
      };
      redrawBackdrop();
      type AnimalAgent = {
        id: string;
        view: Sprite;
        graph: Map<string, Cell>;
        current: Cell;
        next: Cell;
        previous?: Cell;
        progress: number;
        speed: number;
        variant: string;
        steps: number;
        randomState: number;
        route: Cell[];
        routeIndex: number;
      };
      let animals: AnimalAgent[] = [];
      const destroyAnimal = (agent: AnimalAgent): void => {
        agent.view.removeFromParent();
        agent.view.destroy();
      };
      type MobilityAgent = ReturnType<typeof createCityMobility>["agents"][number];
      let mobility: ReturnType<typeof createCityMobility> | undefined;
      const mobilityViews = new Map<string, { view: Sprite; marker?: Graphics; activity: MobilityAgent["activity"]; visualKey: string }>();
      const trafficSignalViews = new Map<string, { view: Sprite; state: "RED" | "GREEN" }>();
      let mobilityPostOrigins = new Map<string, Cell>();
      const sessionSeed = crypto.getRandomValues(new Uint32Array(1))[0] || 0x6d2b79f5;
      let spawnState = sessionSeed;
      let nextAgentId = 1;
      let simulationTimeMs = 0;
      let nextTrafficTelemetryMs = 0;
      let nextDepthSortMs = 0;
      let airplane: { view: Sprite; route: CityMicroFlightRoute; elapsed: number; duration: number } | undefined;
      let cityFlightRoutes: CityMicroFlightRoute[] = [];
      let nextFlybyMs = 5_000;
      const celebrations: Array<{ particles: Array<{ view: Graphics; vx: number; vy: number }>; elapsed: number }> = [];
      const launchCelebration = (bounds: Rect) => {
        if (reducedMotion) return;
        const centerX = (bounds.minX + bounds.maxX + 1) * CELL_SIZE / 2;
        const centerY = bounds.minY * CELL_SIZE - 10;
        const colors = [0xf2c84b, 0x73bddc, 0xd66e5d, 0x78be6d, 0xc59ae8];
        const particles = Array.from({ length: 28 }, (_, index) => {
          const angle = index / 28 * Math.PI * 2;
          const speed = 0.025 + (index % 5) * 0.006;
          const view = new Graphics().rect(-1, -1, 2, 2).fill(colors[index % colors.length]!);
          view.position.set(centerX, centerY); flightLayer.addChild(view);
          return { view, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 0.012 };
        });
        celebrations.push({ particles, elapsed: 0 });
        host.dataset.celebrations = String(Number(host.dataset.celebrations ?? 0) + 1);
      };
      host.dataset.airplaneSpace = flightLayer.parent === world ? "world" : "screen";
      const drawMobility = (): void => {
        if (!mobility) return;
        const visible = currentLod === "DETAIL" && ambientAssetsReady;
        const wanted = new Set(mobility.agents.map(agent => agent.id));
        for (const [id, entry] of mobilityViews) {
          if (wanted.has(id)) continue;
          entry.view.destroy(); entry.marker?.destroy(); mobilityViews.delete(id);
        }
        for (const agent of mobility.agents) {
          const url = microAmbientSprite(agent.kind === "CAR" ? "car" : "person", agent.variant, agent.direction).url;
          let entry = mobilityViews.get(agent.id);
          if (!entry) {
            const view = sprite(url, agent.position.x * CELL_SIZE, agent.position.y * CELL_SIZE);
            view.anchor.set(0.5);
            worldObjectLayer.addChild(registerWorldObject(view, "AGENT"));
            const marker = agent.kind === "WALKER" ? new Graphics() : undefined;
            if (marker) agentOverlayLayer.addChild(marker);
            entry = { view, marker, activity: "NONE", visualKey: url };
            mobilityViews.set(agent.id, entry);
          }
          if (entry.visualKey !== url) {
            const texture = cachedTexture(url);
            if (texture) entry.view.texture = texture;
            entry.visualKey = url;
          }
          entry.view.visible = visible;
          entry.view.position.set(agent.position.x * CELL_SIZE, agent.position.y * CELL_SIZE);
          entry.view.rotation = 0;
          if (entry.marker) {
            if (entry.activity !== agent.activity) {
              entry.marker.clear();
              // Native pixel cues, not oversized smooth speech balloons.
              if (agent.activity !== "NONE") {
                entry.marker.rect(-1, -4, 1, 1).fill(0xe1d3a4);
              }
              entry.activity = agent.activity;
            }
            entry.marker.position.copyFrom(entry.view.position);
            entry.marker.visible = visible && agent.activity !== "NONE";
          }
        }
        const wantedSignals = new Set<string>();
        for (const signal of mobility.signals) for (const post of signal.signalPosts) {
          const id = `${signal.id}:${post.approach}`;
          const origin = mobilityPostOrigins.get(id);
          if (!origin) continue;
          wantedSignals.add(id);
          const state = post.axis === "H" ? signal.horizontal : signal.vertical;
          let entry = trafficSignalViews.get(id);
          const url = PROP_SPRITES[`traffic-light-${state.toLowerCase()}`]!;
          if (!entry) {
            const view = sprite(url, (origin.x + 0.5) * CELL_SIZE, (origin.y + 1) * CELL_SIZE);
            view.anchor.set(0.5, 1);
            worldObjectLayer.addChild(registerWorldObject(view, "FEATURE"));
            entry = { view, state };
            trafficSignalViews.set(id, entry);
          } else if (entry.state !== state) {
            const texture = cachedTexture(url);
            if (texture) entry.view.texture = texture;
            entry.state = state;
          }
          entry.view.position.set((origin.x + 0.5) * CELL_SIZE, (origin.y + 1) * CELL_SIZE);
          entry.view.visible = visible;
        }
        for (const [id, signal] of trafficSignalViews) if (!wantedSignals.has(id)) {
          signal.view.destroy(); trafficSignalViews.delete(id);
        }
      };
      const mobilityStepMetric = new RollingPerformanceMetric(120);
      let lastMeasuredMobilityStep = 0;
      let mobilityRoads = new Map<string, RoadCellDto>();
      let mobilityWalkGraph = new Map<string, Cell>();
      const reportMobility = (): void => {
        if (!mobility) return;
        const agents = mobility.agents;
        const cars = agents.filter(agent => agent.kind === "CAR");
        const walkers = agents.filter(agent => agent.kind === "WALKER");
        const visible = currentLod === "DETAIL" && ambientAssetsReady;
        const metrics = mobility.metrics;
        host.dataset.mobilityReady = "true";
        host.dataset.mobilityFixedSteps = String(metrics.fixedSteps);
        host.dataset.mobilityNetworkBuilds = String(metrics.networkBuilds);
        host.dataset.cars = String(visible ? cars.length : 0);
        host.dataset.walkers = String(visible ? walkers.length : 0);
        host.dataset.animals = String(visible ? animals.length : 0);
        host.dataset.buses = "0"; host.dataset.cyclists = "0"; host.dataset.scooters = "0";
        host.dataset.trafficSteps = host.dataset.trafficLifetimeSteps = String(metrics.vehicleSteps);
        host.dataset.walkerLifetimeSteps = String(metrics.walkerSteps);
        host.dataset.trafficUnsafePairs = String(metrics.vehicleUnsafePairs);
        host.dataset.trafficPedestrianUnsafePairs = String(metrics.pedestrianUnsafePairs);
        host.dataset.trafficVehiclePedestrianUnsafePairs = String(metrics.vehiclePedestrianUnsafePairs);
        host.dataset.mobilityVehicleUnsafeTotal = String(metrics.vehicleUnsafeTotal);
        host.dataset.mobilityPedestrianUnsafeTotal = String(metrics.pedestrianUnsafeTotal);
        host.dataset.mobilityVehiclePedestrianUnsafeTotal = String(metrics.vehiclePedestrianUnsafeTotal);
        host.dataset.mobilityPeakVehicleWaitMs = String(metrics.peakVehicleWaitMs);
        host.dataset.mobilityPeakWalkerWaitMs = String(metrics.peakWalkerWaitMs);
        host.dataset.trafficMaxWaitMs = String(metrics.maxVehicleWaitMs);
        host.dataset.pedestrianMaxWaitMs = String(metrics.maxWalkerWaitMs);
        host.dataset.trafficBlockedVehicles = String(cars.filter(agent => agent.waitMs > 0).length);
        host.dataset.trafficMovingVehicles = String(cars.filter(agent => agent.waitMs === 0 && agent.activity === "NONE").length);
        host.dataset.mobilityTrips = String(metrics.completedTrips);
        host.dataset.mobilityCrossings = String(metrics.crossingsCompleted);
        host.dataset.trafficJunctions = String(mobility.signals.length);
        host.dataset.trafficSignals = String(trafficSignalViews.size);
        host.dataset.mobilitySignalState = mobility.signals.map(signal => `${signal.id}:${signal.horizontal[0]}${signal.vertical[0]}${signal.pedestrians[0]}`).join(";");
        host.dataset.wrongWayCars = String(cars.filter(agent => {
          const dx = agent.next.x - agent.current.x, dy = agent.next.y - agent.current.y;
          if (dx === 0 && dy === 0) return false;
          const road = mobilityRoads.get(key(agent.current));
          if (!road || !mobilityRoads.has(key(agent.next)) || Math.abs(dx) + Math.abs(dy) !== 1) return true;
          const band = roadBandRole(mobilityRoads, road);
          return band.kind === "TRAVEL" && (band.dx !== dx || band.dy !== dy);
        }).length);
        host.dataset.walkerOffPath = String(walkers.filter(agent => !mobilityWalkGraph.has(key(agent.current)) || !mobilityWalkGraph.has(key(agent.next))).length);
        host.dataset.activeWalkerActivities = String(walkers.filter(agent => agent.activity !== "NONE").length);
        host.dataset.walkerRoadActivities = String(walkers.filter(agent => agent.activity !== "NONE"
          && (mobilityRoads.has(key(agent.current)) || mobilityRoads.has(key(agent.next)))).length);
        host.dataset.residentCenterErrors = String(walkers.filter(agent => {
          const view = mobilityViews.get(agent.id)?.view;
          return view && (Math.abs(view.x - agent.position.x * CELL_SIZE) > .01 || Math.abs(view.y - agent.position.y * CELL_SIZE) > .01);
        }).length);
        host.dataset.residentWalkFrames = [...new Set(walkers.map(agent => mobilityViews.get(agent.id)?.visualKey ?? ""))].sort().join(",");
        host.dataset.residentWalkState = walkers.map(agent => `${agent.id}:${agent.direction}:${agent.steps}`).sort().join(",");
        host.dataset.agentSession = String(sessionSeed);
        host.dataset.agentIds = [...agents.map(agent => agent.id), ...animals.map(agent => agent.id)].sort().join(",");
        const timing = mobilityStepMetric.snapshot();
        host.dataset.mobilityStepP95Ms = timing.p95.toFixed(3);
        host.dataset.mobilityStepMaxMs = timing.max.toFixed(3);
      };
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      host.dataset.animationActive = String(!reducedMotion);
      host.dataset.vehicleAnimationFrames = "4";
      app.ticker.add(() => {
        lightElapsed += app.ticker.deltaMS;
        if (lightElapsed >= 100) {
          lightElapsed = 0;
          const light = readWorldLighting();
          for (const layer of [backdropLayer, terrainLayer, surfaceLayer, roadLayer, platformLayer, featurePlatformLayer, worldObjectLayer, flightLayer]) layer.tint = light.tint;
          lampGlow.alpha = light.lamps;
          propShadows.alpha = light.shadowAlpha;
          propShadows.x = Math.round(light.shadowOffsetX);
          const nextLampsOn = light.lamps >= .4;
          if (nextLampsOn !== lampsOn) {
            lampsOn = nextLampsOn;
            for (const lamp of lampSprites) if (!lamp.view.destroyed) lamp.view.texture = lampsOn ? lamp.night : lamp.day;
            for (const record of taskBuildingViews.values()) updateParkLighting(record.view, lampsOn);
          }
          host.dataset.lightPhase = light.phase;
          host.dataset.lampIntensity = light.lamps.toFixed(3);
        }
        if (reducedMotion) return;
        const elapsed = Math.min(50, app.ticker.deltaMS);
        simulationTimeMs += elapsed;
        for (let index = groundFades.length - 1; index >= 0; index -= 1) {
          const fade = groundFades[index]!;
          fade.elapsed += elapsed;
          const alpha = Math.min(1, fade.elapsed / fade.duration);
          for (const container of fade.containers) if (!container.destroyed) container.alpha = alpha;
          if (alpha >= 1) groundFades.splice(index, 1);
        }
        for (let index = celebrations.length - 1; index >= 0; index -= 1) {
          const celebration = celebrations[index]!;
          celebration.elapsed += elapsed;
          for (const particle of celebration.particles) {
            particle.vy += elapsed * 0.000035;
            particle.view.x += particle.vx * elapsed;
            particle.view.y += particle.vy * elapsed;
            particle.view.alpha = Math.max(0, 1 - celebration.elapsed / 1_350);
          }
          if (celebration.elapsed >= 1_350) {
            for (const particle of celebration.particles) particle.view.destroy();
            celebrations.splice(index, 1);
          }
        }
        if (mobility && currentLod === "DETAIL") {
          const started = performance.now();
          mobility.advance(elapsed);
          const duration = performance.now() - started;
          const fixedSteps = mobility.metrics.fixedSteps;
          if (fixedSteps > lastMeasuredMobilityStep) {
            mobilityStepMetric.record(duration / (fixedSteps - lastMeasuredMobilityStep));
            lastMeasuredMobilityStep = fixedSteps;
          }
          drawMobility();
        }
        for (const agent of animals) {
          if (currentLod !== "DETAIL") continue;
          agent.progress += elapsed * agent.speed;
          while (agent.progress >= 1) {
            agent.progress -= 1;
            agent.previous = agent.current; agent.current = agent.next; agent.steps += 1; agent.routeIndex += 1;
            let routed = agent.route[agent.routeIndex];
            if (!routed || !agent.graph.has(key(routed))) {
              const planned = planAgentRoute(agent.graph, agent.current, agent.randomState, 9, agent.previous);
              agent.randomState = planned.randomState; agent.route = planned.route; agent.routeIndex = 1;
              routed = planned.route[1];
            }
            agent.next = routed ?? nextWithoutUTurn(agent.graph, agent.current, agent.previous);
          }
          const motion = residentGroundPosition(agent.current, agent.next, agent.progress, CELL_SIZE);
          agent.view.position.set(motion.x, motion.y);
        }
        nextTrafficTelemetryMs -= elapsed;
        if (nextTrafficTelemetryMs <= 0) { reportMobility(); nextTrafficTelemetryMs = 250; }
        nextDepthSortMs -= elapsed;
        if (nextDepthSortMs <= 0) { sortWorldObjects(); nextDepthSortMs = 100; }
        for (const ambient of ambientDecorationViews.values()) {
          const cycle = Math.sin(simulationTimeMs * 0.0014 + ambient.phase * Math.PI * 2);
          if (ambient.kind.startsWith("boat-")) {
            ambient.view.position.set(ambient.baseX + cycle * 0.35, ambient.baseY + Math.abs(cycle) * 0.45);
            ambient.view.rotation = cycle * 0.012;
          } else {
            ambient.view.position.set(ambient.baseX, ambient.baseY);
            ambient.view.rotation = 0;
          }
        }
        for (const incident of incidentViews.values()) {
          const time = simulationTimeMs + incident.phaseMs;
          const animationFrame = Math.floor(time / INCIDENT_FRAME_MS);
          if (incident.animationFrame === animationFrame) continue;
          incident.animationFrame = animationFrame;
          const flameFrame = animationFrame % 2;
          incident.flames.forEach((flame, index) => {
            const visibleFrame = (flameFrame + index) % 2;
            flame.frameA.visible = incident.profile.burning && visibleFrame === 0;
            flame.frameB.visible = incident.profile.burning && visibleFrame === 1;
          });
          incident.smokePlumes.forEach((plume, index) => {
            const smokeFrame = (Math.floor(animationFrame / 2) + index) % 2;
            plume.frameA.visible = smokeFrame === 0;
            plume.frameB.visible = smokeFrame === 1;
          });
          incident.beacon.visible = incident.fullResponse && animationFrame % 2 === 0;
          if (incident.water.visible) {
            const targetFrame = incidentWaterTargetFrame(incident.waterJet.targets, simulationTimeMs, incident.phaseMs);
            if (targetFrame) {
              if (incident.waterJet.targetIndex !== targetFrame.index) {
                incident.waterJet.targetIndex = targetFrame.index;
                host.dataset.incidentWaterTargetIndexes = [...incidentViews.values()]
                  .filter((view) => view.water.visible)
                  .map((view) => view.waterJet.targetIndex)
                  .join(",");
              }
              drawIncidentWaterJet(incident.water, incident.waterJet.source, targetFrame.target, time, incident.phaseMs);
            }
          }
        }
        if (!airplane && cityFlightRoutes.length > 0) {
          nextFlybyMs -= elapsed;
          if (nextFlybyMs <= 0) {
            const random = nextSeededRandom(spawnState); spawnState = random.state;
            const route = cityFlightRoutes[Math.floor(random.value * cityFlightRoutes.length)]!;
            const position = cityMicroFlightPosition(route, 0);
            const texture = cachedTexture(microAmbientSprite("aircraft", "regional", position.direction).url);
            if (texture) {
              const view = new Sprite(texture); view.anchor.set(0.5); view.scale.set(position.scale);
              view.texture.source.scaleMode = "nearest"; view.position.set(position.x * CELL_SIZE, position.y * CELL_SIZE);
              flightLayer.addChild(view);
              airplane = { view, route, elapsed: 0, duration: cityMicroFlightDuration(route) };
              host.dataset.airplane = "flying"; host.dataset.airplaneVariant = "micro-regional";
            }
          }
        } else if (airplane) {
          airplane.elapsed += elapsed;
          const progress = Math.min(1, airplane.elapsed / airplane.duration);
          const position = cityMicroFlightPosition(airplane.route, progress);
          const texture = cachedTexture(microAmbientSprite("aircraft", "regional", position.direction).url);
          if (texture) airplane.view.texture = texture;
          airplane.view.position.set(position.x * CELL_SIZE, position.y * CELL_SIZE);
          airplane.view.scale.set(position.scale);
          if (progress >= 1 || !cityMicroFlightIsCurrent(airplane.route, cityFlightRoutes)) {
            airplane.view.removeFromParent(); airplane.view.destroy(); airplane = undefined;
            delete host.dataset.airplane; delete host.dataset.airplaneVariant;
            nextFlybyMs = 45_000;
          }
        }
      });
      const cameraBounds = () => focusCityId ? {
        minX: Math.floor(currentViewBounds.minX / chunkSize) * chunkSize,
        minY: Math.floor(currentViewBounds.minY / chunkSize) * chunkSize,
        maxX: (Math.floor(currentViewBounds.maxX / chunkSize) + 1) * chunkSize - 1,
        maxY: (Math.floor(currentViewBounds.maxY / chunkSize) + 1) * chunkSize - 1,
      } : currentViewBounds;
      // City size only constrains panning; it must not change the zoom range.
      const cameraMinimumScale = () => CITY_CAMERA_MIN_SCALE;
      const initialScale = initialMinimumScaleRef.current && focusCityId
        ? cameraMinimumScale()
        : !initialFocus
          ? 1.25
          : fitCameraScale(app.screen, initialFocus.bounds, CELL_SIZE);
      const focus = initialFocus ? position(initialFocus.point) : { x: 0, y: 0 };
      const appliedInitialScale = pixelPerfectCameraScale(
        initialScale,
        cameraMinimumScale(),
      );
      let cameraTargetScale = Math.max(
        initialScale,
        cameraMinimumScale(),
      );
      let cameraZoomAnchor: { screenX: number; screenY: number; localX: number; localY: number } | undefined;
      world.scale.set(appliedInitialScale);
      host.dataset.renderScale = String(appliedInitialScale);
      currentLod = appliedInitialScale < DETAIL_LOD_SCALE ? "OVERVIEW" : "DETAIL";
      world.position.set(app.screen.width / 2 - focus.x * appliedInitialScale, app.screen.height / 2 - focus.y * appliedInitialScale);
      if (initialFocus) {
        host.dataset.focusX = String(initialFocus.point.x);
        host.dataset.focusY = String(initialFocus.point.y);
      }

      let screenSize = { width: app.screen.width, height: app.screen.height };
      let resizeFrame = 0;
      let panFrame = 0;
      let reconcileFrame = 0;
      let reconcileMovement = false;
      let pendingMovementRebuild = false;
      let loadGeneration = 0;
      let loadRunning = false;
      const withAssetSlot = concurrencyGate(CHUNK_ASSET_CONCURRENCY);
      const publishEntityChunk = (cacheKey: string, chunk: ChunkDto, lod: MapLod) => {
        entityChunks.set(cacheKey, chunk);
        entityChunkLods.set(cacheKey, lod);
        host.dataset.entityReadyPublishes = String(Number(host.dataset.entityReadyPublishes ?? 0) + 1);
      };
      type GroundBakeRequest = GroundBakeWork<unknown> & { key: string };
      const groundBakeQueue: GroundBakeRequest[] = [];
      const pendingGroundBakes = new Map<string, Promise<unknown>>();
      let groundBakeFrame = 0;
      let lastGroundBakeFrameTime = -1;
      let groundBakesThisFrame = 0;
      const discardInvalidGroundBakes = () => {
        // Viewport generations can interleave in the queue: an obsolete item
        // is not necessarily at the head. Purge every stale request so rapid
        // zoom/pan cannot leave dead work ahead of the current center chunks.
        for (let index = groundBakeQueue.length - 1; index >= 0; index -= 1) {
          const request = groundBakeQueue[index]!;
          if (request.valid()) continue;
          groundBakeQueue.splice(index, 1);
          request.resolve(undefined);
        }
      };
      const pumpGroundBakes = () => {
        discardInvalidGroundBakes();
        host.dataset.groundBakeQueue = String(groundBakeQueue.length);
        if (groundBakeFrame || groundBakeQueue.length === 0) return;
        groundBakeFrame = requestAnimationFrame((frameTime) => {
          groundBakeFrame = 0;
          const initialAtomic = Boolean(cityScene && !paintedFrame);
          const batch = drainGroundBakeFrame(groundBakeQueue, initialAtomic);
          groundBakesThisFrame = frameTime === lastGroundBakeFrameTime ? groundBakesThisFrame + batch.completed : batch.completed;
          lastGroundBakeFrameTime = frameTime;
          host.dataset.groundBakesPerFrameMax = String(Math.max(Number(host.dataset.groundBakesPerFrameMax ?? 0), groundBakesThisFrame));
          const phase = initialAtomic ? "initial" : "interactive";
          const maximumKey = `${phase}GroundBakesPerFrameMax`;
          host.dataset[maximumKey] = String(Math.max(Number(host.dataset[maximumKey] ?? 0), groundBakesThisFrame));
          const countKey = `${phase}GroundBakeFrames`;
          host.dataset[countKey] = String(Number(host.dataset[countKey] ?? 0) + 1);
          host.dataset.groundBakeFrameBudgetMs = String(INITIAL_GROUND_BAKE_BUDGET_MS);
          host.dataset.groundBakeFrameMaxMs = Math.max(Number(host.dataset.groundBakeFrameMaxMs ?? 0), batch.elapsedMs).toFixed(1);
          pumpGroundBakes();
        });
      };
      const scheduleGroundBake = <T,>(requestKey: string, valid: () => boolean, task: () => T,
        priority?: () => number): Promise<T | undefined> => {
        const pending = pendingGroundBakes.get(requestKey);
        if (pending) return pending as Promise<T | undefined>;
        const promise = new Promise<T | undefined>((resolve, reject) => {
          groundBakeQueue.push({ key: requestKey, valid, task, priority, resolve: value => resolve(value as T | undefined), reject });
          host.dataset.groundBakeQueueMax = String(Math.max(
            Number(host.dataset.groundBakeQueueMax ?? 0),
            groundBakeQueue.length,
          ));
          pumpGroundBakes();
        });
        pendingGroundBakes.set(requestKey, promise);
        const clearPending = () => {
          if (pendingGroundBakes.get(requestKey) === promise) pendingGroundBakes.delete(requestKey);
        };
        void promise.then(clearPending, clearPending);
        return promise;
      };
      const cancelGroundBakes = () => {
        cancelAnimationFrame(groundBakeFrame);
        groundBakeFrame = 0;
        for (const request of groundBakeQueue.splice(0)) request.resolve(undefined);
        pendingGroundBakes.clear();
        host.dataset.groundBakeQueue = "0";
      };
      let loadRetryAttempt = 0;
      let loadRetryTimer = 0;
      let renderedRange = "";
      let desiredRange = "";
      let desiredLod = currentLod;
      let desiredWanted: Array<[number, number]> = [];
      let desiredKeys = new Set<string>();
      // ResizeObserver may deliver its first notification while this async
      // startup routine is still suspended above the loader declarations.
      // Do not enter the visibility pipeline until all of its lexical
      // dependencies have been initialized.
      let visibleLoaderReady = false;
      type PaddingGround = { terrainView?: Sprite; terrainPending?: boolean; terrainFailed?: boolean; visibleMissReported?: boolean;
        nativeView?: Container; nativeCells?: string[]; nativeCovered?: boolean;
        trees?: readonly ChunkDto["decorations"][number][]; treeViews?: Sprite[]; treePending?: boolean; treeComplete?: boolean; treeFailed?: boolean;
        overlayView?: Sprite; roads?: CityRoadPaddingChunk; roadPending?: boolean; roadComplete?: boolean; roadFailed?: boolean };
      const paddingTerrain = new Map<string, PaddingGround>();
      const paddingTreeBands = new Map<number, Container>();
      const paddingWork = new Set<Promise<void>>();
      let visiblePaddingKeys = new Set<string>();
      let cityTerrainPadding: CityTerrainPadding | undefined;
      let cityRoadPadding: CityRoadPadding | undefined;
      let cityTreePadding: CityTreePadding | undefined;
      let nextPaddingBakeId = 0;
      const nativePaddingCells = new Set<string>();
      let nativeFrameCells = 0, nativeFrameReset = 0;
      let cityTerrainAtlasesReady = false;
      const removeNativePadding = (record: PaddingGround) => {
        record.nativeView?.removeFromParent(); record.nativeView?.destroy({ children: true });
        for (const cell of record.nativeCells ?? []) nativePaddingCells.delete(cell);
        record.nativeView = undefined; record.nativeCells = undefined; record.nativeCovered = false;
      };
      const removePaddingGround = (record: PaddingGround) => {
        removeNativePadding(record);
        if (record.terrainView) destroyGroundView(record.terrainView);
        if (record.overlayView) destroyGroundView(record.overlayView);
        const parents = new Set<Container>();
        for (const view of record.treeViews ?? []) {
          if (view.parent) parents.add(view.parent);
          view.removeFromParent(); view.destroy();
        }
        for (const band of parents) if (!band.children.length) {
          paddingTreeBands.delete(band.y / CELL_SIZE); band.removeFromParent(); band.destroy();
        }
      };
      const reportPaddingRoads = () => {
        host.dataset.cameraPaddingRoadViews = String([...paddingTerrain.values()].filter(record => record.overlayView).length);
        host.dataset.cameraPaddingRoadCells = String([...paddingTerrain.values()].reduce((count, record) => count + (record.roads?.roads.length ?? 0), 0));
        host.dataset.cameraPaddingSurfaceCells = String([...paddingTerrain.values()].reduce((count, record) => count + (record.roads?.surfaces.length ?? 0), 0));
        host.dataset.cameraPaddingRoadPending = String([...paddingTerrain.values()].filter(record => record.roadPending).length);
        host.dataset.cameraPaddingTerrainPending = String([...paddingTerrain.values()].filter(record => record.terrainPending).length);
        host.dataset.cameraPaddingTerrainViews = String([...paddingTerrain.values()].filter(record => record.terrainView).length);
        host.dataset.cameraPaddingVisibleUntextured = String([...visiblePaddingKeys].filter(id => {
          const record = paddingTerrain.get(id); return !record?.terrainView && !record?.nativeCovered;
        }).length);
        host.dataset.cameraPaddingVisibleUnbaked = String([...visiblePaddingKeys].filter(id => !paddingTerrain.get(id)?.terrainView).length);
        host.dataset.cameraPaddingNativeCells = String(nativePaddingCells.size);
        if (host.dataset.cameraPaddingVisibleUntextured === "0") host.dataset.cameraPaddingNativeDeferred = "false";
        host.dataset.cameraPaddingMaterial = "terrain-v4-city-atlas";
        host.dataset.cameraPaddingTreePending = String([...paddingTerrain.values()].filter(record => record.treePending).length);
        host.dataset.cameraPaddingTrees = String([...paddingTerrain.values()].reduce((n, record) => n + (record.treeViews?.length ?? 0), 0));
        host.dataset.cameraPaddingTreeBands = String(paddingTreeBands.size);
        const sample: ChunkDto["decorations"] = [];
        for (const record of paddingTerrain.values()) {
          for (const tree of record.trees ?? []) { sample.push(tree); if (sample.length === 16) break; }
          if (sample.length === 16) break;
        }
        host.dataset.cameraPaddingTreeSample = JSON.stringify(sample);
      };
      startupDisposers.push(() => {
        cancelAnimationFrame(nativeFrameReset);
        for (const record of paddingTerrain.values()) removePaddingGround(record);
        paddingTerrain.clear();
        cityRoadPadding?.retain([]);
        cityTerrainPadding?.retain([]);
        cityTreePadding?.retain([]);
      });
      const trackPaddingWork = (work: Promise<void>) => {
        paddingWork.add(work);
        void work.then(() => paddingWork.delete(work), () => paddingWork.delete(work));
      };
      const ensurePaddingTerrain = (id: string, record: PaddingGround, x: number, y: number) => {
        if (!cityTerrainPadding || record.terrainView || record.terrainPending || record.terrainFailed) return;
        const provider = cityTerrainPadding;
        record.terrainPending = true;
        const valid = () => !disposed && cityTerrainPadding === provider && paddingTerrain.get(id) === record;
        // Sampling a whole prewarm ring synchronously also blocks a frame.
        // Capture and texture generation share the same bounded work queue.
        const work = scheduleGroundBake(`padding-sample:${++nextPaddingBakeId}:${id}`, valid, () => {
          const sampledAt = performance.now();
          const material = provider.get(x, y);
          host.dataset.cameraPaddingSampleMaxMs = Math.max(Number(host.dataset.cameraPaddingSampleMaxMs ?? 0), performance.now() - sampledAt).toFixed(2);
          return material;
        }, () => visiblePaddingKeys.has(id) ? 1 : 3).then(async material => {
          if (!material || !valid()) return;
          await assetLease.load(requiredGroundAssets([material.chunk], "DETAIL"), loadTextureAssets);
          if (!valid()) return;
          const prepared = await scheduleGroundBake(`padding-terrain:${++nextPaddingBakeId}:${id}`, valid,
            () => {
              const startedAt = performance.now();
              const terrainView = createTerrainView(material.chunk, "DETAIL", material.kindAt);
              host.dataset.cameraPaddingBakeMaxMs = Math.max(Number(host.dataset.cameraPaddingBakeMaxMs ?? 0), performance.now() - startedAt).toFixed(2);
              host.dataset.cameraPaddingBakes = String(Number(host.dataset.cameraPaddingBakes ?? 0) + 1);
              return { terrainView };
            }, () => visiblePaddingKeys.has(id) ? 0 : 2);
          if (!prepared?.terrainView) return;
          if (!valid()) { destroyGroundView(prepared.terrainView); return; }
          record.terrainView = prepared.terrainView;
          terrainLayer.addChildAt(prepared.terrainView, 0);
          removeNativePadding(record);
          ensurePaddingTrees(id, record, x, y);
        }).catch(() => {
          if (!valid()) return;
          record.terrainFailed = true;
          host.dataset.loadError = "true";
          setMapLoadError("Не удалось загрузить материал ландшафта. Повторите загрузку карты.");
        }).finally(() => {
          record.terrainPending = false;
          reportPaddingRoads();
          if (valid() && reducedMotion) app.render();
        });
        trackPaddingWork(work);
      };
      const ensurePaddingTrees = (id: string, record: PaddingGround, x: number, y: number) => {
        if (!cityTreePadding || !record.terrainView || record.treePending || record.treeComplete) return;
        const provider = cityTreePadding;
        record.treePending = true;
        const valid = () => !disposed && cityTreePadding === provider && paddingTerrain.get(id) === record;
        const work = scheduleGroundBake(`padding-tree-sample:${++nextPaddingBakeId}:${id}`, valid, () => {
          const startedAt = performance.now();
          const trees = provider.get(x, y);
          host.dataset.cameraPaddingTreeSampleMaxMs = Math.max(Number(host.dataset.cameraPaddingTreeSampleMaxMs ?? 0), performance.now() - startedAt).toFixed(2);
          return trees;
        }, () => visiblePaddingKeys.has(id) ? 2 : 5).then(async trees => {
          if (!trees || !valid()) return;
          record.trees = trees;
          if (!trees.length) { record.treeViews = []; record.treeComplete = true; return; }
          await assetLease.load([PROP_ATLAS.path], loadTextureAssets);
          if (!valid()) return;
          await scheduleGroundBake(`padding-trees:${++nextPaddingBakeId}:${id}`, valid, () => {
            const startedAt = performance.now();
            const atlasTexture = Texture.from(PROP_ATLAS.path);
            const views: Sprite[] = [], bands = new Set<Container>();
            for (const tree of trees) if (!PROP_CATALOG[tree.kind] || !PROP_ATLAS.frames[tree.kind]) throw new Error(`Missing natural tree asset ${tree.kind}`);
            for (const tree of trees) {
              const metadata = PROP_CATALOG[tree.kind], frame = PROP_ATLAS.frames[tree.kind];
              if (!metadata || !frame) throw new Error(`Missing natural tree asset ${tree.kind}`);
              let texture = propAtlasTextures.get(tree.kind);
              if (!texture) {
                texture = pixelAtlasFrame(atlasTexture, frame);
                propAtlasTextures.set(tree.kind, texture);
              }
              const baseline = tree.origin.y + metadata.footprint.height;
              let band = paddingTreeBands.get(baseline);
              if (!band) {
                band = registerWorldObject(new Container({ isRenderGroup: false, label: `padding-tree-band:${baseline}` }), "DECORATION");
                band.y = baseline * CELL_SIZE; worldObjectLayer.addChild(band); paddingTreeBands.set(baseline, band);
              }
              const anchor = decorationWorldAnchor(tree.kind, tree.origin, metadata.footprint, CELL_SIZE);
              const view = new Sprite(texture);
              view.anchor.set(metadata.anchor.x / metadata.size.width, metadata.anchor.y / metadata.size.height);
              view.position.set(anchor.x, anchor.y - baseline * CELL_SIZE); view.roundPixels = true; view.eventMode = "none";
              band.addChild(view); bands.add(band); views.push(view);
            }
            for (const band of bands) band.children.sort((left, right) => left.x - right.x);
            record.treeViews = views; record.treeComplete = true; sortWorldObjects();
            host.dataset.cameraPaddingTreeCreateMaxMs = Math.max(Number(host.dataset.cameraPaddingTreeCreateMaxMs ?? 0), performance.now() - startedAt).toFixed(2);
          }, () => visiblePaddingKeys.has(id) ? 2 : 4);
        }).catch(() => {
          if (!valid()) return;
          record.treeComplete = true; record.treeFailed = true; host.dataset.loadError = "true";
          setMapLoadError("Не удалось загрузить деревья за границей города. Повторите загрузку карты.");
        }).finally(() => { record.treePending = false; reportPaddingRoads(); if (valid() && reducedMotion) app.render(); });
        trackPaddingWork(work);
      };
      const ensurePaddingRoads = (id: string, record: PaddingGround, x: number, y: number) => {
        if (!cityRoadPadding || record.roadComplete || record.roadPending) return;
        const provider = cityRoadPadding;
        const roads = provider.get(x, y);
        if (!roads) { record.roadComplete = true; return; }
        record.roads = roads;
        record.roadPending = true;
        const valid = () => !disposed && cityRoadPadding === provider && paddingTerrain.get(id) === record;
        // Road atlases are acquired once with the resident scene. Padding owns
        // only a clipped transparent overlay, never remote entities or reads.
        const work = scheduleGroundBake(`padding:${++nextPaddingBakeId}:${cityScene!.sceneRevision}:${id}`, valid, () => ({
          overlayView: createInfrastructureOverlayView({ chunkX: x, chunkY: y, size: chunkSize,
            roads: roads.roads, surfaces: roads.surfaces }, "DETAIL", roads),
        }), () => visiblePaddingKeys.has(id) ? 0 : 2).then(prepared => {
          if (!prepared?.overlayView) return;
          if (!valid()) { destroyGroundView(prepared.overlayView); return; }
          record.overlayView = prepared.overlayView;
          record.roadComplete = true;
          surfaceLayer.addChild(prepared.overlayView);
        }).catch(() => {
          if (!valid()) return;
          record.roadComplete = true;
          record.roadFailed = true;
          host.dataset.loadError = "true";
          setMapLoadError("Не удалось нарисовать выезд из города. Повторите загрузку карты.");
        }).finally(() => {
          record.roadPending = false;
          reportPaddingRoads();
          if (valid() && reducedMotion) app.render();
        });
        trackPaddingWork(work);
      };
      const refreshCameraPadding = () => {
        if (!focusCityId) return;
        const visible = cameraTerrainPadding(world.position, world.scale.x, app.screen, cameraBounds(), CELL_SIZE, chunkSize);
        visiblePaddingKeys = new Set(visible.map(([x, y]) => chunkKey(x, y)));
        const coordinates = cameraTerrainPadding(world.position, world.scale.x, app.screen, cameraBounds(), CELL_SIZE, chunkSize, 1);
        const wanted = new Set(coordinates.map(([x, y]) => chunkKey(x, y)));
        cityRoadPadding?.retain(coordinates);
        cityTerrainPadding?.retain(coordinates);
        cityTreePadding?.retain(coordinates);
        for (const [id, record] of paddingTerrain) if (!wanted.has(id)) {
          removePaddingGround(record); paddingTerrain.delete(id);
        }
        // Visible work precedes a single local halo, never an entire country.
        coordinates.sort((a, b) => Number(visiblePaddingKeys.has(chunkKey(...b))) - Number(visiblePaddingKeys.has(chunkKey(...a))));
        for (const [x, y] of coordinates) {
          const id = chunkKey(x, y);
          let record = paddingTerrain.get(id);
          if (!record) {
            record = {};
            paddingTerrain.set(id, record);
          }
          ensurePaddingTerrain(id, record, x, y);
          ensurePaddingRoads(id, record, x, y);
          ensurePaddingTrees(id, record, x, y);
        }
        // First visible frame only: exact native tiles, not a flat fallback or
        // a render-target bake in the input handler. Both work and retained
        // temporary sprites have a measured hard cell cap. Larger misses stay
        // explicitly deferred to the normal bounded queue.
        if (paintedFrame && cityTerrainAtlasesReady && cityTerrainPadding) {
          const startedAt = performance.now();
          const missing = visible.filter(([x, y]) => !paddingTerrain.get(chunkKey(x, y))?.terrainView);
          const budget = Math.max(0, Math.min(IMMEDIATE_PADDING_CELL_LIMIT - nativeFrameCells,
            IMMEDIATE_PADDING_CELL_LIMIT - nativePaddingCells.size));
          const plan = planImmediatePadding(world.position, world.scale.x, app.screen, missing, nativePaddingCells, budget, CELL_SIZE, chunkSize);
          for (const region of plan.regions) {
            const record = paddingTerrain.get(chunkKey(region.chunkX, region.chunkY))!;
            const fragment = cityTerrainPadding.getPartial(region.chunkX, region.chunkY, region.cells);
            if (!fragment) continue;
            if (!record.nativeView) {
              record.nativeView = new Container({ eventMode: "none" }); record.nativeCells = [];
              terrainLayer.addChildAt(record.nativeView, 0);
            }
            for (const cell of fragment.terrain) {
              record.nativeView.addChild(terrainSprite(cell, fragment.kindAt));
              const id = key(cell); record.nativeCells!.push(id); nativePaddingCells.add(id); nativeFrameCells++;
            }
          }
          if (plan.cells) {
            host.dataset.cameraPaddingNativeFrameMaxCells = String(Math.max(Number(host.dataset.cameraPaddingNativeFrameMaxCells ?? 0), nativeFrameCells));
            if (!nativeFrameReset) nativeFrameReset = requestAnimationFrame(() => { nativeFrameCells = 0; nativeFrameReset = 0; });
          }
          host.dataset.cameraPaddingNativeDeferred = String(!plan.complete);
          for (const coordinate of missing) {
            const record = paddingTerrain.get(chunkKey(...coordinate))!;
            record.nativeCovered = planImmediatePadding(world.position, world.scale.x, app.screen, [coordinate], nativePaddingCells, 0, CELL_SIZE, chunkSize).complete;
          }
          if (missing.length) host.dataset.cameraPaddingNativeMaxMs = Math.max(Number(host.dataset.cameraPaddingNativeMaxMs ?? 0), performance.now() - startedAt).toFixed(2);
        }
        for (const id of visiblePaddingKeys) {
          const record = paddingTerrain.get(id)!;
          if (paintedFrame && !record.terrainView && !record.nativeCovered && !record.visibleMissReported) {
            record.visibleMissReported = true;
            host.dataset.cameraPaddingVisibleMisses = String(Number(host.dataset.cameraPaddingVisibleMisses ?? 0) + 1);
          }
        }
        host.dataset.cameraPaddingChunks = String(paddingTerrain.size);
        reportPaddingRoads();
      };
      const installCityRoadPadding = (scene: CitySceneDto) => {
        cityRoadPadding?.retain([]);
        cityRoadPadding = new CityRoadPadding(scene, cell => isBuildableTerrain(terrainAt(terrainSeed, cell.x, cell.y).terrain));
        cityTerrainPadding?.retain([]);
        cityTerrainPadding = new CityTerrainPadding(terrainSeed, chunkSize, scene.chunks);
        cityTreePadding?.retain([]);
        cityTreePadding = new CityTreePadding(scene, terrainSeed, cityTerrainPadding, cityRoadPadding);
        for (const [id, record] of paddingTerrain) {
          // Terrain is immutable, but road/task edits must clear affected
          // exterior crowns and let the same exclusion policy rebuild them.
          removePaddingGround({ ...record, terrainView: undefined });
          // Replace the record identity too, fencing unfinished old bakes.
          paddingTerrain.set(id, { terrainView: record.terrainView });
        }
        host.dataset.intercityRoadRoutes = String(scene.intercityRoads.length);
        refreshCameraPadding();
      };
      const clampCamera = () => {
        const minimumScale = cameraMinimumScale();
        host.dataset.minimumRenderScale = String(minimumScale);
        if (world.scale.x < minimumScale) {
          cameraTargetScale = Math.max(cameraTargetScale, minimumScale);
          const scale = pixelPerfectCameraScale(minimumScale, minimumScale);
          world.scale.set(scale);
          host.dataset.renderScale = String(scale);
        }
        const clamped = clampCameraPosition(world.position, world.scale.x, app.screen, cameraBounds(), CELL_SIZE);
        world.position.set(clamped.x, clamped.y);
        refreshCameraPadding();
        host.dataset.cameraWorldX = ((app.screen.width / 2 - world.position.x) / world.scale.x / CELL_SIZE).toFixed(2);
        host.dataset.cameraWorldY = ((app.screen.height / 2 - world.position.y) / world.scale.y / CELL_SIZE).toFixed(2);
      };
      const scheduleVisibleLoad = () => {
        cancelAnimationFrame(panFrame);
        panFrame = requestAnimationFrame(() => {
          if (visibleLoaderReady) void loadVisible();
        });
      };
      const animateCameraZoom = (ticker: { deltaMS: number }) => {
        if (!cameraZoomAnchor) return;
        const nextScale = reducedMotion
          ? cameraTargetScale
          : smoothCameraScale(world.scale.x, cameraTargetScale, ticker.deltaMS);
        world.scale.set(nextScale);
        host.dataset.renderScale = String(nextScale);
        world.position.set(
          cameraZoomAnchor.screenX - cameraZoomAnchor.localX * nextScale,
          cameraZoomAnchor.screenY - cameraZoomAnchor.localY * nextScale,
        );
        clampCamera();
        if (nextScale === cameraTargetScale) {
          cameraZoomAnchor = undefined;
          void loadVisible();
        }
      };
      app.ticker.add(animateCameraZoom);
      startupDisposers.push(() => app.ticker.remove(animateCameraZoom));
      clampCamera();
      const scheduleResize = () => {
        cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(() => {
          // ResizePlugin and ResizeObserver are independent signals: a browser
          // viewport resize can deliver either one first, and under load an
          // unchanged observer box may not deliver at all. Coalesce both into
          // one synchronous resize + chunk-range calculation.
          app.resize();
          world.position.x += (app.screen.width - screenSize.width) / 2;
          world.position.y += (app.screen.height - screenSize.height) / 2;
          screenSize = { width: app.screen.width, height: app.screen.height };
          app.stage.hitArea = app.screen;
          clampCamera();
          if (visibleLoaderReady) void loadVisible();
        });
      };
      const resizeObserver = new ResizeObserver(scheduleResize);
      resizeObserver.observe(host);
      startupDisposers.push(() => resizeObserver.disconnect());
      window.addEventListener("resize", scheduleResize);
      startupDisposers.push(() => window.removeEventListener("resize", scheduleResize));
      app.stage.eventMode = "static";
      app.stage.hitArea = app.screen;
      const disposeGestures = bindMapPointerGestures(canvas, (gesture) => {
        const oldScale = world.scale.x;
        if (gesture.scale !== 1) {
          const rect = canvas.getBoundingClientRect();
          const screenX = gesture.center.x - rect.left;
          const screenY = gesture.center.y - rect.top;
          const localX = (screenX - gesture.panX - world.position.x) / oldScale;
          const localY = (screenY - gesture.panY - world.position.y) / oldScale;
          cameraTargetScale = nextCameraTargetScale(cameraTargetScale, -Math.log(gesture.scale) / .0015);
          world.scale.set(cameraTargetScale);
          world.position.set(screenX - localX * cameraTargetScale, screenY - localY * cameraTargetScale);
          cameraZoomAnchor = undefined;
          host.dataset.renderScale = String(cameraTargetScale);
        } else {
          world.position.x += gesture.panX;
          world.position.y += gesture.panY;
        }
        clampCamera();
        scheduleVisibleLoad();
        host.dataset.gesturePointers = String(gesture.pointers);
      }, { onNavigationStart: () => {
        // Pixi can synthesize a tap on the first finger's release, or after a
        // slow held drag. Suppress from classification until all contacts end.
        suppressSelectionUntil = Infinity;
      }, onEnd: (moved) => {
        if (moved) suppressSelectionUntil = performance.now() + 500;
        delete host.dataset.gesturePointers;
        void loadVisible();
      } });
      startupDisposers.push(disposeGestures);

      function destroyGroundView(view: Sprite): void {
        const texture = view.texture;
        view.removeFromParent();
        view.destroy();
        texture.destroy(true);
      }

      function removeGround(cacheKey: string, reason: "replace" | "prune" | "dispose" = "dispose"): void {
        seedGroundKeys.delete(cacheKey);
        const record = groundContainers.get(cacheKey);
        if (!record) return;
        seedTerrainSamples.delete(`${cacheKey}:${record.lod}`);
        const metric = `groundRemove${reason[0]!.toUpperCase()}${reason.slice(1)}`;
        host!.dataset[metric] = String(Number(host!.dataset[metric] ?? 0) + 1);
        destroyGroundView(record.terrainView);
        if (record.overlayView) destroyGroundView(record.overlayView);
        groundContainers.delete(cacheKey);
        host!.dataset.staticGroundViews = String(groundContainers.size);
        host!.dataset.infrastructureOverlayViews = String([...groundContainers.values()].filter((item) => item.overlayView).length);
      }

      const updateGroundLodDiagnostics = (): void => {
        const activeLods = new Set<MapLod>();
        for (const cacheKey of desiredKeys) {
          const ground = groundContainers.get(cacheKey);
          if (ground) activeLods.add(ground.lod);
        }
        host!.dataset.activeGroundLods = [...activeLods].sort().map((lod) => lod.toLowerCase()).join(",");
        host!.dataset.mixedGroundLods = String(activeLods.size > 1);
      };

      const groundTextureBaker = new GroundTextureBaker(app.renderer);
      startupDisposers.push(() => groundTextureBaker.destroy());
      function bakeGroundTexture(source: Container | Graphics, chunkX: number, chunkY: number, size: number, lod: MapLod): Sprite {
        const bakeStartedAt = performance.now();
        const originX = chunkX * size * CELL_SIZE;
        const originY = chunkY * size * CELL_SIZE;
        const texture = groundTextureBaker.bake(source, {
          frame: new Rectangle(originX, originY, size * CELL_SIZE, size * CELL_SIZE),
          // The render target is uploaded during generateTexture. Configure its
          // sampler before that upload; mutating scaleMode afterwards does not
          // notify Pixi's already-created WebGL sampler.
          textureSourceOptions: { scaleMode: "nearest" },
          resolution: lod === "OVERVIEW"
            ? desiredKeys.size > GROUND_CACHE_LIMIT ? ULTRA_WIDE_GROUND_TEXTURE_RESOLUTION : OVERVIEW_GROUND_TEXTURE_RESOLUTION
            : 1,
          antialias: false,
        });
        host!.dataset.groundTextureResolution = String(texture.source.resolution);
        texture.source.scaleMode = "nearest";
        const view = new Sprite(texture);
        view.position.set(originX, originY);
        view.eventMode = "none";
        exposeRollingMetric(host!, "groundBake", groundBakeMetric, performance.now() - bakeStartedAt);
        return view;
      }

      function createTerrainView(chunk: TerrainGroundChunk, lod: MapLod,
        capturedKindAt?: (column: number, row: number) => AtlasTerrainKind | undefined): Sprite {
        const source = new Container();
        source.eventMode = "none";
        if (lod === "DETAIL") {
          const terrain = new Container();
          const terrainAtCell = capturedKindAt ?? createGroundTerrainSampler(chunk,
            (column, row) => atlasTerrainKindFromWorld(terrainAt(terrainSeed, column, row).terrain));
          for (const cell of chunk.terrain) terrain.addChild(terrainSprite(cell, terrainAtCell));
          source.addChild(terrain);
        } else {
          const terrainGraphics = new Graphics();
          for (const cell of chunk.terrain) {
            const localX = cell.x - chunk.chunkX * chunk.size;
            const localY = cell.y - chunk.chunkY * chunk.size;
            if (localX % 4 !== 0 || localY % 4 !== 0) continue;
            terrainGraphics.rect(cell.x * CELL_SIZE, cell.y * CELL_SIZE, CELL_SIZE * 4, CELL_SIZE * 4)
              .fill(TERRAIN_COLORS[cell.terrain] ?? TERRAIN_COLORS.GRASS);
          }
          source.addChild(terrainGraphics);
        }
        return bakeGroundTexture(source, chunk.chunkX, chunk.chunkY, chunk.size, lod);
      }

      function createInfrastructureOverlayView(chunk: Pick<ChunkDto, "chunkX" | "chunkY" | "size" | "roads" | "surfaces">, lod: MapLod,
        context?: Pick<CityRoadPaddingChunk, "roadContext" | "surfaceContext">): Sprite {
        const source = new Container();
        source.eventMode = "none";
        if (lod === "DETAIL") {
          const surfaces = new Container();
          const roads = new Container();
          const surfaceMap = context?.surfaceContext ?? new Map(chunk.surfaces.map((surface) => [key(surface), surface]));
          for (const surface of chunk.surfaces) {
            const view = drawSurface(surface, surfaceMap);
            if (view) surfaces.addChild(view);
          }
          const roadMap = context?.roadContext ?? new Map(chunk.roads.map((road) => [key(road), road]));
          for (const road of chunk.roads) roads.addChild(drawRoad(road, surfaceMap, roadMap));
          source.addChild(surfaces, roads);
        } else {
          const surfaceGraphics = new Graphics();
          for (const surface of chunk.surfaces) {
            const color = surface.finish === "ASPHALT" ? 0x59636c : surface.finish === "PAVERS" ? 0x8d8f87 : 0x8b6949;
            surfaceGraphics.rect(surface.x * CELL_SIZE + 1, surface.y * CELL_SIZE + 1, CELL_SIZE - 2, CELL_SIZE - 2)
              .fill({ color, alpha: 0.92 });
          }
          const roadGraphics = new Graphics();
          for (const road of chunk.roads) {
            const color = road.roadClass === "HIGHWAY" ? 0x283542 : road.roadClass === "ARTERIAL" ? 0x32414d
              : road.roadClass === "COLLECTOR" ? 0x3e4e58 : 0x4b5a61;
            roadGraphics.rect(road.x * CELL_SIZE, road.y * CELL_SIZE, CELL_SIZE, CELL_SIZE).fill(color);
          }
          source.addChild(surfaceGraphics, roadGraphics);
        }
        return bakeGroundTexture(source, chunk.chunkX, chunk.chunkY, chunk.size, lod);
      }

      /** Synchronous seed terrain: no request, worker, PNG decode or asset wait. */
      function createImmediateSeedGroundView(chunkX: number, chunkY: number, lod: MapLod): { view: Sprite; samples: Uint8Array } {
        const step = lod === "OVERVIEW" ? 4 : 1;
        const originX = chunkX * chunkSize;
        const originY = chunkY * chunkSize;
        const graphics = new Graphics();
        const samples = new Uint8Array((chunkSize / step) ** 2);
        let sampleIndex = 0;
        for (let y = originY; y < originY + chunkSize; y += step) {
          for (let x = originX; x < originX + chunkSize; x += step) {
            const terrain = terrainAt(terrainSeed, x, y);
            samples[sampleIndex++] = encodeTerrainSample(terrain);
            const presentation = seedTerrainCellPresentation(terrainSeed, { x, y, ...terrain });
            graphics.rect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE * step, CELL_SIZE * step)
              .fill(presentation.fill);
            const accentSize = step === 1 ? 1 : 2;
            for (const accent of presentation.accents) {
              graphics.rect(
                x * CELL_SIZE + accent.x * step,
                y * CELL_SIZE + accent.y * step,
                accentSize,
                accentSize,
              ).fill(accent.color);
            }
          }
        }
        const texture = app.renderer.textureGenerator.generateTexture({
          target: graphics,
          frame: new Rectangle(originX * CELL_SIZE, originY * CELL_SIZE, chunkSize * CELL_SIZE, chunkSize * CELL_SIZE),
          resolution: lod === "OVERVIEW"
            ? desiredKeys.size > GROUND_CACHE_LIMIT ? ULTRA_WIDE_GROUND_TEXTURE_RESOLUTION : OVERVIEW_GROUND_TEXTURE_RESOLUTION
            : 1,
          antialias: false,
        });
        texture.source.scaleMode = "nearest";
        graphics.destroy();
        const view = new Sprite(texture);
        view.position.set(originX * CELL_SIZE, originY * CELL_SIZE);
        view.eventMode = "none";
        return { view, samples };
      }

      function installSeedTerrain(cacheKey: string, view: Sprite, lod: MapLod): void {
        const existing = groundContainers.get(cacheKey);
        if (existing?.lod === lod) {
          destroyGroundView(view);
          return;
        }
        if (existing) removeGround(cacheKey, "replace");
        terrainLayer.addChild(view);
        groundContainers.set(cacheKey, { terrainView: view, lod, usedAt: performance.now() });
        host!.dataset.staticGroundViews = String(groundContainers.size);
        updateGroundLodDiagnostics();
      }

      function installGround(cacheKey: string, prepared: PreparedGround, lod: MapLod, animate = false): void {
        if (!prepared.overlayView) throw new Error(`Infrastructure ${cacheKey}:${lod} is missing from a resident bake`);
        let record = groundContainers.get(cacheKey);
        if (!record || record.lod !== lod) {
          if (!prepared.terrainView) throw new Error(`Terrain ${cacheKey}:${lod} is missing for a new ground record`);
          if (record) removeGround(cacheKey, "replace");
          terrainLayer.addChild(prepared.terrainView);
          record = { terrainView: prepared.terrainView, lod, usedAt: performance.now() };
          groundContainers.set(cacheKey, record);
        } else if (prepared.terrainView) {
          destroyGroundView(prepared.terrainView);
        }
        if (record.overlayView) destroyGroundView(record.overlayView);
        surfaceLayer.addChild(prepared.overlayView);
        if (animate && !reducedMotion) {
          prepared.overlayView.alpha = 0;
          groundFades.push({ containers: [prepared.overlayView], elapsed: 0, duration: 360 });
        }
        record.overlayView = prepared.overlayView;
        record.usedAt = performance.now();
        // Stale/failed generations can install partial ground and never reach
        // the end-of-generation pruning pass. Enforce the GPU bound at the
        // ownership point so rapid pan/LOD churn cannot accumulate textures.
        pruneGroundCache(desiredKeys);
        host!.dataset.staticGroundViews = String(groundContainers.size);
        host!.dataset.infrastructureOverlayViews = String([...groundContainers.values()].filter((item) => item.overlayView).length);
        updateGroundLodDiagnostics();
      }

      const primeSeedGround = (chunkX: number, chunkY: number, lod: MapLod, generation: number): Promise<void> => {
        const cacheKey = chunkKey(chunkX, chunkY);
        if (groundContainers.has(cacheKey)) return Promise.resolve();
        const existing = pendingSeedGrounds.get(cacheKey);
        if (existing) return existing;
        const promise = Promise.resolve().then(() => {
          if (disposed || generation !== loadGeneration || desiredLod !== lod || !desiredKeys.has(cacheKey) || groundContainers.has(cacheKey)) return;
          const immediate = createImmediateSeedGroundView(chunkX, chunkY, lod);
          installSeedTerrain(cacheKey, immediate.view, lod);
          seedTerrainSamples.set(`${cacheKey}:${lod}`, immediate.samples);
          seedGroundKeys.add(cacheKey);
          host!.dataset.seedGroundPrimes = String(Number(host!.dataset.seedGroundPrimes ?? 0) + 1);
          host!.dataset.seedFirstFrame = "true";
          host!.dataset.seedFirstFrameMode = "synchronous";
          host!.dataset.seedTerrainPattern = "procedural-pixel-v2";
          if (!cityScene) {
            setFirstFrameReady(true);
            paintedFrame = true;
          }
          if (reducedMotion) app.render();
        }).finally(() => pendingSeedGrounds.delete(cacheKey));
        pendingSeedGrounds.set(cacheKey, promise);
        return promise;
      };

      function renderEntities(rebuildMovement: boolean): void {
        const districts = new Map<string, ChunkDistrictDto>();
        const tasks = new Map<string, ChunkTaskDto>();
        const roads = new Map<string, RoadCellDto>();
        const surfaces = new Map<string, SurfaceCellDto>();
        const terrain = new Map<string, ChunkDto["terrain"][number]>();
        const decorations = new Map<string, ChunkDto["decorations"][number]>();
        const features = new Map<string, WorldFeatureDto>();
        const plannedSites = new Map<string, PlannedSiteDto>();
        const blockPlaques = new Map<string, BlockPlaqueDto>();
        for (const [cacheKey, chunk] of entityChunks) {
          if (entityChunkLods.get(cacheKey) !== currentLod) continue;
          for (const cell of chunk.terrain) terrain.set(key(cell), cell);
          for (const road of chunk.roads) roads.set(key(road), road);
          for (const surface of chunk.surfaces) surfaces.set(key(surface), surface);
          for (const district of chunk.districts) {
            const existing = districts.get(district.id);
            if (!existing) districts.set(district.id, district);
            else {
              const cells = new Map([...existing.cells, ...district.cells].map((cell) => [key(cell), cell]));
              districts.set(district.id, { ...district, cells: [...cells.values()] });
            }
          }
          for (const task of chunk.tasks) tasks.set(task.id, task);
          for (const decoration of chunk.decorations) decorations.set(decoration.id, decoration);
          for (const feature of chunk.worldFeatures) features.set(feature.id, feature);
          if (currentLod === "DETAIL") for (const site of chunk.plannedSites ?? []) plannedSites.set(site.id, site);
          if (currentLod === "DETAIL") for (const plaque of chunk.blockPlaques ?? []) blockPlaques.set(plaque.id, plaque);
        }
        for (const task of completedSnapshotTasks.values()) tasks.set(task.id, task);
        if (latestTaskStatusPatches.size) host!.dataset.realtimeRenderedTasks = JSON.stringify(
          [...tasks.values()].filter(task => latestTaskStatusPatches.has(task.id)).map(task => ({ taskId: task.id, stage: task.stage })),
        );
        // One ground-level batch can span chunk borders; no per-slot textures or
        // opaque platforms hide the terrain while a parcel is only reserved.
        plannedSiteMarks.clear();
        const occupiedTaskCells = new Set([...tasks.values()].flatMap((task) => task.footprint.map(key)));
        const plannedColors: Record<PlannedSiteDto["kind"], number> = {
          BUILDING: 0xa6aa84, PARK: 0x91a574, WATER: 0x789995, PARKING: 0x90988b,
        };
        let visiblePlannedSites = 0;
        for (const site of plannedSites.values()) {
          let occupied = false;
          for (let y = 0; y < site.height && !occupied; y += 1) {
            for (let x = 0; x < site.width; x += 1) {
              if (occupiedTaskCells.has(key({ x: site.origin.x + x, y: site.origin.y + y }))) { occupied = true; break; }
            }
          }
          if (occupied) continue;
          const left = site.origin.x * CELL_SIZE + 1;
          const top = site.origin.y * CELL_SIZE + 1;
          const right = (site.origin.x + site.width) * CELL_SIZE - 2;
          const bottom = (site.origin.y + site.height) * CELL_SIZE - 2;
          for (const [x, y, dx, dy] of [[left, top, 1, 1], [right, top, -1, 1], [left, bottom, 1, -1], [right, bottom, -1, -1]] as const) {
            plannedSiteMarks.rect(x + (dx < 0 ? -3 : 0), y, 4, 1)
              .rect(x, y + (dy < 0 ? -3 : 0), 1, 4);
          }
          plannedSiteMarks.fill(plannedColors[site.kind]);
          visiblePlannedSites += 1;
        }
        host!.dataset.plannedSites = String(visiblePlannedSites);
        const plaqueSignature = JSON.stringify([...blockPlaques.values()]);
        if (plaqueSignature !== blockPlaqueSignature) {
          blockPlaqueSignature = plaqueSignature;
          for (const child of blockPlaqueLayer.removeChildren()) child.destroy({ children: true });
          for (const plaque of blockPlaques.values()) {
            const text = plaque.label.length > 18 ? `${plaque.label.split(", ")[0]} · ${plaque.taskCount} задач` : plaque.label;
            const label = new Text({ text, resolution: 2, style: new TextStyle({ fontFamily: "monospace", fontSize: 5, fontWeight: "700", fill: 0xeee0b2 }) });
            label.anchor.set(0.5);
            const panel = new Container();
            panel.position.set(plaque.origin.x * CELL_SIZE, plaque.origin.y * CELL_SIZE + 3);
            panel.addChild(new Graphics().rect(-label.width / 2 - 2, -4, label.width + 4, 8)
              .fill(0x485744).stroke({ color: 0xaca77a, width: 1 }), label);
            blockPlaqueLayer.addChild(panel);
          }
        }
        host!.dataset.blockPlaques = String(blockPlaques.size);
        const reconcile = <T extends RenderNode, D>(
          source: Map<string, D>,
          records: Map<string, EntityViewRecord<T>>,
          layer: Container,
          factory: (item: D) => T | null,
          signatureOf: (item: D) => string = JSON.stringify,
          worldKind?: WorldObjectKind,
        ) => {
          entityReplacementCount += reconcileEntityViews({
            source, records, signatureOf, create: factory,
            attach: (view) => {
              if (worldKind) registerWorldObject(view, worldKind);
              layer.addChild(view);
              if (!reducedMotion) {
                view.alpha = 0;
                groundFades.push({ containers: [view], elapsed: 0, duration: 280 });
              }
            },
            dispose: (view) => { view.removeFromParent(); view.destroy({ children: true }); },
          });
        };

        const staticDecorations = currentLod === "DETAIL"
          ? [...decorations.values()].filter((decoration) => !isAnimatedDecoration(decoration.kind))
          : [];
        const lamps = staticDecorations.filter(item => illuminatedPropKey(item.kind) !== item.kind);
        const nextLampSignature = lamps.map(item => item.id).sort().join("|");
        if (lampSignature !== nextLampSignature) {
          lampSignature = nextLampSignature;
          lampGlow.clear();
          for (const lamp of lamps) {
            const metadata = PROP_CATALOG[lamp.kind];
            if (!metadata) continue;
            const anchor = decorationWorldAnchor(lamp.kind, lamp.origin, metadata.footprint, CELL_SIZE);
            // Stepped pools on the ground, below buildings/trees, not blurred
            // full-screen filters or a separate ticker for every lamppost.
            const x = Math.round(anchor.x); const y = Math.round(anchor.y);
            lampGlow.rect(x - 10, y - 6, 20, 12).fill({ color: 0xffcf76, alpha: .12 });
            lampGlow.rect(x - 7, y - 4, 14, 8).fill({ color: 0xffda8b, alpha: .18 });
            lampGlow.rect(x - 3, y - 2, 6, 4).fill({ color: 0xffe6a6, alpha: .28 });
          }
        }
        host!.dataset.illuminatedLamps = String(lamps.length);
        const nextStaticDecorationSignature = staticDecorationRenderSignature(staticDecorations);
        if (nextStaticDecorationSignature !== staticDecorationSignature) {
          for (const layer of staticDecorationLayers) {
            layer.removeFromParent();
            layer.destroy();
          }
          staticDecorationLayers = [];
          lampSprites = [];
          propShadows.clear();
          staticDecorationSignature = nextStaticDecorationSignature;
          staticDecorationParticleCount = 0;
          if (staticDecorations.length > 0) {
            const atlasTexture = Texture.from(PROP_ATLAS.path);
            const spritesByBaseline = new Map<number, Sprite[]>();
            for (const decoration of staticDecorations) {
              const metadata = PROP_CATALOG[decoration.kind];
              const frame = PROP_ATLAS.frames[decoration.kind];
              if (!metadata || !frame) continue;
              let texture = propAtlasTextures.get(decoration.kind);
              if (!texture) {
                texture = pixelAtlasFrame(atlasTexture, frame);
                propAtlasTextures.set(decoration.kind, texture);
              }
              const baseline = decoration.origin.y + metadata.footprint.height;
              const anchorPosition = decorationWorldAnchor(decoration.kind, decoration.origin, metadata.footprint, CELL_SIZE);
              if (decoration.kind.startsWith("tree-") || illuminatedPropKey(decoration.kind) !== decoration.kind) {
                propShadows.rect(Math.round(anchorPosition.x) - 2, Math.round(anchorPosition.y), 5, 2).fill(0x182a2c);
              }
              const view = new Sprite(texture);
              const litKey = illuminatedPropKey(decoration.kind);
              const litFrame = litKey !== decoration.kind ? PROP_ATLAS.frames[litKey] : undefined;
              if (litFrame) {
                let night = propAtlasTextures.get(litKey);
                if (!night) {
                  night = pixelAtlasFrame(atlasTexture, litFrame);
                  propAtlasTextures.set(litKey, night);
                }
                lampSprites.push({ view, day: texture, night });
                if (lampsOn) view.texture = night;
              }
              view.position.set(
                anchorPosition.x,
                anchorPosition.y - baseline * CELL_SIZE,
              );
              view.anchor.set(
                metadata.anchor.x / metadata.size.width,
                metadata.anchor.y / metadata.size.height,
              );
              view.roundPixels = true;
              view.eventMode = "none";
              const sprites = spritesByBaseline.get(baseline) ?? [];
              sprites.push(view);
              spritesByBaseline.set(baseline, sprites);
              staticDecorationParticleCount += 1;
            }
            for (const [baseline, sprites] of spritesByBaseline) {
              const layer = registerWorldObject(new Container({
                isRenderGroup: false,
                label: `static-decoration-band:${baseline}`,
              }), "DECORATION");
              layer.addChild(...sprites);
              layer.y = baseline * CELL_SIZE;
              worldObjectLayer.addChild(layer);
              staticDecorationLayers.push(layer);
            }
          }
          entityReplacementCount += staticDecorationLayers.length;
        }

        reconcile(districts, districtViews, districtLayer, (district) => drawDistrictBoundary(district, districtTooltipLayer));
        host!.dataset.districtBoundaryGroups = String(districtViews.size);
        host!.dataset.districtBoundaryCells = String([...districts.values()].reduce((count, district) => count + district.cells.length, 0));
        host!.dataset.districtBoundaryVisible = String(districtLayer.visible);
        reconcile(
          currentLod === "DETAIL" ? tasks : new Map<string, ChunkTaskDto>(),
          taskPlatformViews,
          platformLayer,
          drawPlatform,
          (task) => JSON.stringify([task.platformType, task.visualKind, task.visualAssetKey, task.stage, task.footprint]),
        );
        reconcile(
          tasks,
          taskBuildingViews,
          worldObjectLayer,
          (task) => currentLod === "DETAIL"
            ? drawBuilding(task, selectTask, buildingTooltipLayer)
            : drawOverviewBuilding(task, selectTask),
          (task) => `${currentLod}:${JSON.stringify(task)}`,
          "BUILDING",
        );
        const visibleIncidentIds = new Set<string>();
        if (currentLod === "DETAIL") {
          const candidates: Array<{
            id: string;
            task: ChunkTaskDto;
            mode: Exclude<IncidentMode, "NONE">;
            burning: boolean;
            smokeStrength: number;
          }> = [];
          for (const [id, task] of tasks) {
            const mode = incidentMode(task);
            if (mode !== "NONE") {
              const profile = incidentVisualProfile(task);
              candidates.push({ id, task, mode, burning: profile.burning, smokeStrength: profile.smokeStrength });
            }
          }
          const engineAllowance = planIncidentEngines(candidates);
          for (const { id, task, mode } of candidates) {
            const fullResponse = engineAllowance.has(id);
            visibleIncidentIds.add(id);
            const signature = incidentRenderSignature(task, fullResponse);
            const current = incidentViews.get(id);
            if (current?.signature === signature) continue;
            if (current) {
              current.container.removeFromParent();
              current.container.destroy({ children: true });
            }
            const view = drawTaskIncident(task, mode, signature, fullResponse);
            worldObjectLayer.addChild(registerWorldObject(view.container, "INCIDENT"));
            incidentViews.set(id, view);
            entityReplacementCount += 1;
          }
        }
        for (const [id, view] of incidentViews) {
          if (visibleIncidentIds.has(id)) continue;
          view.container.removeFromParent();
          view.container.destroy({ children: true });
          incidentViews.delete(id);
        }
        reconcile(
          currentLod === "DETAIL"
            ? new Map([...decorations].filter(([, decoration]) => isAnimatedDecoration(decoration.kind)))
            : new Map<string, ChunkDto["decorations"][number]>(),
          decorationViews,
          worldObjectLayer,
          drawDecoration,
          JSON.stringify,
          "DECORATION",
        );
        const animatedDecorationIds = new Set<string>();
        if (currentLod === "DETAIL") for (const [id, decoration] of decorations) {
          if (!isAnimatedDecoration(decoration.kind)) continue;
          const record = decorationViews.get(id);
          if (!record) continue;
          animatedDecorationIds.add(id);
          if (!ambientDecorationViews.has(id)) {
            const idSeed = [...id].reduce((value, char) => ((value * 33) ^ char.charCodeAt(0)) >>> 0, sessionSeed);
            ambientDecorationViews.set(id, {
              view: record.view, baseX: record.view.x, baseY: record.view.y,
              phase: nextSeededRandom(idSeed).value, kind: decoration.kind,
            });
          }
        }
        for (const id of ambientDecorationViews.keys()) if (!animatedDecorationIds.has(id)) ambientDecorationViews.delete(id);
        host!.dataset.ambientAnimations = String(ambientDecorationViews.size);
        host!.dataset.staticDecorationParticles = String(staticDecorationParticleCount);
        host!.dataset.staticDecorationLayers = String(staticDecorationLayers.length);
        host!.dataset.decorationSpriteViews = String(decorationViews.size);

        for (const [id, record] of featureViews) {
          if (features.has(id)) continue;
          record.platform?.removeFromParent(); record.platform?.destroy({ children: true });
          record.visual?.removeFromParent(); record.visual?.destroy({ children: true });
          featureViews.delete(id);
        }
        for (const [id, feature] of features) {
          const signature = `${currentLod}:${JSON.stringify(feature)}`;
          const current = featureViews.get(id);
          if (current?.signature === signature) continue;
          if (current) {
            current.platform?.removeFromParent(); current.platform?.destroy({ children: true });
            current.visual?.removeFromParent(); current.visual?.destroy({ children: true });
          }
          const parent = feature.parentFeatureId ? features.get(feature.parentFeatureId) : undefined;
          const drawn = drawWorldFeature(feature, currentLod === "DETAIL", selectArchive, selectSite, parent);
          if (!drawn) { featureViews.delete(id); continue; }
          if (drawn.platform && currentLod === "DETAIL") featurePlatformLayer.addChild(drawn.platform);
          else if (drawn.platform) drawn.platform.destroy({ children: true });
          if (drawn.visual) worldObjectLayer.addChild(registerWorldObject(drawn.visual, "FEATURE"));
          featureViews.set(id, {
            signature,
            platform: currentLod === "DETAIL" ? drawn.platform : undefined,
            visual: drawn.visual,
          });
          entityReplacementCount += 1;
        }
        sortWorldObjects();
        host!.dataset.entityViews = String(
          districtViews.size + taskPlatformViews.size + taskBuildingViews.size + incidentViews.size
            + staticDecorationParticleCount + decorationViews.size + featureViews.size,
        );
        host!.dataset.taskBuildingViews = String(taskBuildingViews.size);
        host!.dataset.siteMarkers = String([...features.values()].filter(feature => feature.siteMarker).length);
        host!.dataset.movedSites = String([...features.values()].filter(feature => feature.siteMarker?.kind === "RELOCATED").length);
        host!.dataset.incidents = String(incidentViews.size);
        host!.dataset.incidentEngines = String([...incidentViews.values()].filter((view) => view.fullResponse).length);
        host!.dataset.hotfixIncidents = String([...incidentViews.values()].filter((view) => view.mode === "HOTFIX_ACTIVE").length);
        host!.dataset.incidentFires = String([...incidentViews.values()].filter((view) => view.profile.burning).length);
        host!.dataset.incidentActiveDefects = String([...incidentViews.values()].reduce((sum, view) => sum + view.profile.activeDefects, 0));
        host!.dataset.incidentSmokeStrength = String(Math.max(0, ...[...incidentViews.values()].map((view) => view.profile.smokeStrength)));
        host!.dataset.incidentWaterJets = String([...incidentViews.values()].filter((view) => view.water.visible).length);
        host!.dataset.incidentWaterTargets = String(Math.max(0, ...[...incidentViews.values()].map((view) => view.waterJet.targets.length)));
        host!.dataset.incidentWaterTargetIndexes = [...incidentViews.values()].filter((view) => view.water.visible).map((view) => view.waterJet.targetIndex).join(",");
        host!.dataset.incidentModes = [...incidentViews.values()].map((view) => view.mode).sort().join(",");
        host!.dataset.entityReplacements = String(entityReplacementCount);

        cityFlightRoutes = cityScene ? cityMicroFlightRoutes(cityScene.airportConnections) : [];
        host!.dataset.airportFlightRoutes = String(cityFlightRoutes.length);
        const { walkGraph, animalGraph, crosswalks, activityCells, blockedCells } = buildCityWalkNetwork({
          roads, terrain: [...terrain.values()], surfaces: [...surfaces.values()],
          tasks: [...tasks.values()], features: [...features.values()], decorations: [...decorations.values()],
        });
        const agentsVisible = currentLod === "DETAIL" && ambientAssetsReady;
        if (agentsVisible) {
          const before = mobilityViews.size + animals.length;
          const input = { roads, walkGraph, crosswalks, activityCells,
            carLimit: Math.min(24, Math.max(3, Math.floor(roads.size / 120))),
            walkerLimit: Math.min(32, Math.max(6, Math.floor(walkGraph.size / 70))) };
          if (mobility) mobility.updateNetwork(input);
          else mobility = createCityMobility({ ...input, seed: sessionSeed });
          const posts = mobility.signals.flatMap(signal => signal.signalPosts.map(post => ({
            ...post, id: `${signal.id}:${post.approach}`,
          })));
          mobilityPostOrigins = new Map(placeCityMobilitySignalPosts({
            posts, terrain, roads, walkGraph, blocked: blockedCells,
          }).map(post => [post.id, post.origin]));
          for (const origin of mobilityPostOrigins.values()) animalGraph.delete(key(origin));
          host!.dataset.mobilityPostPathConflicts = String([...mobilityPostOrigins.values()]
            .filter(origin => walkGraph.has(key(origin)) || roads.has(key(origin)) || blockedCells.has(key(origin))).length);
          mobilityRoads = roads;
          mobilityWalkGraph = walkGraph;
          animals = animals.filter(agent => {
            if (animalGraph.has(key(agent.current)) && animalGraph.has(key(agent.next))) {
              agent.graph = animalGraph;
              return true;
            }
            destroyAnimal(agent);
            return false;
          });
          const candidates = [...animalGraph.values()];
          const occupied = new Set(animals.map(agent => key(agent.current)));
          const limit = Math.min(6, Math.floor(animalGraph.size / 1400));
          for (let attempt = 0; animals.length < limit && attempt < Math.min(64, candidates.length); attempt++) {
            const picked = nextSeededRandom(spawnState); spawnState = picked.state;
            const current = candidates[Math.floor(picked.value * candidates.length)]!;
            if (occupied.has(key(current))) continue;
            const planned = planAgentRoute(animalGraph, current, spawnState, 9);
            spawnState = planned.randomState;
            const next = planned.route[1];
            if (!next) continue;
            const variant = MICRO_ANIMAL_SPECIES[animals.length % MICRO_ANIMAL_SPECIES.length]!;
            const position = residentGroundPosition(current, next, 0, CELL_SIZE);
            const view = sprite(microAmbientSprite("animal", variant).url, position.x, position.y);
            view.anchor.set(0.5);
            worldObjectLayer.addChild(registerWorldObject(view, "AGENT"));
            animals.push({ id: `animal-${nextAgentId++}`, view, graph: animalGraph, current, next,
              progress: 0, speed: 0.00065 + (attempt % 3) * 0.00008, variant, steps: 0,
              randomState: planned.randomState, route: planned.route, routeIndex: 1 });
            occupied.add(key(current));
          }
          drawMobility();
          host!.dataset.agentChanges = String(Math.abs(before - mobilityViews.size - animals.length));
        } else {
          for (const entry of mobilityViews.values()) { entry.view.visible = false; if (entry.marker) entry.marker.visible = false; }
          for (const entry of trafficSignalViews.values()) entry.view.visible = false;
        }
        for (const animal of animals) animal.view.visible = agentsVisible;
        reportMobility();
        sortWorldObjects();
        if (rebuildMovement) host!.dataset.movementRebuilds = String(Number(host!.dataset.movementRebuilds ?? 0) + 1);
        host!.dataset.entityRebuilds = String(Number(host!.dataset.entityRebuilds ?? 0) + 1);
        if (reducedMotion) {
          app.render();
          host!.dataset.staticRenders = String(Number(host!.dataset.staticRenders ?? 0) + 1);
        }
      }

      const lodForScale = (scale: number): MapLod => {
        if (cityScene) return "DETAIL";
        if (currentLod === "DETAIL") return scale < DETAIL_LOD_EXIT_SCALE ? "OVERVIEW" : "DETAIL";
        return scale >= DETAIL_LOD_ENTER_SCALE ? "DETAIL" : "OVERVIEW";
      };
      const dataKey = (cacheKey: string, lod: MapLod) => `${cacheKey}:${lod}`;
      const storeChunkData = (cacheKey: string, lod: MapLod, chunk: ChunkDto) => {
        const key = dataKey(cacheKey, lod);
        chunkDataCache.delete(key);
        chunkDataCache.set(key, chunk);
        while (chunkDataCache.size > Math.max(CHUNK_DATA_CACHE_LIMIT, citySceneChunkCount)) {
          const oldest = chunkDataCache.keys().next().value as string | undefined;
          if (!oldest) break;
          chunkDataCache.delete(oldest);
        }
      };
      const cachedChunkData = (cacheKey: string, lod: MapLod): ChunkDto | undefined => {
        const key = dataKey(cacheKey, lod);
        const cached = chunkDataCache.get(key);
        if (!cached) return undefined;
        chunkDataCache.delete(key);
        chunkDataCache.set(key, cached);
        return cached;
      };
      const storeChunkPayload = (cacheKey: string, lod: MapLod, payload: ChunkPayloadDto) => {
        const key = dataKey(cacheKey, lod);
        chunkPayloadCache.delete(key);
        chunkPayloadCache.set(key, payload);
        while (chunkPayloadCache.size > Math.max(CHUNK_PAYLOAD_CACHE_LIMIT, citySceneChunkCount)) {
          const oldest = chunkPayloadCache.keys().next().value as string | undefined;
          if (!oldest) break;
          chunkPayloadCache.delete(oldest);
        }
      };
      const cachedChunkPayload = (cacheKey: string, lod: MapLod): ChunkPayloadDto | undefined => {
        const key = dataKey(cacheKey, lod);
        const cached = chunkPayloadCache.get(key);
        if (!cached) return undefined;
        chunkPayloadCache.delete(key);
        chunkPayloadCache.set(key, cached);
        return cached;
      };
      if (focusCityId) {
        const scene = rendererAttempt === 0 && initialCitySceneRef.current?.city.id === focusCityId
          ? initialCitySceneRef.current
          : await loadCityScene(countryId, focusCityId, initialWorldRevisionRef.current, rendererAttempt > 0);
        if (scene.schemaVersion !== CITY_SCENE_SCHEMA_VERSION || scene.city.id !== focusCityId || scene.lod !== "DETAIL") {
          throw new Error("Сервер вернул несовместимую сцену города");
        }
        cityScene = scene;
        const cityTerrainKinds: AtlasTerrainKind[] = ["grass", "meadow", "forest", "hill", "mountain", "coast", "river", "stone", "deep_water", "shallow_water"];
        const preloadStarted = performance.now();
        await assetLease.load([...requiredGroundAssets([], "DETAIL"), ...cityTerrainKinds.map(kind => gameAssetUrl(atlasTerrainTile(kind, "city", 0, 0, 0).url))], loadTextureAssets);
        cityTerrainAtlasesReady = true;
        host.dataset.cameraPaddingAtlasPreloadMs = (performance.now() - preloadStarted).toFixed(2);
        host.dataset.cameraPaddingAtlasFamilies = String(cityTerrainKinds.length);
        if (disposed) return;
        installCityRoadPadding(cityScene);
        installCompletedSnapshotTasks(cityScene);
        citySceneChunkCount = cityScene.chunks.length;
        for (const payload of cityScene.chunks) storeChunkPayload(chunkKey(payload.chunkX, payload.chunkY), "DETAIL", payload);
        host!.dataset.citySceneRequests = "1";
        host!.dataset.citySceneRevision = cityScene.sceneRevision;
        host!.dataset.citySceneChunks = String(citySceneChunkCount);
        host!.dataset.panNetworkRequests = "0";
      }
      const sceneRefresh = new CoalescedRefresh();
      let sceneDirty = false;
      let sceneDirtyMovement = false;
      let sceneRenderRequest = 0;
      const refreshCityScene = (): Promise<void> => {
        if (!focusCityId) return Promise.resolve();
        return sceneRefresh.request(async () => {
          if (disposed) return;
          const response: ApiResult<CitySceneDto> = await apiWithMetrics<CitySceneDto>(`/api/countries/${countryId}/cities/${focusCityId}/scene`, {
            cache: "no-cache",
            headers: { accept: `application/vnd.tasktopia.city-scene+json; version=${CITY_SCENE_SCHEMA_VERSION}` },
          });
          if (disposed) return;
          if (response.data.schemaVersion !== CITY_SCENE_SCHEMA_VERSION || response.data.city.id !== focusCityId || response.data.lod !== "DETAIL") {
            throw new Error("Сервер вернул несовместимую сцену города");
          }
          cityScene = response.data;
          installCityRoadPadding(cityScene);
          cityFlightRoutes = cityMicroFlightRoutes(cityScene.airportConnections);
          host!.dataset.airportFlightRoutes = String(cityFlightRoutes.length);
          installCompletedSnapshotTasks(cityScene);
          citySceneChunkCount = cityScene.chunks.length;
          chunkPayloadCache.clear();
          chunkDataCache.clear();
          for (const payload of cityScene.chunks) storeChunkPayload(chunkKey(payload.chunkX, payload.chunkY), "DETAIL", payload);
          host!.dataset.citySceneRequests = String(Number(host!.dataset.citySceneRequests ?? 0) + 1);
          host!.dataset.citySceneRefreshRequests = String(Number(host!.dataset.citySceneRefreshRequests ?? 0) + 1);
          host!.dataset.citySceneRevision = cityScene.sceneRevision;
          host!.dataset.citySceneChunks = String(citySceneChunkCount);
        });
      };
      const preloadViewportPayloads = async (wanted: Array<[number, number]>, lod: MapLod): Promise<void> => {
        if (cityScene) return;
        const missing = wanted.filter(([chunkX, chunkY]) => !cachedChunkPayload(chunkKey(chunkX, chunkY), lod));
        if (missing.length < 2) return;
        const minChunkX = Math.min(...missing.map(([chunkX]) => chunkX));
        const maxChunkX = Math.max(...missing.map(([chunkX]) => chunkX));
        const minChunkY = Math.min(...missing.map(([, chunkY]) => chunkY));
        const maxChunkY = Math.max(...missing.map(([, chunkY]) => chunkY));
        if ((maxChunkX - minChunkX + 1) * (maxChunkY - minChunkY + 1) > 100) return;
        const params = new URLSearchParams({
          minChunkX: String(minChunkX), minChunkY: String(minChunkY),
          maxChunkX: String(maxChunkX), maxChunkY: String(maxChunkY), lod: lod.toLowerCase(),
        });
        const response = await apiWithMetrics<ViewportPayloadDto>(`/api/world/viewport?${params}`, {
          cache: "no-cache",
          headers: { accept: "application/vnd.tasktopia.chunk-payload+json; version=2" },
        });
        for (const payload of response.data.chunks) storeChunkPayload(chunkKey(payload.chunkX, payload.chunkY), lod, payload);
        exposeRollingMetric(host!, "viewportPayload", chunkPayloadMetric, response.metrics.decodedBytes, "Bytes");
        exposeRollingMetric(host!, "viewportRequest", chunkRequestMetric, response.metrics.requestMs);
        exposeRollingMetric(host!, "viewportParse", chunkParseMetric, response.metrics.parseMs);
        host!.dataset.viewportBatchChunks = String(response.data.chunks.length);
      };
      const crossesDecorationStage = (before: ChunkPayloadDto, after: ChunkPayloadDto): boolean => {
        const previousStages = new Map(before.decorationContext.tasks.map((task) => [task.id, task.stage]));
        return after.decorationContext.tasks.some((task) => {
          const previousStage = previousStages.get(task.id);
          return previousStage !== undefined && (previousStage >= 3) !== (task.stage >= 3);
        });
      };
      const materializePayload = async (payload: ChunkPayloadDto, signal?: AbortSignal, terrainSamples?: Uint8Array): Promise<ChunkDto> => {
        const materializeStartedAt = performance.now();
        let candidate = patchChunkPayloadTaskStatuses(payload, latestTaskStatusPatches);
        let realtimeDecorationsRematerialized = crossesDecorationStage(payload, candidate);
        let materialized: ChunkDto;
        while (true) {
          materialized = await chunkMaterializer.materialize(candidate, signal, terrainSamples);
          const latest = patchChunkPayloadTaskStatuses(candidate, latestTaskStatusPatches);
          if (latest === candidate) break;
          // A status event can cross the stage-3 frontage-decoration threshold
          // while the worker is running. Re-materialize from the latest context
          // instead of committing deterministic entities from the stale job.
          realtimeDecorationsRematerialized ||= crossesDecorationStage(candidate, latest);
          candidate = latest;
        }
        materialized = patchChunkTaskStatuses(materialized, latestTaskStatusPatches);
        if (realtimeDecorationsRematerialized) host!.dataset.realtimeDecorations = "rematerialized";
        const duration = performance.now() - materializeStartedAt;
        exposeRollingMetric(host!, "chunkMaterialize", chunkMaterializeMetric, duration);
        return materialized;
      };
      const fetchChunkData = async (chunkX: number, chunkY: number, lod: MapLod): Promise<ChunkDto> => {
        const cacheKey = chunkKey(chunkX, chunkY);
        let chunk = cachedChunkData(cacheKey, lod);
        if (!chunk && lod === "OVERVIEW") {
          const detail = cachedChunkData(cacheKey, "DETAIL");
          if (detail) {
            chunk = overviewFromDetailChunk(detail);
            storeChunkData(cacheKey, lod, chunk);
          }
        }
        if (!chunk) {
          const key = dataKey(cacheKey, lod);
          let pending = pendingChunks.get(key);
          if (!pending) {
            const controller = new AbortController();
            const promise = (async () => {
              let payload = cachedChunkPayload(cacheKey, lod);
              if (!payload) {
                if (cityScene) throw new Error(`В единой сцене отсутствует chunk ${cacheKey}:${lod}`);
                const response = await apiWithMetrics<ChunkPayloadDto>(`/api/chunks/${chunkX}/${chunkY}?lod=${lod.toLowerCase()}`, {
                  signal: controller.signal,
                  cache: "no-cache",
                  headers: { accept: "application/vnd.tasktopia.chunk-payload+json; version=2" },
                });
                const responseWorldVersion = Number(response.headers.get("x-world-version"));
                exposeRollingMetric(host!, "chunkPayload", chunkPayloadMetric, response.metrics.decodedBytes, "Bytes");
                exposeRollingMetric(host!, "chunkRequest", chunkRequestMetric, response.metrics.requestMs);
                exposeRollingMetric(host!, "chunkParse", chunkParseMetric, response.metrics.parseMs);
                payload = Number.isFinite(responseWorldVersion)
                  ? { ...response.data, publishedVersion: responseWorldVersion }
                  : response.data;
                storeChunkPayload(cacheKey, lod, payload);
              }
              const terrainSampleKey = dataKey(cacheKey, lod);
              const terrainSamples = seedTerrainSamples.get(terrainSampleKey);
              const materialized = await materializePayload(payload, controller.signal, terrainSamples);
              if (terrainSamples) {
                seedTerrainSamples.delete(terrainSampleKey);
                host!.dataset.seedTerrainReused = "true";
              }
              return materialized;
            })();
            pending = { controller, promise };
            pendingChunks.set(key, pending);
          }
          try {
            chunk = await pending.promise;
            if (pendingChunks.get(key) !== pending) throw new DOMException("Stale chunk request", "AbortError");
            storeChunkData(cacheKey, lod, chunk);
          } finally {
            if (pendingChunks.get(key) === pending) pendingChunks.delete(key);
          }
        }
        return chunk;
      };

      const scheduleEntityReconcile = (rebuildMovement: boolean) => {
        reconcileMovement ||= rebuildMovement;
        if (reconcileFrame) return;
        reconcileFrame = requestAnimationFrame(() => {
          reconcileFrame = 0;
          renderEntities(reconcileMovement);
          reconcileMovement = false;
        });
      };
      const flushEntityReconcile = (rebuildMovement: boolean): void => {
        reconcileMovement ||= rebuildMovement;
        if (reconcileFrame) cancelAnimationFrame(reconcileFrame);
        reconcileFrame = 0;
        renderEntities(reconcileMovement);
        reconcileMovement = false;
      };
      const publishEntityWhenReady = async (
        cacheKey: string,
        baseChunk: ChunkDto,
        lod: MapLod,
        valid: () => boolean,
        rebuildMovement: boolean,
      ): Promise<void> => {
        entityChunkLods.delete(cacheKey);
        let candidate = patchChunkTaskStatuses(baseChunk, latestTaskStatusPatches);
        let assetFailures = 0;
        while (valid()) {
          const loadedAssets = requiredEntityAssets([candidate], lod).sort();
          try {
            await withAssetSlot(() => assetLease.load(loadedAssets, loadTextureAssets));
            host!.dataset.sceneAssets = String(assetLease.size);
            host!.dataset.leasedAssets = String(leasedAssetCount());
            assetFailures = 0;
          } catch (error) {
            assetFailures += 1;
            if (assetFailures > 2 || !valid()) throw error;
            await new Promise<void>((resolve) => window.setTimeout(resolve, assetFailures * 250));
            continue;
          }
          if (!valid()) return;
          // A realtime status may arrive while PNG decoding is in progress.
          // Re-read it after every await and load another stage when needed;
          // the final patch + publish below is synchronous.
          const latest = patchChunkTaskStatuses(candidate, latestTaskStatusPatches);
          const latestAssets = requiredEntityAssets([latest], lod).sort();
          if (latestAssets.length !== loadedAssets.length
            || latestAssets.some((asset, index) => asset !== loadedAssets[index])) {
            candidate = latest;
            continue;
          }
          publishEntityChunk(cacheKey, latest, lod);
          scheduleEntityReconcile(rebuildMovement);
          return;
        }
      };
      const publishCitySceneEntities = async (
        sources: Map<string, ChunkDto>,
        lod: MapLod,
        valid: () => boolean,
        rebuildMovement: boolean,
      ): Promise<void> => {
        let candidates = new Map([...sources].map(([cacheKey, chunk]) => [
          cacheKey,
          patchChunkTaskStatuses(chunk, latestTaskStatusPatches),
        ]));
        while (valid()) {
          const loadedAssets = requiredEntityAssets(candidates.values(), lod, completedSnapshotTasks.values()).sort();
          await assetLease.load(loadedAssets, loadTextureAssets);
          host!.dataset.sceneAssets = String(assetLease.size);
          host!.dataset.leasedAssets = String(leasedAssetCount());
          if (!valid()) return;
          const latest = new Map([...candidates].map(([cacheKey, chunk]) => [
            cacheKey,
            patchChunkTaskStatuses(chunk, latestTaskStatusPatches),
          ]));
          const latestAssets = requiredEntityAssets(latest.values(), lod, completedSnapshotTasks.values()).sort();
          if (latestAssets.length !== loadedAssets.length
            || latestAssets.some((asset, index) => asset !== loadedAssets[index])) {
            candidates = latest;
            continue;
          }
          for (const [cacheKey, chunk] of latest) publishEntityChunk(cacheKey, chunk, lod);
          flushEntityReconcile(rebuildMovement);
          host!.dataset.citySceneEntityCommits = String(Number(host!.dataset.citySceneEntityCommits ?? 0) + 1);
          return;
        }
      };
      const preloadAmbientAssets = (): void => {
        if (ambientAssetsReady || ambientAssetsPromise) return;
        ambientAssetsPromise = assetLease.load(ambientDetailAssets(), loadTextureAssets).then(() => {
          host!.dataset.leasedAssets = String(leasedAssetCount());
          if (disposed) return;
          ambientAssetsReady = true;
          host!.dataset.ambientAssets = "ready";
          scheduleEntityReconcile(true);
        }).catch(() => {
          // Ambient life is optional: a failed plane or animal must never hold
          // terrain, roads and buildings hostage. Allow a later detail load to retry.
          ambientAssetsPromise = undefined;
          if (!disposed) host!.dataset.ambientAssets = "retry";
        });
      };
      const commitChunk = (
        cacheKey: string,
        chunk: ChunkDto,
        lod: MapLod,
        rebuildMovement: boolean,
        deferStaticRender = false,
        deferEntityRender = false,
        preparedGround?: PreparedGround,
      ) => {
        chunks.set(cacheKey, chunk);
        chunkLods.set(cacheKey, lod);
        if (!deferEntityRender) publishEntityChunk(cacheKey, chunk, lod);
        const ground = groundContainers.get(cacheKey);
        const wasInvalidated = invalidatedGroundKeys.delete(cacheKey);
        const wasSeedGround = seedGroundKeys.delete(cacheKey);
        const rebuildGround = wasInvalidated || wasSeedGround || ground?.lod !== lod || !ground.overlayView;
        if (rebuildGround) {
          const reason = wasInvalidated ? "invalidated" : wasSeedGround ? "seed" : "lod";
          const datasetKey = `groundRebuild${reason[0]!.toUpperCase()}${reason.slice(1)}` as keyof DOMStringMap;
          host!.dataset[datasetKey] = String(Number(host!.dataset[datasetKey] ?? 0) + 1);
        }
        if (!rebuildGround && ground) ground.usedAt = performance.now();
        else if (preparedGround) {
          const retainedSeedTerrain = wasSeedGround && ground?.lod === lod && preparedGround.terrainView === undefined;
          installGround(cacheKey, preparedGround, lod, wasInvalidated);
          if (retainedSeedTerrain) host!.dataset.seedGroundRetained = "true";
        }
        else throw new Error(`Ground ${cacheKey}:${lod} was committed before its queued bake completed`);
        if (!deferEntityRender) scheduleEntityReconcile(rebuildMovement);
        host!.dataset.groundRebuilds = String(Number(host!.dataset.groundRebuilds ?? 0) + (rebuildGround ? 1 : 0));
        host!.dataset.residentChunks = String(chunks.size);
        host!.dataset.mapLod = lod.toLowerCase();
        if (reducedMotion && !deferStaticRender) {
          app.render();
          host!.dataset.staticRenders = String(Number(host!.dataset.staticRenders ?? 0) + 1);
        }
        if (!cityScene) {
          setFirstFrameReady(true);
          paintedFrame = true;
        }
      };
      function pruneGroundCache(active: Set<string>): void {
        const effectiveLimit = Math.max(GROUND_CACHE_LIMIT, active.size);
        if (groundContainers.size <= effectiveLimit) return;
        const candidates = [...groundContainers.entries()]
          .filter(([cacheKey]) => !active.has(cacheKey))
          .sort((left, right) => left[1].usedAt - right[1].usedAt);
        let removedEntitySource = false;
        for (const [cacheKey] of candidates) {
          if (groundContainers.size <= effectiveLimit) break;
          removeGround(cacheKey, "prune");
          chunks.delete(cacheKey);
          chunkLods.delete(cacheKey);
          entityChunks.delete(cacheKey);
          entityChunkLods.delete(cacheKey);
          removedEntitySource = true;
        }
        if (removedEntitySource) scheduleEntityReconcile(false);
        host!.dataset.groundCache = String(groundContainers.size);
      }
      const drainVisibleLoads = async (): Promise<void> => {
        if (loadRunning || !activeRef.current) return;
        loadRunning = true;
        try {
          while (!disposed && activeRef.current) {
            const generation = loadGeneration;
            const lod = desiredLod;
            const wanted = [...desiredWanted];
            const active = new Set(desiredKeys);
            const rebuildMovement = pendingMovementRebuild;
            const lodTransition = lod !== currentLod;
            const preparedGrounds = new Map<string, PreparedGround>();
            const discardPreparedGrounds = () => {
              for (const prepared of preparedGrounds.values()) {
                if (prepared.terrainView) destroyGroundView(prepared.terrainView);
                if (prepared.overlayView) destroyGroundView(prepared.overlayView);
              }
              preparedGrounds.clear();
            };
            try {
              const fetched = new Map<string, ChunkDto>();
              const groundReady = new Set<string>();
              const withFetchSlot = concurrencyGate(CHUNK_FETCH_CONCURRENCY);
              // The center-first plan now flows through fetch -> worker decode
              // -> assets -> paint independently. One slow background response
              // can no longer hold the first visible chunk behind a viewport
              // sized Promise.all barrier.
              if (!cityScene) {
                for (const [chunkX, chunkY] of wanted) void primeSeedGround(chunkX, chunkY, lod, generation).catch(() => undefined);
              }
              try {
                await preloadViewportPayloads(wanted, lod);
                host!.dataset.viewportBatch = "ready";
              } catch {
                // Rolling deploy / transient batch failure: individual chunk
                // requests below serve only the unscoped world view.
                host!.dataset.viewportBatch = "fallback";
              }
              await Promise.all(wanted.map(async ([chunkX, chunkY]) => {
                if (disposed || generation !== loadGeneration) return;
                const cacheKey = chunkKey(chunkX, chunkY);
                // Start deterministic terrain immediately and overlap it with
                // the authoritative overlay request. The first visible frame
                // no longer waits for PostgreSQL, MCP work or network latency.
                if (!lodTransition
                  && chunks.has(cacheKey)
                  && chunkLods.get(cacheKey) === lod
                  && groundContainers.get(cacheKey)?.lod === lod
                  && entityChunkLods.get(cacheKey) === lod
                  && !invalidatedGroundKeys.has(cacheKey)) {
                  const ground = groundContainers.get(cacheKey);
                  if (ground) ground.usedAt = performance.now();
                  return;
                }
                let chunk = await withFetchSlot(() => {
                  if (disposed || generation !== loadGeneration) return Promise.reject(new DOMException("Stale viewport", "AbortError"));
                  return fetchChunkData(chunkX, chunkY, lod);
                });
                fetched.set(cacheKey, chunk);
                if (lod === "DETAIL" && !cityScene) preloadAmbientAssets();
                await withAssetSlot(() => assetLease.load(requiredGroundAssets([chunk], lod), loadTextureAssets));
                host!.dataset.sceneAssets = String(assetLease.size);
                host!.dataset.leasedAssets = String(leasedAssetCount());
                if (disposed || generation !== loadGeneration || desiredLod !== lod || !desiredKeys.has(cacheKey)) return;
                const ground = groundContainers.get(cacheKey);
                if (invalidatedGroundKeys.has(cacheKey) || seedGroundKeys.has(cacheKey) || ground?.lod !== lod || !ground.overlayView) {
                  const prepared = await scheduleGroundBake(
                    `${generation}:${lod}:${cacheKey}`,
                    () => !disposed && generation === loadGeneration && desiredLod === lod && desiredKeys.has(cacheKey),
                    () => ({
                      terrainView: ground?.lod === lod ? undefined : createTerrainView(chunk, lod),
                      overlayView: createInfrastructureOverlayView(chunk, lod),
                    }),
                  );
                  if (!prepared) return;
                  if (disposed || generation !== loadGeneration || desiredLod !== lod || !desiredKeys.has(cacheKey)) {
                    if (prepared.terrainView) destroyGroundView(prepared.terrainView);
                    if (prepared.overlayView) destroyGroundView(prepared.overlayView);
                    return;
                  }
                  preparedGrounds.set(cacheKey, prepared);
                }
                groundReady.add(cacheKey);
                // During an LOD transition the previous coherent frame remains
                // until all targets are ready. Ordinary movement paints each
                // central ground as soon as its static assets are complete;
                // buildings and props cannot hold that first paint hostage.
                if (!lodTransition) {
                  chunk = patchChunkTaskStatuses(chunk, latestTaskStatusPatches);
                  fetched.set(cacheKey, chunk);
                  commitChunk(cacheKey, chunk, lod, rebuildMovement, false, true, preparedGrounds.get(cacheKey));
                  preparedGrounds.delete(cacheKey);
                  if (!cityScene) {
                    await publishEntityWhenReady(
                      cacheKey,
                      chunk,
                      lod,
                      () => !disposed && generation === loadGeneration && desiredLod === lod && desiredKeys.has(cacheKey),
                      rebuildMovement,
                    );
                  }
                }
              }));

              if (disposed || generation !== loadGeneration || desiredLod !== lod) {
                discardPreparedGrounds();
                continue;
              }
              if (lodTransition) {
                currentLod = lod;
                for (const [chunkX, chunkY] of wanted) {
                  const cacheKey = chunkKey(chunkX, chunkY);
                  let chunk = fetched.get(cacheKey);
                  if (chunk && groundReady.has(cacheKey) && desiredKeys.has(cacheKey)) {
                    chunk = patchChunkTaskStatuses(chunk, latestTaskStatusPatches);
                    fetched.set(cacheKey, chunk);
                    commitChunk(cacheKey, chunk, lod, rebuildMovement, true, true, preparedGrounds.get(cacheKey));
                    preparedGrounds.delete(cacheKey);
                  }
                }
                // Entity payloads from the previous LOD remain cached but are
                // not a valid source for the new renderer while its assets load.
                if (!cityScene) scheduleEntityReconcile(rebuildMovement);
                if (reducedMotion) {
                  app.render();
                  host!.dataset.staticRenders = String(Number(host!.dataset.staticRenders ?? 0) + 1);
                }
                // The coherent ground swap is complete. Dynamic entities may
                // now stream independently without leaving the old LOD visible.
                for (const [chunkX, chunkY] of wanted) {
                  const cacheKey = chunkKey(chunkX, chunkY);
                  const chunk = fetched.get(cacheKey);
                  if (cityScene || !chunk || !desiredKeys.has(cacheKey)) continue;
                  void publishEntityWhenReady(
                    cacheKey,
                    chunk,
                    lod,
                    () => !disposed && generation === loadGeneration && desiredLod === lod && desiredKeys.has(cacheKey),
                    rebuildMovement,
                  ).catch(() => undefined);
                }
                if (disposed || generation !== loadGeneration || desiredLod !== lod) continue;
              }
              if (cityScene) {
                const sources = new Map<string, ChunkDto>();
                for (const [chunkX, chunkY] of wanted) {
                  const cacheKey = chunkKey(chunkX, chunkY);
                  const chunk = fetched.get(cacheKey) ?? chunks.get(cacheKey);
                  if (chunk && desiredKeys.has(cacheKey)) sources.set(cacheKey, chunk);
                }
                await publishCitySceneEntities(
                  sources,
                  lod,
                  () => !disposed && generation === loadGeneration && desiredLod === lod,
                  rebuildMovement || lodTransition,
                );
              }
              discardPreparedGrounds();
            } catch (error) {
              discardPreparedGrounds();
              if (!disposed && generation === loadGeneration && !(error instanceof DOMException && error.name === "AbortError")) {
                host!.dataset.loadError = "true";
                host!.dataset.loading = "false";
                endStreamingFeedback();
                loadRetryAttempt += 1;
                if (loadRetryAttempt <= 2) {
                  window.clearTimeout(loadRetryTimer);
                  loadRetryTimer = window.setTimeout(() => {
                    if (disposed || generation !== loadGeneration) return;
                    desiredRange = "";
                    loadVisible({ isRetry: true });
                  }, loadRetryAttempt * 500);
                } else {
                  const message = "Не удалось загрузить карту. Проверьте соединение и повторите попытку.";
                  setMapLoadError(message);
                  onFatalErrorRef.current?.(message);
                }
              }
              if (generation === loadGeneration) break;
              continue;
            }
            if (disposed || generation !== loadGeneration) continue;
            const covered = wanted.every(([chunkX, chunkY]) => {
              const cacheKey = chunkKey(chunkX, chunkY);
              return chunks.has(cacheKey) && chunkLods.get(cacheKey) === lod && groundContainers.get(cacheKey)?.lod === lod;
            });
            if (!covered) continue;
            if (cityScene && host!.dataset.citySceneCommit !== "atomic") {
              // A scene is not a coherent first frame while exterior material
              // is still awaiting its native atlas. The bounded halo also
              // starts warm; no seed-placeholder palette is final padding.
              while (paddingWork.size && !disposed && generation === loadGeneration) await Promise.all([...paddingWork]);
              if (disposed || generation !== loadGeneration) continue;
              if ([...visiblePaddingKeys].some(id => !paddingTerrain.get(id)?.terrainView || !paddingTerrain.get(id)?.treeViews)) {
                host!.dataset.loading = "false";
                host!.dataset.loadError = "true";
                endStreamingFeedback();
                setMapLoadError("Не удалось загрузить материал ландшафта. Повторите загрузку карты.");
                break;
              }
              if (reducedMotion) app.render();
              setFirstFrameReady(true);
              paintedFrame = true;
              host!.dataset.citySceneCommit = "atomic";
              host!.dataset.cityFirstFrameRendered = "true";
              preloadAmbientAssets();
            }
            let removedEntities = false;
            for (const cacheKey of [...chunks.keys()]) {
              if (active.has(cacheKey)) continue;
              chunks.delete(cacheKey);
              entityChunks.delete(cacheKey);
              entityChunkLods.delete(cacheKey);
              chunkLods.delete(cacheKey);
              removedEntities = true;
            }
            if (!cityScene) {
              if (removedEntities) scheduleEntityReconcile(rebuildMovement);
              scheduleEntityReconcile(rebuildMovement || lodTransition);
            }
            if (rebuildMovement) pendingMovementRebuild = false;
            pruneGroundCache(active);
            renderedRange = desiredRange;
            host!.dataset.residentChunks = String(chunks.size);
            host!.dataset.groundCache = String(groundContainers.size);
            host!.dataset.chunkDataCache = String(chunkDataCache.size);
            host!.dataset.chunkPayloadCache = String(chunkPayloadCache.size);
            host!.dataset.chunkRange = renderedRange;
            host!.dataset.mapLod = currentLod.toLowerCase();
            host!.dataset.loading = "false";
            endStreamingFeedback();
            loadRetryAttempt = 0;
            // An older viewport bake may finish after a newer scene refresh
            // failed. Finishing that old work cannot acknowledge the failure.
            if (!sceneDirty) {
              delete host!.dataset.loadError;
              setMapLoadError(undefined);
            }
            break;
          }
        } finally {
          loadRunning = false;
          if (!disposed && activeRef.current && host!.dataset.loading === "true") void drainVisibleLoads();
        }
      };

      function loadVisible(options: { forceKeys?: Set<string>; rebuildMovement?: boolean; isRetry?: boolean } = {}): void {
        // Camera gestures must not dismiss a failed authoritative update by
        // treating the old in-memory scene as a successful reload.
        if (cityScene && sceneDirty) return;
        if (!options.isRetry) {
          window.clearTimeout(loadRetryTimer);
          loadRetryAttempt = 0;
          setMapLoadError(undefined);
        }
        const nextLod = lodForScale(world.scale.x);
        const range = chunkRangeForViewport(
          world.position, world.scale.x, app.screen, currentViewBounds, CELL_SIZE, chunkSize,
        );
        const rangeLabel = cityScene ? `city:${cityScene.sceneRevision}` : `${range.minChunkX},${range.minChunkY}:${range.maxChunkX},${range.maxChunkY}`;
        if (!options.forceKeys?.size && host!.dataset.loadError !== "true" && nextLod === desiredLod && rangeLabel === desiredRange) {
          host!.dataset.skippedReconciles = String(Number(host!.dataset.skippedReconciles ?? 0) + 1);
          return;
        }
        const resident = new Set([...chunks.keys()].filter((cacheKey) => (
          chunkLods.get(cacheKey) === nextLod && groundContainers.get(cacheKey)?.lod === nextLod && !invalidatedGroundKeys.has(cacheKey)
          && entityChunkLods.get(cacheKey) === nextLod
          && !options.forceKeys?.has(cacheKey)
        )));
        const plan = progressiveChunkPlan(range, resident);
        const wanted = cityScene
          ? cityScene.chunks.map((chunk) => [chunk.chunkX, chunk.chunkY] as [number, number])
          : [...plan.critical, ...plan.background] as Array<[number, number]>;
        const activeKeys = new Set<string>();
        if (cityScene) for (const [chunkX, chunkY] of wanted) activeKeys.add(chunkKey(chunkX, chunkY));
        else for (let chunkX = range.minChunkX; chunkX <= range.maxChunkX; chunkX += 1) {
          for (let chunkY = range.minChunkY; chunkY <= range.maxChunkY; chunkY += 1) activeKeys.add(chunkKey(chunkX, chunkY));
        }
        desiredLod = nextLod;
        desiredRange = rangeLabel;
        desiredWanted = wanted;
        desiredKeys = activeKeys;
        if (options.forceKeys?.size) {
          for (const cacheKey of options.forceKeys) {
            for (const lod of ["DETAIL", "OVERVIEW"] as const) {
              chunkDataCache.delete(dataKey(cacheKey, lod));
              if (!cityScene) chunkPayloadCache.delete(dataKey(cacheKey, lod));
              const pending = pendingChunks.get(dataKey(cacheKey, lod));
              pending?.controller.abort();
              pendingChunks.delete(dataKey(cacheKey, lod));
            }
            chunkLods.delete(cacheKey);
          }
        }
        pendingMovementRebuild ||= Boolean(options.rebuildMovement);
        loadGeneration += 1;
        // Cancel only work that cannot serve the new viewport. Overlapping
        // requests remain useful, while a slow off-screen response no longer
        // holds the single drain loop behind obsolete Promise.all work.
        for (const [key, pending] of pendingChunks) {
          const separator = key.lastIndexOf(":");
          const cacheKey = key.slice(0, separator);
          const lod = key.slice(separator + 1) as MapLod;
          if (lod === nextLod && activeKeys.has(cacheKey)) continue;
          pending.controller.abort();
          pendingChunks.delete(key);
        }
        host!.dataset.loading = "true";
        beginStreamingFeedback();
        void drainVisibleLoads();
      }

      visibleLoaderReady = true;

      const refreshSceneAndRender = (rebuildMovement: boolean): void => {
        sceneDirty = true;
        sceneDirtyMovement ||= rebuildMovement;
        const request = ++sceneRenderRequest;
        void refreshCityScene().then(() => {
          if (disposed || !cityScene || request !== sceneRenderRequest) return;
          sceneDirty = false;
          const movement = sceneDirtyMovement;
          sceneDirtyMovement = false;
          const forceKeys = new Set(cityScene.chunks.map(chunk => chunkKey(chunk.chunkX, chunk.chunkY)));
          for (const cacheKey of forceKeys) invalidatedGroundKeys.add(cacheKey);
          desiredRange = "";
          loadVisible({ forceKeys, rebuildMovement: movement });
        }).catch(() => {
          if (disposed || request !== sceneRenderRequest) return;
          host!.dataset.loadError = "true";
          setMapLoadError("Не удалось обновить город. Проверьте соединение и повторите попытку.");
        });
      };

      runtimeRef.current = {
        setActive(value) {
          activeRef.current = value;
          updateAnimation();
          if (value) {
            if (cityScene && sceneDirty) { refreshSceneAndRender(sceneDirtyMovement); return; }
            if (host.dataset.loading === "true") void drainVisibleLoads();
            else loadVisible();
          } else {
            endStreamingFeedback();
          }
        },
        setViewBounds(bounds) {
          currentViewBounds = bounds;
          redrawBackdrop();
          clampCamera();
          void loadVisible();
        },
        focus(area) {
          const scale = pixelPerfectCameraScale(
            fitCameraScale(app.screen, area.bounds, CELL_SIZE),
            cameraMinimumScale(),
          );
          cameraTargetScale = Math.max(
            fitCameraScale(app.screen, area.bounds, CELL_SIZE),
            cameraMinimumScale(),
          );
          const point = position(area.point);
          world.scale.set(scale);
          host.dataset.renderScale = String(scale);
          world.position.set(app.screen.width / 2 - point.x * scale, app.screen.height / 2 - point.y * scale);
          host.dataset.focusX = String(area.point.x);
          host.dataset.focusY = String(area.point.y);
          clampCamera();
          renderedRange = "";
          void loadVisible();
        },
        invalidateBatch(incoming) {
          const events = incoming.filter(event => mapInvalidationImpact(event) !== 'NONE'
            && mapInvalidationAffectsCity(event, focusCityId));
          if (events.length === 0) return;
          const latest = events.at(-1)!;
          // Completed districts use compact snapshot tasks, not chunk task
          // payloads. Reopening one must replace that authoritative snapshot.
          const sceneEvents = events.filter(event => mapInvalidationImpact(event) === 'SCENE'
            || Boolean(event.taskId && completedSnapshotTasks.has(event.taskId)));
          const event = sceneEvents.length ? { ...sceneEvents.at(-1)!, worldVersion: latest.worldVersion,
            groundChanged: sceneEvents.some(item => item.groundChanged ?? !GROUND_PRESERVING_EVENTS.has(item.type)),
            // Union only when every event has a spatial scope; unknown means a full refresh.
            affectedBounds: sceneEvents.every(item => item.affectedBounds) ? {
              minX: Math.min(...sceneEvents.map(item => item.affectedBounds!.minX)), minY: Math.min(...sceneEvents.map(item => item.affectedBounds!.minY)),
              maxX: Math.max(...sceneEvents.map(item => item.affectedBounds!.maxX)), maxY: Math.max(...sceneEvents.map(item => item.affectedBounds!.maxY)),
            } : undefined,
          } : latest;
          host.dataset.realtimeBatchCount = String(Number(host.dataset.realtimeBatchCount ?? 0) + 1);
          host.dataset.realtimeBatchEvents = String(events.length);
          for (const event of events) {
            if (event.type === "task.status_changed" && event.status === "COMPLETED" && event.affectedBounds) launchCelebration(event.affectedBounds);
            if (event.type === "task.status_changed" && event.taskId && event.status
            && event.progress !== undefined && event.stage !== undefined) {
            const previous = latestTaskStatusPatches.get(event.taskId);
            if (!previous || event.worldVersion > previous.worldVersion) {
              latestTaskStatusPatches.delete(event.taskId);
              latestTaskStatusPatches.set(event.taskId, {
                status: event.status as ChunkTaskDto["status"],
                progress: event.progress,
                stage: event.stage,
                worldVersion: event.worldVersion,
              });
            }
            while (latestTaskStatusPatches.size > TASK_STATUS_PATCH_LIMIT) {
              const oldest = latestTaskStatusPatches.keys().next().value as string | undefined;
              if (!oldest) break;
              latestTaskStatusPatches.delete(oldest);
            }
            }
          }
          if (sceneEvents.length === 0) {
            host.dataset.realtimePatchedTasks = JSON.stringify(events.map(item => ({ taskId: item.taskId, stage: item.stage })));
            let patched = false;
            const patchedChunks = new Map<string, ChunkDto>();
            const decorationRefreshes = new Map<string, { payload: ChunkPayloadDto; lod: MapLod }>();
            for (const [payloadKey, payload] of chunkPayloadCache) {
              const contextChanged = payload.decorationContext.tasks.some(task => {
                const patch = latestTaskStatusPatches.get(task.id);
                return patch && patch.worldVersion >= payload.publishedVersion && (task.stage >= 3) !== (patch.stage >= 3);
              });
              const next = patchChunkPayloadTaskStatuses(payload, latestTaskStatusPatches);
              if (next !== payload) chunkPayloadCache.set(payloadKey, next);
              if (!contextChanged) continue;
              const separator = payloadKey.lastIndexOf(":");
              const cacheKey = payloadKey.slice(0, separator);
              const lod = payloadKey.slice(separator + 1) as MapLod;
              chunkDataCache.delete(payloadKey);
              if (lod === currentLod && chunks.has(cacheKey) && desiredKeys.has(cacheKey)) {
                decorationRefreshes.set(cacheKey, { payload: next, lod });
              }
            }
            for (const [cacheKey, chunk] of chunks) {
              const next = patchChunkTaskStatuses(chunk, latestTaskStatusPatches);
              if (next !== chunk) { chunks.set(cacheKey, next); patchedChunks.set(cacheKey, next); patched = true; }
            }
            for (const [cacheKey, chunk] of chunkDataCache) {
              const next = patchChunkTaskStatuses(chunk, latestTaskStatusPatches);
              if (next !== chunk) chunkDataCache.set(cacheKey, next);
            }
            if (patched || decorationRefreshes.size > 0) {
              // A status transition can point at a different authored stage.
              // Use the same entity-only retry path as ordinary streaming so
              // a transient PNG error cannot leave this new stage permanently
              // marked ready or force a ground refetch/rebake.
              for (const [cacheKey, refresh] of decorationRefreshes) {
                entityChunkLods.delete(cacheKey);
                void materializePayload(refresh.payload).then(async (chunk) => {
                  if (disposed || !desiredKeys.has(cacheKey) || chunkLods.get(cacheKey) !== refresh.lod) return;
                  const resident = chunks.get(cacheKey);
                  if (resident && resident.worldVersion > chunk.worldVersion) return;
                  chunks.set(cacheKey, chunk);
                  storeChunkData(cacheKey, refresh.lod, chunk);
                  host!.dataset.realtimeDecorations = "rematerialized";
                  await publishEntityWhenReady(
                    cacheKey,
                    chunk,
                    refresh.lod,
                    () => !disposed && desiredKeys.has(cacheKey) && chunks.get(cacheKey) === chunk,
                    false,
                  );
                }).catch(() => {
                  if (disposed || !desiredKeys.has(cacheKey)) return;
                  host!.dataset.realtimeAssets = "retry";
                  desiredRange = "";
                  window.clearTimeout(loadRetryTimer);
                  loadRetryTimer = window.setTimeout(() => {
                    if (!disposed && desiredKeys.has(cacheKey)) loadVisible({ isRetry: true });
                  }, 500);
                });
              }
              for (const [cacheKey, chunk] of patchedChunks) {
                if (decorationRefreshes.has(cacheKey)) continue;
                entityChunkLods.delete(cacheKey);
                void publishEntityWhenReady(
                  cacheKey,
                  chunk,
                  currentLod,
                  () => !disposed && desiredKeys.has(cacheKey) && chunks.get(cacheKey) === chunk,
                  false,
                ).catch(() => {
                  if (disposed || chunks.get(cacheKey) !== chunk) return;
                  host!.dataset.realtimeAssets = "retry";
                  desiredRange = "";
                  window.clearTimeout(loadRetryTimer);
                  loadRetryTimer = window.setTimeout(() => {
                    if (!disposed && chunks.get(cacheKey) === chunk) loadVisible({ isRetry: true });
                  }, 500);
                });
              }
            }
            return;
          }
          if (cityScene) {
            const movementEvents = new Set([
              "city.created", "city.deleted", "district.created", "district.deleted", "district.activated",
              "task.created", "task.deleted",
            ]);
            const rebuildMovement = events.some(item => movementEvents.has(item.type) || item.resync || item.groundRoadTopologyChanged);
            refreshSceneAndRender(rebuildMovement);
            return;
          }
          const groundChanged = event.groundChanged ?? !GROUND_PRESERVING_EVENTS.has(event.type);
          const forceKeys = new Set<string>();
          const affectedKeys = new Set<string>();
          if (event.affectedBounds) {
            const minChunkX = Math.floor(event.affectedBounds.minX / chunkSize);
            const maxChunkX = Math.floor(event.affectedBounds.maxX / chunkSize);
            const minChunkY = Math.floor(event.affectedBounds.minY / chunkSize);
            const maxChunkY = Math.floor(event.affectedBounds.maxY / chunkSize);
            for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX += 1) {
              for (let chunkY = minChunkY; chunkY <= maxChunkY; chunkY += 1) affectedKeys.add(chunkKey(chunkX, chunkY));
            }
          } else {
            for (const cacheKey of chunks.keys()) affectedKeys.add(cacheKey);
            for (const cacheKey of groundContainers.keys()) affectedKeys.add(cacheKey);
            chunkDataCache.clear();
            chunkPayloadCache.clear();
          }
          for (const cacheKey of affectedKeys) {
            if (groundChanged && groundContainers.has(cacheKey)) invalidatedGroundKeys.add(cacheKey);
            for (const lod of ["DETAIL", "OVERVIEW"] as const) {
              const key = dataKey(cacheKey, lod);
              chunkDataCache.delete(key);
              chunkPayloadCache.delete(key);
              pendingChunks.get(key)?.controller.abort();
              pendingChunks.delete(key);
            }
            if (chunks.has(cacheKey) || desiredKeys.has(cacheKey)) forceKeys.add(cacheKey);
          }
          const movementEvents = new Set([
            "city.created", "city.deleted", "district.created", "district.deleted", "district.activated",
            "task.created", "task.deleted",
          ]);
          const rebuildMovement = events.some(item => movementEvents.has(item.type) || item.resync);
          void loadVisible({ forceKeys, rebuildMovement });
        },
        retry() {
          if (cityScene && sceneDirty) { refreshSceneAndRender(sceneDirtyMovement); return; }
          retryFailedPadding(paddingTerrain);
          refreshCameraPadding();
          desiredRange = "";
          delete host.dataset.loadError;
          void loadVisible();
        },
      };

      const wheel = (event: WheelEvent) => {
        event.preventDefault();
        const oldScale = world.scale.x;
        const minimumScale = cameraMinimumScale();
        cameraTargetScale = nextCameraTargetScale(cameraTargetScale, event.deltaY);
        const rect = canvas.getBoundingClientRect();
        const mouse = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        if (wheelNavigationRef.current.consume({ at: event.timeStamp, deltaY: event.deltaY }, event.deltaY > 0 && cameraTargetScale <= minimumScale + .001 && Boolean(onZoomOutToCountryRef.current))) {
          onZoomOutToCountryRef.current?.({ x: mouse.x / Math.max(1, rect.width), y: mouse.y / Math.max(1, rect.height) });
          return;
        }
        const local = { x: (mouse.x - world.position.x) / oldScale, y: (mouse.y - world.position.y) / oldScale };
        cameraZoomAnchor = { screenX: mouse.x, screenY: mouse.y, localX: local.x, localY: local.y };
        if (reducedMotion) animateCameraZoom({ deltaMS: 1_000 });
      };
      canvas.addEventListener("wheel", wheel, { passive: false });
      startupDisposers.push(() => canvas.removeEventListener("wheel", wheel));
      host.dataset.inputReady = "true";
      let intersectsViewport = true;
      const updateAnimation = () => {
        const active = activeRef.current && !reducedMotion && !document.hidden && intersectsViewport;
        host.dataset.mapActive = String(activeRef.current);
        host.dataset.animationActive = String(active);
        if (active) app.start(); else app.stop();
      };
      const visibility = () => updateAnimation();
      const intersectionObserver = new IntersectionObserver(([entry]) => {
        intersectsViewport = Boolean(entry?.isIntersecting);
        updateAnimation();
      }, { threshold: 0.01 });
      intersectionObserver.observe(host);
      startupDisposers.push(() => intersectionObserver.disconnect());
      document.addEventListener("visibilitychange", visibility);
      startupDisposers.push(() => document.removeEventListener("visibilitychange", visibility));
      loadVisible();
      updateAnimation();
      (host as HTMLElement & { cleanupMap?: () => void }).cleanupMap = () => {
        if (districtLayerRef.current === districtLayer) districtLayerRef.current = null;
        if (districtTooltipLayerRef.current === districtTooltipLayer) districtTooltipLayerRef.current = null;
        if (runtimeRef.current) runtimeRef.current = null;
        cleanupStartupResources(); cancelAnimationFrame(resizeFrame); cancelAnimationFrame(panFrame); cancelAnimationFrame(reconcileFrame); window.clearTimeout(loadRetryTimer); window.clearTimeout(streamingTimer);
        cancelGroundBakes();
        for (const pending of pendingChunks.values()) pending.controller.abort();
        pendingChunks.clear();
        for (const cacheKey of [...groundContainers.keys()]) removeGround(cacheKey, "dispose");
        chunkMaterializer.destroy();
      };
    })().catch((error: unknown) => {
      if (disposed) return;
      console.error("World renderer startup failed", error);
      host.dataset.loadError = "true";
      host.dataset.loading = "false";
      setMapLoadError("Не удалось запустить карту. Повторите попытку.");
      onFatalErrorRef.current?.("Не удалось запустить карту. Повторите попытку.");
      cleanupStartupResources();
      destroyApp();
    });

    return () => {
      disposed = true;
      (host as HTMLElement & { cleanupMap?: () => void }).cleanupMap?.();
      cleanupStartupResources();
      destroyApp();
    };
  }, [chunkSize, countryId, focusCityId, rendererAttempt, terrainSeed]);

  return <div className="world-canvas-wrap">
    <div ref={hostRef} className="world-canvas" data-animation-active="true" />
    {!firstFrameReady && !mapLoadError && <div className="app-loading world-first-frame-loading" role="status"><div className="loader-square" /><span>Готовим карту…</span></div>}
    {firstFrameReady && streaming && !mapLoadError && <div className="world-streaming-indicator" role="status"><span className="world-streaming-dot" />Подгружаем карту…</div>}
    {mapLoadError && <div className={firstFrameReady ? "world-streaming-error" : "app-loading world-first-frame-loading"} role="alert"><span>{mapLoadError}</span><button type="button" className="map-retry-button" onClick={() => {
      if (firstFrameReady) runtimeRef.current?.retry();
      else { setMapLoadError(undefined); setRendererAttempt((attempt) => attempt + 1); }
    }}>Повторить</button></div>}
  </div>;
}
