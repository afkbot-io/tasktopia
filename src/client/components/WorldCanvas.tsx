import { useEffect, useMemo, useRef, useState } from "react";
import "pixi.js/unsafe-eval";
import { Application, Assets, Cache, Container, FederatedPointerEvent, Graphics, Rectangle, Sprite, Text, TextStyle, Texture } from "pixi.js";
import { PROP_CATALOG, PROP_SPRITES, TERRAIN_SPRITES, TILE_SPRITES, VEHICLE_SPRITES, gameAssetUrl, getBuilding } from "../../shared/catalog";
import { roadMarkingAxis } from "../../shared/road-profile";
import type { BootstrapDto, Cell, ChunkDistrictDto, ChunkDto, ChunkPayloadDto, ChunkTaskDto, PlatformKind, Rect, RoadCellDto, SurfaceCellDto, ViewportPayloadDto, WorldFeatureDto, WorldManifestDto } from "../../shared/contracts";
import { terrainAt } from "../../shared/world-terrain";
import { encodeTerrainSample } from "../../shared/world-chunk-payload";
import { apiWithMetrics } from "../api";
import { ChunkMaterializer } from "../chunk-materializer";
import { patchChunkPayloadTaskStatuses, patchChunkTaskStatuses, type ChunkTaskStatusPatch } from "../chunk-task-patches";
import { loadGameAssets } from "../game-asset-loader";
import type { MapInvalidation } from "../map-invalidation";
import { RollingPerformanceMetric } from "../rolling-performance-metric";
import {
  agentCellKey,
  buildDirectedCarEdges,
  detectTrafficJunctions,
  directedTrafficCore,
  isAgentEdgeAllowed,
  connectShortWalkGaps,
  nextSeededRandom,
  nextWithoutUTurn,
  planAgentRoute,
  planVehicleFrame,
  vehicleUnsafePairCount,
  vehicleCruiseSpeed,
  vehicleMotionPresentation,
  vehicleWheelAnimationEnabled,
  vehiclePresentation,
  mustYieldAtCrosswalk,
  mustYieldForBlockedJunctionExit,
  trafficSignalDecision,
  trafficSignalPhase,
  trafficSignalPhaseForTraffic,
  trafficRoadGraph,
  walkerInteractionPairs,
  type AgentEdges,
  type TrafficVehicleSnapshot,
  type TrafficJunction,
} from "../agent-routing";
import { reconcileEntityViews, type EntityViewRecord } from "../entity-reconciler";
import { incidentMode, incidentVisualLayout, incidentVisualProfile, incidentWaterJetFrame, incidentWaterTargetFrame, planIncidentEngines, type IncidentMode, type IncidentVisualProfile } from "../task-incidents";
import { ambientMotionPresentation } from "../ambient-motion";
import { animalPresentation } from "../animal-presentation";
import {
  chunkRangeForViewport,
  progressiveChunkPlan,
  clampCameraPosition,
  fitCameraScale,
  cityDetailFocusBounds,
  minimumCameraScale,
  nextCameraTargetScale,
  pixelPerfectCameraScale,
} from "../world-camera";
import { advanceAtlasZoomBoundary, initialAtlasZoomBoundary } from "../atlas-zoom-navigation";
import { WORLD_LAYER_ORDER, type WorldLayerName } from "../world-layer-order";
import {
  buildingBadgePresentation,
  buildingInteractiveBounds,
  buildingPlatformPresentation,
  taskPlatformCellPresentation,
  taskPlatformCells,
} from "../world-building-presentation";
import { micromobilityOccupancy, micromobilityPresentation } from "../micromobility-presentation";
import { residentActivityPosition, residentActivityVisualKey, residentGroundPosition, residentWalkPresentation } from "../resident-presentation";
import { SEED_TERRAIN_COLORS, seedTerrainCellPresentation } from "../seed-terrain-presentation";
import { compareWorldObjects, type WorldObjectKind } from "../world-object-depth";
import { overviewFromDetailChunk } from "../world-chunk-cache";
import { greenAreaDecorStage, greenAreaSurfaceRole } from "../../shared/green-area";
import { taskParkDecorLayout } from "../../shared/task-park";
import {
  CONSTRUCTION_DETAIL_SPEC_BY_KEY,
  CONSTRUCTION_TILE_KEYS,
  constructionStageLayout,
  type ConstructionDetailPlacement,
  type ConstructionTile,
} from "../../shared/construction-stage";

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
const ULTRA_WIDE_GROUND_TEXTURE_RESOLUTION = 0.25;
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
  flames: Array<{ frameA: Sprite; frameB: Sprite }>;
  smokePlumes: Array<{ frameA: Sprite; frameB: Sprite; alpha: number }>;
  beacon: Graphics;
  water: Graphics;
  waterJet: { source: { x: number; y: number }; targets: Array<{ x: number; y: number }>; targetIndex: number };
  phaseMs: number;
};
type WorldRuntime = {
  focus(area: FocusArea): void;
  invalidate(event: MapInvalidation): void;
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

function parkStage(stage: number): 1 | 2 | 3 | 4 | 5 {
  return Math.max(1, Math.min(5, Math.round(stage))) as 1 | 2 | 3 | 4 | 5;
}

function buildingPlatformUrl(platform: PlatformKind): string {
  const presentation = buildingPlatformPresentation(platform);
  return presentation.family === "tile"
    ? TILE_SPRITES[presentation.key]!
    : gameAssetUrl(TERRAIN_SPRITES[presentation.key]![presentation.variant]!);
}
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

function sprite(url: string, x: number, y: number): Sprite {
  const result = new Sprite(cachedTexture(url) ?? Texture.EMPTY);
  result.texture.source.scaleMode = "nearest";
  result.position.set(x, y);
  return result;
}

function terrainSprite(cell: ChunkDto["terrain"][number]): Sprite {
  const variants = TERRAIN_SPRITES[cell.terrain] ?? TERRAIN_SPRITES.GRASS!;
  const p = position(cell);
  return sprite(gameAssetUrl(variants[cell.variant % variants.length]!), p.x, p.y);
}

function edgeSprite(url: string, cell: Cell, direction: number): Sprite {
  const p = position(cell);
  const result = sprite(url, p.x + CELL_SIZE / 2, p.y + CELL_SIZE / 2);
  result.anchor.set(0.5);
  if (direction === 0) result.scale.y = -1;
  else if (direction === 1) result.rotation = -Math.PI / 2;
  else if (direction === 3) result.rotation = Math.PI / 2;
  return result;
}

function drawSurface(cell: SurfaceCellDto): Sprite {
  const p = position(cell);
  const url = cell.kind === "SIDEWALK" ? TILE_SPRITES.pavement!
    : cell.kind === "PATH" ? TILE_SPRITES[cell.finish === "PAVERS" ? "path-pavers" : cell.finish === "ASPHALT" ? "path-asphalt" : "path-brown"]!
      : cell.kind === "DRIVEWAY" ? TILE_SPRITES.road!
        : cell.kind === "CROSSWALK" ? TILE_SPRITES[cell.orientation === "V" ? "crosswalk-vertical" : "crosswalk-horizontal"]!
          : gameAssetUrl(TERRAIN_SPRITES.DIRT![1]!);
  return sprite(url, p.x, p.y);
}

function drawRoad(cell: RoadCellDto, surfaces: Map<string, SurfaceCellDto>, roads: Map<string, RoadCellDto>): Container {
  const group = new Container();
  const p = position(cell);
  group.addChild(sprite(TILE_SPRITES.road!, p.x, p.y));
  const crossing = surfaces.get(key(cell));
  if (crossing?.kind === "CROSSWALK") {
    group.addChild(sprite(TILE_SPRITES[crossing.orientation === "V" ? "crosswalk-vertical" : "crosswalk-horizontal"]!, p.x, p.y));
  } else {
    const markingAxis = roadMarkingAxis(roads, cell);
    if (markingAxis) {
      group.addChild(sprite(TILE_SPRITES[markingAxis === "H" ? "road-marking-horizontal" : "road-marking-vertical"]!, p.x, p.y));
    }
  }
  for (let direction = 0; direction < GRID_DIRECTIONS.length; direction += 1) {
    const config = GRID_DIRECTIONS[direction]!;
    const neighborRoad = roads.get(key({ x: cell.x + config.x, y: cell.y + config.y }));
    if (cell.structure === "ROAD" && neighborRoad?.structure === "BRIDGE") {
      const portal = new Graphics();
      if (direction === 0 || direction === 2) portal.rect(p.x + 1, p.y + (direction === 0 ? 0 : 6), 6, 2);
      else portal.rect(p.x + (direction === 1 ? 6 : 0), p.y + 1, 2, 6);
      portal.fill(0xb7c4c2);
      group.addChild(portal);
    }
    if (cell.mask & config.bit) continue;
    if (cell.structure === "BRIDGE") {
      const edgeUrl = (cell.mask & (2 | 8)) ? TILE_SPRITES["bridge-side-horizontal"]! : TILE_SPRITES["bridge-side-vertical"]!;
      group.addChild(edgeSprite(edgeUrl, cell, direction));
      continue;
    }
  }
  return group;
}

function drawDistrictBoundary(district: ChunkDistrictDto, tooltipLayer: Container): Container {
  const group = new Container();
  group.eventMode = "static";
  group.cursor = "help";
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
  group.on("pointerover", () => {
    if (!tooltip) {
      const deadline = district.deadline ? `\nДедлайн: ${new Date(district.deadline).toLocaleDateString("ru-RU")}` : "\nДедлайн не задан";
      const label = new Text({
        text: `${district.name}${deadline}`, resolution: 4,
        style: new TextStyle({ fontFamily: "Arial, sans-serif", fontSize: 8, fontWeight: "700", lineHeight: 11, fill: 0xf2f5ed }),
      });
      const panel = new Graphics().roundRect(-5, -5, label.width + 10, label.height + 10, 3)
        .fill({ color: 0x0b181b, alpha: 0.96 }).stroke({ color, width: 1 });
      tooltip = new Container(); tooltip.eventMode = "none"; tooltip.addChild(panel, label);
      const anchor = district.cells.reduce((best, cell) => cell.y < best.y || cell.y === best.y && cell.x < best.x ? cell : best, district.cells[0]!);
      tooltip.position.set(anchor.x * CELL_SIZE, anchor.y * CELL_SIZE - label.height - 12);
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
  return group;
}

function drawPlatform(task: ChunkTaskDto): Container {
  const group = new Container();
  if (task.visualKind === "PARK") {
    for (const cell of task.footprint) {
      const p = position(cell);
      const role = greenAreaSurfaceRole(task.footprint, cell, parkStage(task.stage), task.visualAssetKey);
      const tile = role === "EARTH" ? gameAssetUrl(TERRAIN_SPRITES.DIRT![1]!)
        : role === "MEADOW" ? gameAssetUrl(TERRAIN_SPRITES.MEADOW![1]!)
          : TILE_SPRITES[role === "BOUNDARY" ? "pavement" : "path-pavers"]!;
      group.addChild(sprite(tile, p.x, p.y));
    }
    return group;
  }
  const entry = getBuilding(task.buildingType);
  for (const cell of taskPlatformCells(task.footprint, task.stage, entry)) {
    const p = position(cell);
    const presentation = taskPlatformCellPresentation(entry, task.footprint, cell, task.taskNumber, task.stage);
    const tile = presentation.family === "tile"
      ? TILE_SPRITES[presentation.key]!
      : gameAssetUrl(TERRAIN_SPRITES[presentation.key]![presentation.variant]!);
    group.addChild(sprite(tile, p.x, p.y));
  }
  return group;
}

function drawTaskPark(task: ChunkTaskDto, onSelect: (taskId: string) => void, tooltipLayer: Container): Container {
  const group = new Container();
  const bounds = {
    minX: Math.min(...task.footprint.map((cell) => cell.x)), maxX: Math.max(...task.footprint.map((cell) => cell.x)),
    minY: Math.min(...task.footprint.map((cell) => cell.y)), maxY: Math.max(...task.footprint.map((cell) => cell.y)),
  };
  const width = (bounds.maxX - bounds.minX + 1) * CELL_SIZE;
  const height = (bounds.maxY - bounds.minY + 1) * CELL_SIZE;
  group.position.set(bounds.minX * CELL_SIZE, bounds.minY * CELL_SIZE);
  group.eventMode = "static";
  group.cursor = "pointer";
  group.hitArea = new Rectangle(0, 0, width, height);
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
    group.addChild(view);
  }
  const badge = buildingBadgePresentation(task.taskNumber, task.stage);
  const badgeX = width - badge.width / 2 - 2;
  const badgeY = height - badge.height / 2 - 2;
  group.addChild(new Graphics()
    .roundRect(badgeX - badge.width / 2, badgeY - badge.height / 2, badge.width, badge.height, 1)
    .fill(0x0b171a).stroke({ color: badge.borderColor, width: 1 }));
  const label = new Text({ text: badge.label, resolution: 4, style: new TextStyle({ fontFamily: "Arial, sans-serif", fontSize: badge.fontSize, fontWeight: "900", fill: 0xffffff }) });
  label.anchor.set(0.5); label.position.set(badgeX, badgeY); group.addChild(label);
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
      tooltip.position.set(group.position.x + width / 2 - text.width / 2, group.position.y - text.height - 8);
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
  const result = sprite(
    metadata.path,
    decoration.origin.x * CELL_SIZE + metadata.footprint.width * CELL_SIZE / 2,
    decoration.origin.y * CELL_SIZE + metadata.footprint.height * CELL_SIZE,
  );
  result.anchor.set(metadata.anchor.x / metadata.size.width, metadata.anchor.y / metadata.size.height);
  return result;
}

function drawWorldFeature(
  feature: WorldFeatureDto,
  includePlatform: boolean,
  onArchiveSelect: () => void,
  parent?: WorldFeatureDto,
): { platform?: Container; visual?: Container } | null {
  if (!includePlatform) return null;
  if (feature.assetKind === "AREA") {
    const platform = new Container();
    if (feature.kind === "AIRPORT") {
      const minX = Math.min(...feature.footprint.map((cell) => cell.x));
      const minY = Math.min(...feature.footprint.map((cell) => cell.y));
      const maxX = Math.max(...feature.footprint.map((cell) => cell.x));
      const maxY = Math.max(...feature.footprint.map((cell) => cell.y));
      const left = minX * CELL_SIZE;
      const top = minY * CELL_SIZE;
      const width = (maxX - minX + 1) * CELL_SIZE;
      const height = (maxY - minY + 1) * CELL_SIZE;
      const terminalVariant = [...feature.id].reduce((total, value) => total + value.charCodeAt(0), 0) % 5;
      const airport = new Graphics();
      airport.rect(left, top, width, height).fill(0x7f8c86).stroke({ color: 0x263945, width: 2 });
      airport.rect(left + 16, top + height * .58, width - 32, 32).fill(0x35454d).stroke({ color: 0x1d2c35, width: 2 });
      for (let x = left + 28; x < left + width - 24; x += 32) airport.rect(x, top + height * .58 + 14, 16, 4).fill(0xe4d8a0);
      airport.rect(left + 32, top + 68, 112, 24).fill(0x5c686a).stroke({ color: 0x263945, width: 2 });
      for (let x = left; x <= left + width; x += 16) {
        airport.rect(x, top, 2, 7).fill(0x263945);
        airport.rect(x, top + height - 7, 2, 7).fill(0x263945);
      }
      for (let y = top; y <= top + height; y += 16) {
        airport.rect(left, y, 7, 2).fill(0x263945);
        airport.rect(left + width - 7, y, 7, 2).fill(0x263945);
      }
      platform.addChild(airport);
      const terminal = sprite(gameAssetUrl(`atlas/airport/airport-terminal-${terminalVariant + 1}.png`), left + 112, top + 90);
      terminal.anchor.set(.5, 1);
      platform.addChild(terminal);
      for (let index = 0; index < 5; index += 1) {
        const supportKind = (terminalVariant * 3 + index) % 8 + 1;
        const support = sprite(gameAssetUrl(`atlas/airport/airport-support-${supportKind}.png`), left + 190 + (index % 3) * 52, top + 45 + Math.floor(index / 3) * 42);
        support.anchor.set(.5, 1);
        support.scale.set(.5);
        platform.addChild(support);
      }
      return { platform };
    }
    for (const cell of feature.footprint) {
      const p = position(cell);
      const role = greenAreaSurfaceRole(feature.footprint, cell, feature.developmentStage, feature.assetKey);
      const tile = role === "EARTH" ? gameAssetUrl(TERRAIN_SPRITES.DIRT![1]!)
        : role === "MEADOW" ? gameAssetUrl(TERRAIN_SPRITES.MEADOW![1]!)
          : role === "BOUNDARY" ? TILE_SPRITES.pavement!
            : feature.assetKey === "urban-grove" ? TILE_SPRITES["path-brown"]!
            : TILE_SPRITES["path-pavers"]!;
      platform.addChild(sprite(tile, p.x, p.y));
    }
    return { platform };
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
    for (const cell of feature.footprint) {
      const p = position(cell);
      platform.addChild(sprite(buildingPlatformUrl(entry.platform), p.x, p.y));
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

function assetUrl(path: string): string {
  return gameAssetUrl(path);
}

const FIRE_ENGINE_KEYS = ["fire-engine-horizontal", "fire-engine-rescue", "fire-engine-ladder"] as const;
const FLAME_KEYS = ["incident-flame-a", "incident-flame-b", "incident-flame-c", "incident-flame-d"] as const;
const SMOKE_KEYS = ["incident-smoke-a", "incident-smoke-b", "incident-smoke-c", "incident-smoke-d"] as const;
const INCIDENT_ASSET_KEYS = [...FIRE_ENGINE_KEYS, ...FLAME_KEYS, ...SMOKE_KEYS] as const;
const ANIMAL_SPECIES = ["fox", "deer", "rabbit", "boar", "duck", "sheep", "dog", "cat"] as const;

function drawIncidentWaterJet(
  graphics: Graphics,
  source: { x: number; y: number },
  target: { x: number; y: number },
  timeMs: number,
  phaseMs: number,
): void {
  const frame = incidentWaterJetFrame(source, target, timeMs, phaseMs);
  graphics.clear();
  for (const pixel of frame.core) graphics.rect(pixel.x, pixel.y, pixel.size, pixel.size);
  graphics.fill({ color: 0x4b9fb9, alpha: 0.94 });
  for (const pixel of frame.highlights) graphics.rect(pixel.x, pixel.y, pixel.size, pixel.size);
  graphics.fill({ color: 0xc3f2f5, alpha: 1 });
  for (const pixel of frame.spray) graphics.rect(pixel.x, pixel.y, pixel.size, pixel.size);
  graphics.fill({ color: 0x77cddd, alpha: 0.92 });
}

function drawTaskIncident(task: ChunkTaskDto, mode: Exclude<IncidentMode, "NONE">, signature: string, fullResponse: boolean): IncidentView {
  const entry = getBuilding(task.buildingType);
  const profile = incidentVisualProfile(task);
  const container = new Container();
  container.eventMode = "none";
  container.position.set(
    task.origin.x * CELL_SIZE + entry.footprint.width * CELL_SIZE / 2,
    task.origin.y * CELL_SIZE + entry.footprint.height * CELL_SIZE,
  );

  const visualSeed = [...task.id].reduce((value, char) => ((value * 33) ^ char.charCodeAt(0)) >>> 0, 5381);
  const engineKey = FIRE_ENGINE_KEYS[visualSeed % FIRE_ENGINE_KEYS.length]!;
  const engineWidth = PROP_CATALOG[engineKey]!.size.width;
  const engineX = entry.spriteSize.width / 2 + engineWidth / 2;
  const engine = sprite(PROP_SPRITES[engineKey]!, engineX, 2);
  engine.anchor.set(0.5, 1);
  // Authored horizontal engines face east. They park to the right of the
  // building, so mirror the accepted view exactly as moving cars do for west:
  // the cab and hose point back toward the incident instead of away from it.
  engine.scale.x = -1;

  const stageBounds = entry.stageOpaqueBounds[Math.max(0, Math.min(4, task.stage - 1))]!;
  const layout = incidentVisualLayout(entry.spriteSize.width, entry.spriteSize.height, profile, stageBounds);
  const alarmAnchor = layout.flameAnchors[0] ?? layout.smokeAnchors[0] ?? { x: 0, y: -Math.max(12, entry.spriteSize.height * 0.58) };

  // Full response parks an engine with a flashing beacon at the curb. The
  // compact response is a small pulsing roof alarm: the emergency stays
  // readable without a truck in front of every second house.
  const beacon = fullResponse
    ? new Graphics().rect(-2, -2, 4, 2).fill(0x71d7f2)
    : new Graphics().rect(-2, -2, 4, 4).fill(0xf2574c);
  beacon.position.set(fullResponse ? engineX - 12 : alarmAnchor.x - 2, fullResponse ? -20 : alarmAnchor.y - 3);

  const flames = layout.flameAnchors.map((anchor, index) => {
    const frameA = sprite(PROP_SPRITES[FLAME_KEYS[(visualSeed + index) % FLAME_KEYS.length]!]!, anchor.x, anchor.y);
    const frameB = sprite(PROP_SPRITES[FLAME_KEYS[(visualSeed + index + 1) % FLAME_KEYS.length]!]!, anchor.x, anchor.y);
    frameA.anchor.set(0.5, 1); frameB.anchor.set(0.5, 1);
    const responseScale = mode === "HOTFIX_ACTIVE" ? 1.12 : 0.96;
    frameA.scale.set(anchor.scale * responseScale); frameB.scale.set(anchor.scale * responseScale);
    return { frameA, frameB };
  });

  const smokeScale = [0, 0.5, 0.62, 0.74, 0.88, 1, 1.12][profile.smokeStrength] ?? 1.12;
  const smokeAlpha = Math.min(0.84, 0.32 + profile.smokeStrength * 0.085);
  const smokePlumes = layout.smokeAnchors.map((anchor, index) => {
    const frameA = sprite(PROP_SPRITES[SMOKE_KEYS[(visualSeed + index) % SMOKE_KEYS.length]!]!, anchor.x, anchor.y);
    const frameB = sprite(PROP_SPRITES[SMOKE_KEYS[(visualSeed + index + 1) % SMOKE_KEYS.length]!]!, anchor.x, anchor.y);
    frameA.anchor.set(0.5, 1); frameB.anchor.set(0.5, 1);
    const scale = smokeScale * anchor.scale * (1 - index * 0.04);
    frameA.scale.set(scale); frameB.scale.set(scale);
    frameA.alpha = frameB.alpha = smokeAlpha;
    frameA.visible = true; frameB.visible = false;
    return { frameA, frameB, alpha: smokeAlpha };
  });

  const water = new Graphics();
  const responseAnchors = layout.flameAnchors.length > 0 ? layout.flameAnchors : layout.smokeAnchors;
  const targets = (responseAnchors.length > 0 ? responseAnchors : [alarmAnchor]).map((anchor) => ({
    x: anchor.x + 3,
    y: anchor.y - 2,
  }));
  const initialTarget = incidentWaterTargetFrame(targets, 0, visualSeed % 700)!;
  const waterJet = { source: { x: engineX - 8, y: -18 }, targets, targetIndex: initialTarget.index };
  drawIncidentWaterJet(water, waterJet.source, initialTarget.target, 0, visualSeed % 700);

  const hasFlame = profile.burning;
  const hasWater = fullResponse && (profile.burning || mode === "DEFECT_REPAIRING");
  for (const flame of flames) { flame.frameA.visible = hasFlame; flame.frameB.visible = false; }
  water.visible = hasWater;
  engine.visible = fullResponse;
  if (mode === "DEFECT_REPORTED") engine.alpha = 0.9;
  container.addChild(water, ...smokePlumes.flatMap((plume) => [plume.frameA, plume.frameB]), ...flames.flatMap((flame) => [flame.frameA, flame.frameB]), engine, beacon);
  const phaseMs = visualSeed % 700;
  return { signature, container, mode, profile, fullResponse, flames, smokePlumes, beacon, water, waterJet, phaseMs };
}

function requiredGroundAssets(chunks: Iterable<ChunkDto>, lod: MapLod): string[] {
  if (lod !== "DETAIL") return [];
  const urls = new Set<string>([
    assetUrl(TERRAIN_SPRITES.DIRT![1]!),
    TILE_SPRITES.pavement!, TILE_SPRITES["path-pavers"]!, TILE_SPRITES["path-asphalt"]!, TILE_SPRITES["path-brown"]!,
    TILE_SPRITES.road!, TILE_SPRITES["crosswalk-vertical"]!, TILE_SPRITES["crosswalk-horizontal"]!,
    TILE_SPRITES["road-marking-horizontal"]!, TILE_SPRITES["road-marking-vertical"]!,
    TILE_SPRITES["bridge-side-horizontal"]!, TILE_SPRITES["bridge-side-vertical"]!,
  ]);
  for (const chunk of chunks) for (const cell of chunk.terrain) {
    const variants = TERRAIN_SPRITES[cell.terrain] ?? TERRAIN_SPRITES.GRASS!;
    urls.add(assetUrl(variants[cell.variant % variants.length]!));
  }
  return [...urls];
}

function requiredEntityAssets(chunks: Iterable<ChunkDto>, lod: MapLod): string[] {
  const urls = new Set<string>();
  urls.add(PROP_SPRITES["active-district-flag"]!);
  for (const chunk of chunks) {
    for (const task of chunk.tasks) {
      const entry = getBuilding(task.buildingType);
      if (lod === "DETAIL") {
        if (task.visualKind === "PARK") {
          urls.add(assetUrl(TERRAIN_SPRITES.DIRT![1]!));
          urls.add(assetUrl(TERRAIN_SPRITES.MEADOW![1]!));
          urls.add(TILE_SPRITES.pavement!);
          urls.add(TILE_SPRITES["path-pavers"]!);
          for (const placement of taskParkDecorLayout(task.footprint, parkStage(task.stage), task.visualAssetKey, task.taskNumber)) {
            const metadata = PROP_CATALOG[placement.kind];
            if (metadata) urls.add(metadata.path);
          }
        } else {
          if (task.stage < 5) for (const key of CONSTRUCTION_TILE_KEYS) urls.add(TILE_SPRITES[key]!);
          if (task.stage <= 2) {
          const entranceOffset = entry.entrances[0]?.offset ?? Math.floor(entry.footprint.width / 2);
          const construction = constructionStageLayout(entry.footprint, entranceOffset, task.stage, task.taskNumber);
          for (const detail of construction.details) urls.add(PROP_SPRITES[detail.key]!);
          }
          if (task.stage > 2) urls.add(entry.stages[task.stage - 1]!);
          for (const cell of taskPlatformCells(task.footprint, task.stage, entry)) {
            const presentation = taskPlatformCellPresentation(entry, task.footprint, cell, task.taskNumber, task.stage);
            urls.add(presentation.family === "tile"
              ? TILE_SPRITES[presentation.key]!
              : gameAssetUrl(TERRAIN_SPRITES[presentation.key]![presentation.variant]!));
          }
        }
        if (incidentMode(task) !== "NONE") for (const key of INCIDENT_ASSET_KEYS) urls.add(PROP_SPRITES[key]!);
      }
    }
    for (const feature of lod === "DETAIL" ? chunk.worldFeatures : []) {
      if (feature.assetKind === "PROP") {
        const metadata = PROP_CATALOG[feature.assetKey];
        if (metadata) urls.add(metadata.path);
      } else if (feature.assetKind === "BUILDING") {
        urls.add(getBuilding(feature.assetKey).stages[4]!);
        if (lod === "DETAIL") urls.add(buildingPlatformUrl(getBuilding(feature.assetKey).platform));
      } else if (lod === "DETAIL") {
        if (feature.kind === "AIRPORT") {
          const variant = Math.abs([...feature.id].reduce((total, value) => total + value.charCodeAt(0), 0)) % 5;
          urls.add(gameAssetUrl(`atlas/airport/airport-terminal-${variant + 1}.png`));
          for (let index = 0; index < 5; index += 1) urls.add(gameAssetUrl(`atlas/airport/airport-support-${(variant * 3 + index) % 8 + 1}.png`));
        }
        urls.add(TILE_SPRITES["path-brown"]!);
        urls.add(TILE_SPRITES["path-pavers"]!);
        urls.add(assetUrl(TERRAIN_SPRITES.MEADOW![1]!));
      }
    }
    if (lod !== "DETAIL") continue;
    for (const decoration of chunk.decorations) {
      const metadata = PROP_CATALOG[decoration.kind];
      if (metadata) urls.add(metadata.path);
    }
  }
  if (lod === "DETAIL") {
    urls.add(assetUrl(TERRAIN_SPRITES.DIRT![1]!));
    for (const path of Object.values(TILE_SPRITES)) urls.add(path);
    urls.add(PROP_SPRITES["traffic-light-red"]!);
    urls.add(PROP_SPRITES["traffic-light-green"]!);
  }
  return [...urls];
}

function ambientDetailAssets(): string[] {
  const urls = new Set<string>();
  for (const path of Object.values(VEHICLE_SPRITES).flatMap((views) => [views.horizontal, views.north, views.south])) urls.add(path);
  for (const key of ["city-bus-horizontal", "city-bus-north", "city-bus-south"] as const) urls.add(PROP_SPRITES[key]!);
  for (const direction of ["north", "east", "south", "west"] as const) for (const frame of ["a", "b", "c"] as const) {
    urls.add(PROP_SPRITES[`walker-${direction}-${frame}`]!);
  }
  for (const key of ["resident-reader", "resident-box", "resident-sweeper", "resident-phone", "resident-worker", "resident-wave"] as const) urls.add(PROP_SPRITES[key]!);
  for (const family of ["cyclist", "scooter"] as const) for (const view of ["horizontal", "north", "south"] as const) {
    for (const frame of ["a", "b", "c"] as const) urls.add(PROP_SPRITES[`${family}-${view}-${frame}`]!);
  }
  for (const species of ANIMAL_SPECIES) for (const direction of ["north", "east", "south", "west"] as const) {
    for (const frame of ["a", "b", "c"] as const) urls.add(PROP_SPRITES[`animal-${species}-${direction}-${frame}`]!);
  }
  for (let model = 1; model <= 8; model += 1) urls.add(gameAssetUrl(`atlas/aircraft/airplane-model-${model}-frame-1.png`));
  return [...urls];
}

export function WorldCanvas({ countryId, chunkSize, worldManifest, viewBounds, focusCity, focusTask, invalidation, showDistricts, onTaskSelect, onArchiveSelect, onReady, onZoomOutToCountry }: {
  countryId: string;
  chunkSize: number;
  worldManifest: WorldManifestDto;
  viewBounds: Rect;
  focusCity?: Pick<NonNullable<BootstrapDto["initialCity"]>, "id" | "name" | "center" | "bounds"> | null;
  focusTask?: { origin: Cell; token: number } | null;
  invalidation?: MapInvalidation;
  showDistricts: boolean;
  onTaskSelect: (taskId: string) => void;
  onArchiveSelect: () => void;
  onReady?: () => void;
  onZoomOutToCountry?: () => void;
}) {
  const [firstFrameReady, setFirstFrameReady] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [mapLoadError, setMapLoadError] = useState<string>();
  const [rendererAttempt, setRendererAttempt] = useState(0);
  const hostRef = useRef<HTMLDivElement>(null);
  const districtLayerRef = useRef<Container | null>(null);
  const districtTooltipLayerRef = useRef<Container | null>(null);
  const runtimeRef = useRef<WorldRuntime | null>(null);
  const showDistrictsRef = useRef(showDistricts);
  const onTaskSelectRef = useRef(onTaskSelect);
  const onArchiveSelectRef = useRef(onArchiveSelect);
  const onZoomOutToCountryRef = useRef(onZoomOutToCountry);
  const terrainSeed = worldManifest.terrainSeed;
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

  useEffect(() => {
    showDistrictsRef.current = showDistricts;
    if (districtLayerRef.current) districtLayerRef.current.visible = showDistricts;
    if (districtTooltipLayerRef.current) districtTooltipLayerRef.current.visible = showDistricts;
  }, [showDistricts]);

  useEffect(() => {
    onTaskSelectRef.current = onTaskSelect;
    onArchiveSelectRef.current = onArchiveSelect;
    onZoomOutToCountryRef.current = onZoomOutToCountry;
  }, [onArchiveSelect, onTaskSelect, onZoomOutToCountry]);

  useEffect(() => {
    if (focusX == null || focusY == null || focusMinX == null || focusMinY == null || focusMaxX == null || focusMaxY == null) return;
    runtimeRef.current?.focus({
      point: { x: focusX, y: focusY },
      bounds: { minX: focusMinX, minY: focusMinY, maxX: focusMaxX, maxY: focusMaxY },
    });
  }, [focusMaxX, focusMaxY, focusMinX, focusMinY, focusX, focusY]);

  useEffect(() => {
    if (invalidation) runtimeRef.current?.invalidate(invalidation);
  }, [invalidation]);

  // Search-driven focus: jump the camera to the found building with a
  // neighbourhood-sized window around it.
  const focusTaskToken = focusTask?.token;
  useEffect(() => {
    if (!focusTaskToken || !focusTask) return;
    runtimeRef.current?.focus(buildingFocusArea(focusTask.origin));
  }, [focusTaskToken, focusTask]);

  useEffect(() => {
    const [minX, minY, maxX, maxY] = viewBoundsKey.split(",").map(Number);
    runtimeRef.current?.setViewBounds({ minX: minX!, minY: minY!, maxX: maxX!, maxY: maxY! });
  }, [viewBoundsKey]);

  useEffect(() => {
    if (firstFrameReady) onReady?.();
  }, [firstFrameReady, onReady]);

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
      try { app.stop(); } catch (error) { console.error("Failed to stop partial world renderer", error); }
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
    // Seed terrain is immutable for a (seed, chunk, LOD) tuple. Infrastructure
    // is a separate transparent overlay, so an API response never destroys and
    // re-bakes the already visible first-frame terrain texture.
    type GroundRecord = { terrainView: Sprite; overlayView?: Sprite; lod: MapLod; usedAt: number };
    type PreparedGround = { terrainView?: Sprite; overlayView: Sprite };
    const groundContainers = new Map<string, GroundRecord>();
    const pendingChunks = new Map<string, { promise: Promise<ChunkDto>; controller: AbortController }>();
    const chunkMaterializer = new ChunkMaterializer();
    startupDisposers.push(() => chunkMaterializer.destroy());
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
      if (disposed) { app.destroy({ removeView: true }, { children: true }); return; }
      const canvas = app.canvas;
      canvas.className = "world-canvas-element";
      canvas.setAttribute("aria-label", "Интерактивная карта страны");
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
      const platformLayer = new Container();
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
      const featureViews = new Map<string, { signature: string; platform?: Container; visual?: Container }>();
      let entityReplacementCount = 0;
      let currentViewBounds = initialViewBoundsRef.current;
      let currentLod: MapLod = world.scale.x < DETAIL_LOD_SCALE ? "OVERVIEW" : "DETAIL";
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
      type MovingAgent = {
        id: string;
        view: Sprite;
        graph: Map<string, Cell>;
        outgoing?: AgentEdges;
        current: Cell;
        next: Cell;
        previous?: Cell;
        trail: Cell[];
        progress: number;
        speed: number;
        kind: "CAR" | "BUS" | "WALKER" | "CYCLIST" | "SCOOTER" | "ANIMAL";
        variant: string;
        phase: number;
        pauseMs: number;
        socialCooldownMs: number;
        activity: "NONE" | "THINK" | "CHAT";
        activityView?: Graphics;
        wheelView?: Graphics;
        motionFrame?: 0 | 1 | 2 | 3;
        motionView?: "horizontal" | "north" | "south";
        steps: number;
        randomState: number;
        route: Cell[];
        routeIndex: number;
        lastStopKey?: string;
        signalReservationId?: string;
        waitMs: number;
        visualKey: string;
      };
      let movingAgents: MovingAgent[] = [];
      let movingWalkers: MovingAgent[] = [];
      const destroyMovingAgent = (agent: MovingAgent): void => {
        agent.activityView?.removeFromParent();
        agent.activityView?.destroy();
        agent.wheelView?.removeFromParent();
        agent.wheelView?.destroy();
        agent.view.removeFromParent();
        agent.view.destroy();
      };
      let trafficJunctions: TrafficJunction[] = [];
      const trafficSignalViews = new Map<string, { view: Sprite; junction: TrafficJunction; axis: "H" | "V"; state: "RED" | "GREEN" }>();
      const sessionSeed = crypto.getRandomValues(new Uint32Array(1))[0] || 0x6d2b79f5;
      let spawnState = sessionSeed;
      let nextAgentId = 1;
      let simulationTimeMs = 0;
      let nextTrafficTelemetryMs = 0;
      let nextDepthSortMs = 0;
      let nextSocialCheckMs = 700;
      let airportPoints: Array<{ x: number; y: number }> = [];
      let minimumZoomReachedAt = 0;
      let airplane: {
        view: Sprite;
        trail: Graphics;
        elapsed: number;
        duration: number;
        start: { x: number; y: number };
        control: { x: number; y: number };
        end: { x: number; y: number };
        startsAtAirport: boolean;
        endsAtAirport: boolean;
      } | undefined;
      // The first flight should make the airport feel alive shortly after the
      // city becomes interactive. Later flights keep the quieter ambient pace.
      let nextFlybyMs = 5_000 + nextSeededRandom(sessionSeed).value * 8_000;
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
      let activeCrosswalks = new Set<string>();
      let activityCells = new Set<string>();
      let busStopRoadCells = new Set<string>();
      const setWalkerActivity = (agent: MovingAgent, activity: MovingAgent["activity"]): void => {
        if (agent.kind !== "WALKER") return;
        agent.activity = activity;
        const walkKey = residentWalkPresentation(agent.current, agent.next, agent.progress, agent.phase).key;
        agent.visualKey = residentActivityVisualKey(walkKey, activity);
        const activityTexture = cachedTexture(PROP_SPRITES[agent.visualKey]!);
        if (activityTexture) agent.view.texture = activityTexture;
        const marker = agent.activityView;
        if (!marker) return;
        marker.clear();
        if (activity === "THINK") {
          marker.circle(0, 0, 1).fill(0xf4f1d7).circle(3, -3, 1.4).fill(0xf4f1d7).circle(6, -4, 2).fill(0xf4f1d7);
        } else if (activity === "CHAT") {
          marker.roundRect(-6, -7, 12, 7, 2).fill({ color: 0xf4f1d7, alpha: 0.96 });
          marker.poly([ -2, 0, 0, 3, 1, 0 ]).fill({ color: 0xf4f1d7, alpha: 0.96 });
          marker.circle(-3, -3.5, 0.7).fill(0x183138).circle(0, -3.5, 0.7).fill(0x183138).circle(3, -3.5, 0.7).fill(0x183138);
        }
        marker.visible = agent.view.visible && activity !== "NONE";
      };
      const orientRoadUser = (agent: MovingAgent): void => {
        if (agent.kind === "CAR" || agent.kind === "BUS") {
          const presentation = vehiclePresentation(agent.current, agent.next);
          agent.view.scale.set(presentation.scaleX, presentation.scaleY);
        } else if (agent.kind === "WALKER") {
          const presentation = residentWalkPresentation(agent.current, agent.next, agent.progress, agent.phase);
          agent.view.scale.set(presentation.scaleX, presentation.scaleY);
        } else if (agent.kind === "CYCLIST" || agent.kind === "SCOOTER") {
          const presentation = micromobilityPresentation(agent.kind === "CYCLIST" ? "cyclist" : "scooter", agent.current, agent.next, agent.steps);
          agent.view.scale.set(presentation.scaleX, presentation.scaleY);
        } else if (agent.kind === "ANIMAL") {
          const presentation = animalPresentation(agent.variant, agent.current, agent.next, agent.steps + Math.floor(agent.progress * 3));
          agent.view.scale.set(presentation.scaleX, presentation.scaleY);
        }
      };
      let renderedVehicleFrameMask = 0;
      const renderVehicleMotionFrame = (agent: MovingAgent, frame: 0 | 1 | 2 | 3): void => {
        const wheels = agent.wheelView;
        if (!wheels) return;
        const presentation = vehiclePresentation(agent.current, agent.next);
        if (agent.motionFrame === frame && agent.motionView === presentation.view) return;
        agent.motionFrame = frame;
        agent.motionView = presentation.view;
        wheels.clear();
        if (!vehicleWheelAnimationEnabled(agent.current, agent.next)) return;
        const width = agent.view.texture.width;
        const height = agent.view.texture.height;
        const centres = presentation.view === "horizontal"
          ? [
              { x: -(width / 2 - (agent.kind === "BUS" ? 10 : 5)), y: height / 2 - 3 },
              { x: width / 2 - (agent.kind === "BUS" ? 10 : 5), y: height / 2 - 3 },
            ]
          : [
              { x: -(width / 2 - 3), y: -(height / 2 - (agent.kind === "BUS" ? 10 : 5)) },
              { x: width / 2 - 3, y: -(height / 2 - (agent.kind === "BUS" ? 10 : 5)) },
              { x: -(width / 2 - 3), y: height / 2 - (agent.kind === "BUS" ? 10 : 5) },
              { x: width / 2 - 3, y: height / 2 - (agent.kind === "BUS" ? 10 : 5) },
            ];
        const orbit = [{ x: -1, y: 0 }, { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }][frame]!;
        for (const centre of centres) {
          wheels.rect(Math.round(centre.x + orbit.x), Math.round(centre.y + orbit.y), 1, 1).fill(0xb8d4cf);
        }
        renderedVehicleFrameMask |= 1 << frame;
        host.dataset.vehicleRenderedFrameMask = renderedVehicleFrameMask.toString(2).padStart(4, "0");
      };

      const movingAgentSpriteUrl = (agent: Pick<MovingAgent, "kind" | "variant" | "current" | "next"> & Partial<Pick<MovingAgent, "progress" | "phase" | "steps">>): string => {
        const presentation = vehiclePresentation(agent.current, agent.next);
        if (agent.kind === "CAR") return VEHICLE_SPRITES[agent.variant]![presentation.view];
        if (agent.kind === "BUS") return PROP_SPRITES[`city-bus-${presentation.view}`]!;
        if (agent.kind === "CYCLIST" || agent.kind === "SCOOTER") {
          const micro = micromobilityPresentation(
            agent.kind === "CYCLIST" ? "cyclist" : "scooter",
            agent.current,
            agent.next,
            (agent.steps ?? 0) + Math.floor((agent.progress ?? 0) * 3),
          );
          return PROP_SPRITES[micro.key]!;
        }
        if (agent.kind === "ANIMAL") {
          const animal = animalPresentation(
            agent.variant,
            agent.current,
            agent.next,
            (agent.steps ?? 0) + Math.floor((agent.progress ?? 0) * 3),
          );
          return PROP_SPRITES[animal.key]!;
        }
        return PROP_SPRITES[residentWalkPresentation(agent.current, agent.next, agent.progress ?? 0, agent.phase ?? 0).key]!;
      };
      const plannedVehiclePath = (agent: MovingAgent): Cell[] => {
        const path = [agent.current, agent.next];
        for (const cell of agent.route.slice(agent.routeIndex + 1)) {
          if (key(cell) !== key(path[path.length - 1]!)) path.push(cell);
        }
        return path;
      };
      const vehicleSnapshot = (
        agent: MovingAgent & { kind: "CAR" | "BUS" },
        cruiseSpeed = agent.speed,
      ): TrafficVehicleSnapshot => ({
        id: agent.id,
        kind: agent.kind,
        current: agent.current,
        next: agent.next,
        progress: agent.progress,
        cruiseSpeed,
        path: plannedVehiclePath(agent),
        trail: agent.trail,
        waitMs: agent.waitMs,
        signalReservationId: agent.signalReservationId,
      });
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      host.dataset.animationActive = String(!reducedMotion);
      host.dataset.vehicleAnimationFrames = "4";
      app.ticker.add(() => {
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
        const motorAgents = movingAgents
          .filter((agent): agent is MovingAgent & { kind: "CAR" | "BUS" } => agent.kind === "CAR" || agent.kind === "BUS");
        const trafficPositions = motorAgents.map((agent) => vehicleSnapshot(agent));
        const signalDecisions = new Map(motorAgents.map((agent, index) => {
          const decision = trafficSignalDecision(
            agent.current,
            agent.next,
            trafficJunctions,
            simulationTimeMs,
            agent.kind,
            agent.signalReservationId,
            trafficPositions,
          );
          agent.signalReservationId = decision.reservationId;
          trafficPositions[index]!.signalReservationId = decision.reservationId;
          return [agent.id, decision] as const;
        }));
        const trafficSnapshot = motorAgents.map((agent, index) => vehicleSnapshot(agent, agent.pauseMs > 0
          || mustYieldAtCrosswalk(agent.next, activeCrosswalks, movingWalkers)
          || signalDecisions.get(agent.id)?.yield
          || mustYieldForBlockedJunctionExit(trafficPositions[index]!, trafficJunctions, trafficPositions)
          ? 0 : agent.speed));
        const vehicleFrame = planVehicleFrame(trafficSnapshot, elapsed);
        for (const agent of motorAgents) {
          const advance = vehicleFrame.get(agent.id)?.advance ?? 0;
          agent.waitMs = advance > 0.000_001 ? 0 : agent.waitMs + elapsed;
        }
        nextTrafficTelemetryMs -= elapsed;
        if (nextTrafficTelemetryMs <= 0) {
          host.dataset.trafficBlockedVehicles = String([...vehicleFrame.values()].filter((decision) => decision.blockedBy).length);
          host.dataset.trafficMovingVehicles = String([...vehicleFrame.values()].filter((decision) => decision.advance > 0.000_001).length);
          host.dataset.trafficMaxWaitMs = String(Math.round(Math.max(0, ...motorAgents.map((agent) => agent.waitMs))));
          host.dataset.trafficUnsafePairs = String(vehicleUnsafePairCount(trafficSnapshot));
          nextTrafficTelemetryMs = 250;
        }
        for (const agent of movingAgents) {
          agent.socialCooldownMs = Math.max(0, agent.socialCooldownMs - elapsed);
          if (agent.pauseMs > 0) {
            agent.pauseMs = Math.max(0, agent.pauseMs - elapsed);
            if (agent.pauseMs === 0) setWalkerActivity(agent, "NONE");
            continue;
          }
          if ((agent.kind === "CAR" || agent.kind === "BUS") && mustYieldAtCrosswalk(
            agent.next,
            activeCrosswalks,
            movingWalkers,
          )) continue;
          if ((agent.kind === "CAR" || agent.kind === "BUS") && signalDecisions.get(agent.id)?.yield) continue;
          const vehicleDecision = agent.kind === "CAR" || agent.kind === "BUS" ? vehicleFrame.get(agent.id) : undefined;
          agent.progress += vehicleDecision?.advance ?? elapsed * agent.speed;
          while (agent.progress >= 1) {
            agent.progress -= 1;
            agent.previous = agent.current;
            agent.trail.unshift(agent.current);
            agent.trail.length = Math.min(agent.trail.length, 4);
            agent.current = agent.next;
            agent.steps += 1;
            if (agent.kind === "CAR" || agent.kind === "BUS") {
              host.dataset.trafficLifetimeSteps = String(Number(host.dataset.trafficLifetimeSteps ?? 0) + 1);
            }
            agent.routeIndex += 1;
            if (agent.kind === "BUS") {
              const stopKey = key(agent.current);
              if (busStopRoadCells.has(stopKey) && agent.lastStopKey !== stopKey) {
                agent.lastStopKey = stopKey;
                agent.pauseMs = 850 + Math.floor(agent.phase * 650);
              }
            }
            let routed = agent.route[agent.routeIndex];
            if (!routed || !agent.graph.has(agentCellKey(routed)) || !isAgentEdgeAllowed(agent.current, routed, agent.outgoing)) {
              const planned = planAgentRoute(agent.graph, agent.current, agent.randomState, agent.kind === "CAR" || agent.kind === "BUS" ? 14 : 9, agent.previous, agent.outgoing);
              agent.randomState = planned.randomState;
              agent.route = planned.route;
              agent.routeIndex = 1;
              routed = agent.route[agent.routeIndex];
            }
            agent.next = routed ?? nextWithoutUTurn(agent.graph, agent.current, agent.previous, agent.outgoing);
            const url = movingAgentSpriteUrl(agent);
            const texture = url ? cachedTexture(url) : undefined;
            if (texture) {
              agent.view.texture = texture;
              agent.visualKey = agent.kind === "WALKER"
                ? residentWalkPresentation(agent.current, agent.next, agent.progress, agent.phase).key
                : url;
            }
            orientRoadUser(agent);
            if (agent.kind === "WALKER" && activityCells.has(key(agent.current)) && (agent.steps + Math.floor(agent.phase * 13)) % 3 === 0) {
              agent.pauseMs = 450 + Math.floor(agent.phase * 900);
              setWalkerActivity(agent, "THINK");
            }
          }
          if (agent.kind === "WALKER" && agent.activity === "NONE") {
            const presentation = residentWalkPresentation(agent.current, agent.next, agent.progress, agent.phase);
            if (agent.visualKey !== presentation.key) {
              const texture = cachedTexture(PROP_SPRITES[presentation.key]!);
              if (texture) agent.view.texture = texture;
              agent.visualKey = presentation.key;
            }
          }
          if (agent.kind === "CYCLIST" || agent.kind === "SCOOTER") {
            const presentation = micromobilityPresentation(
              agent.kind === "CYCLIST" ? "cyclist" : "scooter",
              agent.current,
              agent.next,
              agent.steps + Math.floor(agent.progress * 3),
            );
            if (agent.visualKey !== presentation.key) {
              const texture = cachedTexture(PROP_SPRITES[presentation.key]!);
              if (texture) agent.view.texture = texture;
              agent.visualKey = presentation.key;
            }
          }
          if (agent.kind === "ANIMAL") {
            const url = movingAgentSpriteUrl(agent);
            if (agent.visualKey !== url) {
              const texture = cachedTexture(url);
              if (texture) agent.view.texture = texture;
              agent.visualKey = url;
            }
          }
          const motion = ambientMotionPresentation(agent.kind, agent.current, agent.next, agent.progress, agent.previous, CELL_SIZE);
          const motorDecision = agent.kind === "CAR" || agent.kind === "BUS" ? vehicleFrame.get(agent.id) : undefined;
          const vehicleMotion = agent.kind === "CAR" || agent.kind === "BUS"
            ? vehicleMotionPresentation(agent.kind, agent.progress, agent.steps, (motorDecision?.advance ?? 0) > 0)
            : undefined;
          if (vehicleMotion) renderVehicleMotionFrame(agent, vehicleMotion.frame);
          agent.view.position.set(motion.x, motion.y + (vehicleMotion?.suspensionYPx ?? 0));
          agent.view.rotation = motion.rotation;
          if (agent.activityView) {
            const bubble = residentActivityPosition(
              { x: agent.view.x, y: agent.view.y },
              agent.view.texture.height,
              agent.view.scale.y,
            );
            agent.activityView.position.set(bubble.x, bubble.y);
          }
        }
        nextDepthSortMs -= elapsed;
        if (nextDepthSortMs <= 0) {
          sortWorldObjects();
          host.dataset.activeWalkerActivities = String(movingWalkers.filter((walker) => walker.activity !== "NONE").length);
          host.dataset.residentCenterErrors = String(movingWalkers.filter((walker) => {
            const expected = residentGroundPosition(walker.current, walker.next, walker.progress, CELL_SIZE);
            return Math.abs(walker.view.x - expected.x) > 0.01 || Math.abs(walker.view.y - expected.y) > 0.01;
          }).length);
          host.dataset.residentWalkFrames = [...new Set(movingWalkers.map((walker) => walker.visualKey))].sort().join(",");
          host.dataset.residentWalkState = movingWalkers.map((walker) => `${walker.id}:${walker.visualKey}`).sort().join(",");
          host.dataset.trafficSteps = String(motorAgents.reduce((sum, agent) => sum + agent.steps, 0));
          nextDepthSortMs = 100;
        }
        for (const signal of trafficSignalViews.values()) {
          const phase = trafficSignalPhaseForTraffic(signal.junction, simulationTimeMs, trafficPositions);
          const state = signal.axis === "H" ? phase.horizontal : phase.vertical;
          if (state === signal.state) continue;
          signal.state = state;
          const url = PROP_SPRITES[`traffic-light-${state.toLowerCase()}`]!;
          const texture = cachedTexture(url);
          if (texture) signal.view.texture = texture;
        }
        nextSocialCheckMs -= elapsed;
        if (nextSocialCheckMs <= 0) {
          const byId = new Map(movingWalkers.map((walker) => [walker.id, walker]));
          for (const [firstId, secondId] of walkerInteractionPairs(movingWalkers, 2)) {
            const first = byId.get(firstId); const second = byId.get(secondId);
            if (!first || !second) continue;
            const duration = 1_400 + Math.floor((first.phase + second.phase) * 550);
            first.pauseMs = second.pauseMs = duration;
            first.socialCooldownMs = second.socialCooldownMs = 8_000 + duration;
            setWalkerActivity(first, "CHAT"); setWalkerActivity(second, "CHAT");
            host.dataset.walkerInteractions = String(Number(host.dataset.walkerInteractions ?? 0) + 1);
          }
          nextSocialCheckMs = 700;
        }
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
          const flameFrame = Math.floor(time / 210) % 2;
          incident.flames.forEach((flame, index) => {
            const visibleFrame = (flameFrame + index) % 2;
            flame.frameA.visible = incident.profile.burning && visibleFrame === 0;
            flame.frameB.visible = incident.profile.burning && visibleFrame === 1;
          });
          incident.smokePlumes.forEach((plume, index) => {
            const smokeFrame = Math.floor((time + index * 130) / 360) % 2;
            plume.frameA.visible = smokeFrame === 0;
            plume.frameB.visible = smokeFrame === 1;
            plume.frameA.alpha = plume.frameB.alpha = plume.alpha + Math.sin(time * 0.004 + index) * 0.08;
          });
          incident.beacon.alpha = Math.floor(time / 160) % 2 ? 1 : 0.28;
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
        if (!airplane) {
          nextFlybyMs -= elapsed;
          if (nextFlybyMs <= 0) {
            const takeRandom = () => {
              const next = nextSeededRandom(spawnState);
              spawnState = next.state;
              return next.value;
            };
            const model = Math.floor(takeRandom() * 8) + 1;
            const texture = cachedTexture(gameAssetUrl(`atlas/aircraft/airplane-model-${model}-frame-1.png`));
            if (texture) {
              const view = new Sprite(texture);
              view.texture.source.scaleMode = "nearest";
              view.anchor.set(0.5);
              const trail = new Graphics()
                .rect(-25, -1, 7, 2).fill({ color: 0xd9ecdf, alpha: .45 })
                .rect(-30, -.5, 3, 1).fill({ color: 0xd9ecdf, alpha: .25 });
              view.addChild(trail);
              const airportPoint = airportPoints[Math.floor(takeRandom() * Math.max(1, airportPoints.length))];
              const side = Math.floor(takeRandom() * 4);
              const edgePosition = takeRandom();
              const edge = side === 0
                ? { x: currentViewBounds.minX * CELL_SIZE - 48, y: (currentViewBounds.minY + edgePosition * (currentViewBounds.maxY - currentViewBounds.minY)) * CELL_SIZE }
                : side === 1
                  ? { x: currentViewBounds.maxX * CELL_SIZE + 48, y: (currentViewBounds.minY + edgePosition * (currentViewBounds.maxY - currentViewBounds.minY)) * CELL_SIZE }
                  : side === 2
                    ? { x: (currentViewBounds.minX + edgePosition * (currentViewBounds.maxX - currentViewBounds.minX)) * CELL_SIZE, y: currentViewBounds.minY * CELL_SIZE - 48 }
                    : { x: (currentViewBounds.minX + edgePosition * (currentViewBounds.maxX - currentViewBounds.minX)) * CELL_SIZE, y: currentViewBounds.maxY * CELL_SIZE + 48 };
              const startsAtAirport = Boolean(airportPoint && takeRandom() > .5);
              const endsAtAirport = Boolean(airportPoint && !startsAtAirport);
              const start = startsAtAirport ? airportPoint! : edge;
              const end = endsAtAirport ? airportPoint! : airportPoint && startsAtAirport
                ? { x: currentViewBounds.maxX * CELL_SIZE + 48, y: currentViewBounds.minY * CELL_SIZE - 24 }
                : { x: currentViewBounds.maxX * CELL_SIZE + 48, y: currentViewBounds.maxY * CELL_SIZE + 48 - edge.y };
              const control = {
                x: (start.x + end.x) / 2 + (takeRandom() - .5) * 224,
                y: (start.y + end.y) / 2 + (takeRandom() - .5) * 192,
              };
              view.position.set(start.x, start.y);
              flightLayer.addChild(view);
              airplane = { view, trail, elapsed: 0, duration: 9_000 + takeRandom() * 6_000, start, control, end, startsAtAirport, endsAtAirport };
              host.dataset.airplane = "flying";
              host.dataset.airplaneVariant = `model-${model}`;
            }
          }
        } else {
          airplane.elapsed += elapsed;
          const progress = Math.min(1, airplane.elapsed / airplane.duration);
          const inverse = 1 - progress;
          airplane.view.position.set(
            inverse * inverse * airplane.start.x + 2 * inverse * progress * airplane.control.x + progress * progress * airplane.end.x,
            inverse * inverse * airplane.start.y + 2 * inverse * progress * airplane.control.y + progress * progress * airplane.end.y,
          );
          const tangent = {
            x: 2 * inverse * (airplane.control.x - airplane.start.x) + 2 * progress * (airplane.end.x - airplane.control.x),
            y: 2 * inverse * (airplane.control.y - airplane.start.y) + 2 * progress * (airplane.end.y - airplane.control.y),
          };
          airplane.view.rotation = Math.atan2(tangent.y, tangent.x);
          airplane.trail.alpha = .55 + Math.sin(airplane.elapsed * .018) * .22;
          const takeoffScale = airplane.startsAtAirport ? Math.min(1, Math.max(.03, progress / .16)) : 1;
          const landingScale = airplane.endsAtAirport ? Math.min(1, Math.max(.03, (1 - progress) / .16)) : 1;
          const endpointScale = Math.min(takeoffScale, landingScale);
          airplane.view.scale.set(1.35 * endpointScale);
          if (progress >= 1) {
            airplane.view.removeFromParent();
            airplane.view.destroy();
            airplane = undefined;
            delete host.dataset.airplane;
            delete host.dataset.airplaneVariant;
            const random = nextSeededRandom(spawnState);
            spawnState = random.state;
            nextFlybyMs = 45_000 + random.value * 75_000;
          }
        }
      });
      const initialScale = !initialFocus
        ? 1.25
        : fitCameraScale(app.screen, initialFocus.bounds, CELL_SIZE);
      const focus = initialFocus ? position(initialFocus.point) : { x: 0, y: 0 };
      const appliedInitialScale = pixelPerfectCameraScale(
        initialScale,
        minimumCameraScale(app.screen, currentViewBounds, CELL_SIZE),
      );
      let cameraTargetScale = Math.max(
        initialScale,
        minimumCameraScale(app.screen, currentViewBounds, CELL_SIZE),
      );
      let zoomBoundary = initialAtlasZoomBoundary();
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
      type GroundBakeRequest = {
        key: string;
        valid: () => boolean;
        task: () => PreparedGround;
        resolve: (view: PreparedGround | undefined) => void;
        reject: (error: unknown) => void;
      };
      const groundBakeQueue: GroundBakeRequest[] = [];
      const pendingGroundBakes = new Map<string, Promise<PreparedGround | undefined>>();
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
          const request = groundBakeQueue.shift();
          if (!request) return;
          groundBakesThisFrame = frameTime === lastGroundBakeFrameTime ? groundBakesThisFrame + 1 : 1;
          lastGroundBakeFrameTime = frameTime;
          host.dataset.groundBakesPerFrameMax = String(Math.max(Number(host.dataset.groundBakesPerFrameMax ?? 0), groundBakesThisFrame));
          try { request.resolve(request.valid() ? request.task() : undefined); }
          catch (error) { request.reject(error); }
          pumpGroundBakes();
        });
      };
      const scheduleGroundBake = (requestKey: string, valid: () => boolean, task: () => PreparedGround): Promise<PreparedGround | undefined> => {
        const pending = pendingGroundBakes.get(requestKey);
        if (pending) return pending;
        const promise = new Promise<PreparedGround | undefined>((resolve, reject) => {
          groundBakeQueue.push({ key: requestKey, valid, task, resolve, reject });
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
      let dragging = false;
      let previous = { x: 0, y: 0 };
      const clampCamera = () => {
        const minimumScale = minimumCameraScale(app.screen, currentViewBounds, CELL_SIZE);
        if (world.scale.x < minimumScale) {
          cameraTargetScale = Math.max(cameraTargetScale, minimumScale);
          const scale = pixelPerfectCameraScale(minimumScale, minimumScale);
          world.scale.set(scale);
          host.dataset.renderScale = String(scale);
        }
        const clamped = clampCameraPosition(world.position, world.scale.x, app.screen, currentViewBounds, CELL_SIZE);
        world.position.set(clamped.x, clamped.y);
      };
      const scheduleVisibleLoad = () => {
        cancelAnimationFrame(panFrame);
        panFrame = requestAnimationFrame(() => { void loadVisible(); });
      };
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
          void loadVisible();
        });
      };
      const resizeObserver = new ResizeObserver(scheduleResize);
      resizeObserver.observe(host);
      startupDisposers.push(() => resizeObserver.disconnect());
      window.addEventListener("resize", scheduleResize);
      startupDisposers.push(() => window.removeEventListener("resize", scheduleResize));
      app.stage.eventMode = "static";
      app.stage.hitArea = app.screen;
      app.stage.on("pointerdown", (event) => { dragging = true; previous = { x: event.global.x, y: event.global.y }; });
      app.stage.on("pointermove", (event) => {
        if (!dragging) return;
        world.position.x += event.global.x - previous.x;
        world.position.y += event.global.y - previous.y;
        clampCamera();
        previous = { x: event.global.x, y: event.global.y };
        scheduleVisibleLoad();
      });

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

      function bakeGroundTexture(source: Container | Graphics, chunkX: number, chunkY: number, size: number, lod: MapLod): Sprite {
        const bakeStartedAt = performance.now();
        const originX = chunkX * size * CELL_SIZE;
        const originY = chunkY * size * CELL_SIZE;
        const texture = app.renderer.textureGenerator.generateTexture({
          target: source,
          frame: new Rectangle(originX, originY, size * CELL_SIZE, size * CELL_SIZE),
          resolution: lod === "OVERVIEW"
            ? desiredKeys.size > GROUND_CACHE_LIMIT ? ULTRA_WIDE_GROUND_TEXTURE_RESOLUTION : OVERVIEW_GROUND_TEXTURE_RESOLUTION
            : 1,
          antialias: false,
        });
        host!.dataset.groundTextureResolution = String(texture.source.resolution);
        texture.source.scaleMode = "nearest";
        source.destroy({ children: true });
        const view = new Sprite(texture);
        view.position.set(originX, originY);
        view.eventMode = "none";
        exposeRollingMetric(host!, "groundBake", groundBakeMetric, performance.now() - bakeStartedAt);
        return view;
      }

      function createTerrainView(chunk: ChunkDto, lod: MapLod): Sprite {
        const source = new Container();
        source.eventMode = "none";
        if (lod === "DETAIL") {
          const terrain = new Container();
          for (const cell of chunk.terrain) terrain.addChild(terrainSprite(cell));
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

      function createInfrastructureOverlayView(chunk: ChunkDto, lod: MapLod): Sprite {
        const source = new Container();
        source.eventMode = "none";
        if (lod === "DETAIL") {
          const surfaces = new Container();
          const roads = new Container();
          const surfaceMap = new Map(chunk.surfaces.map((surface) => [key(surface), surface]));
          for (const surface of chunk.surfaces) surfaces.addChild(drawSurface(surface));
          const roadMap = new Map(chunk.roads.map((road) => [key(road), road]));
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
          setFirstFrameReady(true);
          paintedFrame = true;
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
        }
        airportPoints = [...features.values()].filter((feature) => feature.kind === "AIRPORT" && feature.assetKind === "AREA").map((feature) => ({
          x: (Math.min(...feature.footprint.map((cell) => cell.x)) + Math.max(...feature.footprint.map((cell) => cell.x)) + 1) * CELL_SIZE / 2,
          y: (Math.min(...feature.footprint.map((cell) => cell.y)) + Math.max(...feature.footprint.map((cell) => cell.y)) + 1) * CELL_SIZE / 2,
        }));
        if (host) host.dataset.airports = String(airportPoints.length);

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

        reconcile(districts, districtViews, districtLayer, (district) => drawDistrictBoundary(district, districtTooltipLayer));
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
            ? drawBuilding(task, (taskId) => onTaskSelectRef.current(taskId), buildingTooltipLayer)
            : drawOverviewBuilding(task, (taskId) => onTaskSelectRef.current(taskId)),
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
            const signature = JSON.stringify([mode, fullResponse, task.origin, task.buildingType, task.defectSummary]);
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
          currentLod === "DETAIL" ? decorations : new Map<string, ChunkDto["decorations"][number]>(),
          decorationViews,
          worldObjectLayer,
          drawDecoration,
          JSON.stringify,
          "DECORATION",
        );
        const animatedDecorationIds = new Set<string>();
        if (currentLod === "DETAIL") for (const [id, decoration] of decorations) {
          if (!decoration.kind.startsWith("boat-") && !decoration.kind.startsWith("fisher-")) continue;
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
          const drawn = drawWorldFeature(feature, currentLod === "DETAIL", () => onArchiveSelectRef.current(), parent);
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
          districtViews.size + taskPlatformViews.size + taskBuildingViews.size + incidentViews.size + decorationViews.size + featureViews.size,
        );
        host!.dataset.taskBuildingViews = String(taskBuildingViews.size);
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

        const addAgents = (graph: Map<string, Cell>, count: number, kind: MovingAgent["kind"], outgoing?: AgentEdges): void => {
          const candidates = [...graph.values()].filter((cell) => outgoing
            ? (outgoing.get(key(cell))?.length ?? 0) > 0
            : GRID_DIRECTIONS.some((direction) => graph.has(key({ x: cell.x + direction.x, y: cell.y + direction.y }))));
          if (candidates.length === 0) return;
          const colors = Object.keys(VEHICLE_SPRITES);
          const motorAgent = kind === "CAR" || kind === "BUS";
          const pedestrianAgent = kind === "WALKER" || kind === "CYCLIST" || kind === "SCOOTER";
          const occupiedStarts = new Set(movingAgents
            .filter((agent) => motorAgent
              ? agent.kind === "CAR" || agent.kind === "BUS"
              : pedestrianAgent ? agent.kind === "WALKER" || agent.kind === "CYCLIST" || agent.kind === "SCOOTER"
                : agent.kind === kind)
            .flatMap((agent) => agent.kind === "CYCLIST" || agent.kind === "SCOOTER"
              ? micromobilityOccupancy(agent.current, agent.next).map(key)
              : [key(agent.current)]));
          let created = movingAgents.filter((agent) => agent.kind === kind).length;
          let attempts = 0;
          while (created < count && attempts < candidates.length * 2) {
            attempts += 1;
            const picked = nextSeededRandom(spawnState);
            spawnState = picked.state;
            const index = Math.floor(picked.value * candidates.length);
            const current = candidates[index]!;
            if (occupiedStarts.has(key(current))) continue;
            const routeSeed = nextSeededRandom(spawnState);
            spawnState = routeSeed.state;
            const planned = planAgentRoute(graph, current, routeSeed.state, kind === "CAR" || kind === "BUS" ? 14 : 9, undefined, outgoing);
            const next = planned.route[1] ?? nextWithoutUTurn(graph, current, undefined, outgoing);
            if (key(next) === key(current)) continue;
            const candidateOccupancy = kind === "CYCLIST" || kind === "SCOOTER"
              ? micromobilityOccupancy(current, next)
              : [current];
            if (pedestrianAgent && candidateOccupancy.some((cell) => occupiedStarts.has(key(cell)))) continue;
            const speedPick = nextSeededRandom(spawnState);
            spawnState = speedPick.state;
            const progress = motorAgent ? 0 : picked.value;
            const speed = kind === "CAR" || kind === "BUS" ? vehicleCruiseSpeed(kind, speedPick.value)
              : kind === "CYCLIST" ? 0.00175 + (index % 4) * 0.0001
                : kind === "SCOOTER" ? 0.0015 + (index % 4) * 0.00009
              : kind === "ANIMAL" ? 0.00065 + (index % 3) * 0.00008
                : 0.00115 + (index % 5) * 0.00013;
            if (kind === "CAR" || kind === "BUS") {
              const candidate: TrafficVehicleSnapshot = {
                id: `candidate-${nextAgentId}`,
                kind,
                current,
                next,
                progress,
                cruiseSpeed: speed,
                path: [current, next, ...planned.route.slice(2, 4)],
              };
              const residentVehicles = movingAgents
                .filter((agent): agent is MovingAgent & { kind: "CAR" | "BUS" } => agent.kind === "CAR" || agent.kind === "BUS")
                .map((agent) => vehicleSnapshot(agent));
              if (vehicleUnsafePairCount([...residentVehicles, candidate]) > vehicleUnsafePairCount(residentVehicles)) continue;
            }
            const variant = kind === "ANIMAL" ? ANIMAL_SPECIES[created % ANIMAL_SPECIES.length]!
              : kind === "BUS" ? "city-bus"
                : kind === "CYCLIST" ? "cyclist"
                  : kind === "SCOOTER" ? "scooter"
                : colors[created % colors.length] ?? "blue";
            const phase = (index % 11) / 11;
            const walkerPresentation = kind === "WALKER"
              ? residentWalkPresentation(current, next, progress, phase)
              : undefined;
            const url = movingAgentSpriteUrl({ kind, variant, current, next, progress, phase });
            const tallRoadUser = kind === "WALKER" || kind === "CYCLIST" || kind === "SCOOTER";
            const groundPosition = tallRoadUser
              ? residentGroundPosition(current, next, progress, CELL_SIZE)
              : { x: current.x * CELL_SIZE + CELL_SIZE / 2, y: current.y * CELL_SIZE + CELL_SIZE / 2 };
            const view = sprite(url, groundPosition.x, groundPosition.y);
            view.anchor.set(0.5, tallRoadUser ? 1 : 0.5);
            const wheelView = motorAgent ? new Graphics() : undefined;
            if (wheelView) view.addChild(wheelView);
            worldObjectLayer.addChild(registerWorldObject(view, "AGENT"));
            const activityView = kind === "WALKER" ? new Graphics() : undefined;
            if (activityView) { activityView.visible = false; agentOverlayLayer.addChild(activityView); }
            const agent: MovingAgent = {
              id: `${sessionSeed.toString(36)}-${nextAgentId++}`,
              view, graph, outgoing, current, next, progress, speed,
              kind, variant, phase, pauseMs: 0, socialCooldownMs: index * 170 % 2_000,
              activity: "NONE", activityView, wheelView, steps: index % 17,
              randomState: planned.randomState, route: planned.route, routeIndex: 1, trail: [],
              waitMs: 0,
              visualKey: walkerPresentation?.key ?? url,
            };
            orientRoadUser(agent);
            if (motorAgent) renderVehicleMotionFrame(agent, 0);
            movingAgents.push(agent);
            if (kind === "WALKER") movingWalkers.push(agent);
            for (const cell of candidateOccupancy) occupiedStarts.add(key(cell));
            created += 1;
          }
        };
        const residentRoadGraph = trafficRoadGraph(roads, "CAR");
        trafficJunctions = detectTrafficJunctions(residentRoadGraph);
        const wantedSignals = new Map<string, { junction: TrafficJunction; origin: Cell; axis: "H" | "V"; approach: string }>(trafficJunctions.flatMap((junction) => junction.signalPosts.map((post) => [
          `${junction.id}:${post.approach}`,
          { junction, ...post },
        ] as const)));
        for (const [signalId, signal] of trafficSignalViews) {
          if (wantedSignals.has(signalId)) continue;
          signal.view.removeFromParent();
          signal.view.destroy();
          trafficSignalViews.delete(signalId);
        }
        for (const [signalId, signal] of wantedSignals) {
          const existing = trafficSignalViews.get(signalId);
          if (existing) { existing.junction = signal.junction; continue; }
          const phase = trafficSignalPhase(signal.junction, simulationTimeMs);
          const state = signal.axis === "H" ? phase.horizontal : phase.vertical;
          const view = sprite(
            PROP_SPRITES[`traffic-light-${state.toLowerCase()}`]!,
            signal.origin.x * CELL_SIZE + CELL_SIZE / 2,
            (signal.origin.y + 1) * CELL_SIZE,
          );
          view.anchor.set(0.5, 1);
          worldObjectLayer.addChild(registerWorldObject(view, "FEATURE"));
          trafficSignalViews.set(signalId, { view, junction: signal.junction, axis: signal.axis, state });
        }
        host!.dataset.trafficJunctions = String(trafficJunctions.length);
        host!.dataset.trafficSignals = String(trafficSignalViews.size);
        const residentCarEdges = buildDirectedCarEdges(residentRoadGraph);
        const trafficCore = directedTrafficCore(residentCarEdges);
        const roadGraph = new Map<string, Cell>([...residentRoadGraph].filter(([cellKey]) => trafficCore.has(cellKey)));
        const carEdges = new Map<string, Cell[]>([...residentCarEdges]
          .filter(([cellKey]) => trafficCore.has(cellKey))
          .map(([cellKey, candidates]) => [cellKey, candidates.filter((candidate) => trafficCore.has(key(candidate)))] as const)
          .filter(([, candidates]) => candidates.length > 0));
        const residentBusRoadGraph = trafficRoadGraph(roads, "BUS");
        const residentBusEdges = buildDirectedCarEdges(residentBusRoadGraph);
        const busTrafficCore = directedTrafficCore(residentBusEdges);
        const busGraph = new Map<string, Cell>([...residentBusRoadGraph].filter(([cellKey]) => busTrafficCore.has(cellKey)));
        const busEdges = new Map<string, Cell[]>([...residentBusEdges]
          .filter(([cellKey]) => busTrafficCore.has(cellKey))
          .map(([cellKey, candidates]) => [cellKey, candidates.filter((candidate) => busTrafficCore.has(key(candidate)))] as const)
          .filter(([, candidates]) => candidates.length > 0));
        const blockedWalkCells = new Set([
          ...[...tasks.values()].filter((task) => task.visualKind !== "PARK" || task.stage < 2).flatMap((task) => task.footprint),
          ...[...tasks.values()].filter((task) => task.visualKind === "PARK").flatMap((task) => (
            taskParkDecorLayout(task.footprint, parkStage(task.stage), task.visualAssetKey, task.taskNumber)
              .flatMap((placement) => Array.from({ length: placement.width * placement.height }, (_, index) => ({
                x: placement.origin.x + index % placement.width,
                y: placement.origin.y + Math.floor(index / placement.width),
              })))
          )),
          ...[...features.values()].filter((feature) => feature.assetKind !== "AREA").flatMap((feature) => feature.footprint),
          ...[...decorations.values()].flatMap((decoration) => {
            const prop = PROP_CATALOG[decoration.kind];
            if (!prop) return [decoration.origin];
            return Array.from({ length: prop.footprint.width * prop.footprint.height }, (_, index) => ({
              x: decoration.origin.x + index % prop.footprint.width,
              y: decoration.origin.y + Math.floor(index / prop.footprint.width),
            }));
          }),
        ].map(key));
        const baseWalkGraph = new Map([...surfaces]
          .filter(([cellKey, surface]) => !blockedWalkCells.has(cellKey) && (surface.kind === "SIDEWALK" || surface.kind === "PATH" || surface.kind === "CROSSWALK"))
          .map(([cellKey, surface]) => [cellKey, { x: surface.x, y: surface.y }]));
        const safeGround = new Map([...terrain]
          .filter(([cellKey, cell]) => !blockedWalkCells.has(cellKey) && !roads.has(cellKey) && ["GRASS", "MEADOW", "DIRT"].includes(cell.terrain))
          .map(([cellKey, cell]) => [cellKey, { x: cell.x, y: cell.y }]));
        const walkGraph = connectShortWalkGaps(baseWalkGraph, safeGround, 2);
        const animalGraph = new Map([...terrain]
          .filter(([cellKey, cell]) => !blockedWalkCells.has(cellKey) && !roads.has(cellKey) && !surfaces.has(cellKey) && ["MEADOW", "FOREST"].includes(cell.terrain))
          .map(([cellKey, cell]) => [cellKey, { x: cell.x, y: cell.y }]));
        activeCrosswalks = new Set([...surfaces].filter(([, surface]) => surface.kind === "CROSSWALK").map(([cellKey]) => cellKey));
        activityCells = new Set<string>();
        for (const decoration of decorations.values()) {
          if (!["bench-horizontal", "bench-vertical", "picnic-table", "playground-small", "trash-bin"].includes(decoration.kind)) continue;
          for (const direction of GRID_DIRECTIONS) activityCells.add(key({ x: decoration.origin.x + direction.x, y: decoration.origin.y + direction.y }));
        }
        for (const feature of features.values()) if (feature.kind === "BUS_STOP" || feature.kind === "PARK") {
          for (const cell of [...feature.footprint, ...feature.accessPath]) activityCells.add(key(cell));
        }
        busStopRoadCells = new Set<string>();
        for (const feature of features.values()) {
          if (feature.kind !== "BUS_STOP") continue;
          for (const platformCell of feature.footprint) {
            for (const direction of GRID_DIRECTIONS) {
              const roadCell = { x: platformCell.x + direction.x, y: platformCell.y + direction.y };
              if (busGraph.has(key(roadCell))) busStopRoadCells.add(key(roadCell));
            }
          }
        }
        const agentsVisible = currentLod === "DETAIL" && ambientAssetsReady;
        for (const agent of movingAgents) {
          agent.view.visible = agentsVisible;
          if (agent.activityView) agent.activityView.visible = agentsVisible && agent.activity !== "NONE";
        }
        if (currentLod === "DETAIL" && ambientAssetsReady) {
          const graphs = { CAR: roadGraph, BUS: busGraph, WALKER: walkGraph, CYCLIST: walkGraph, SCOOTER: walkGraph, ANIMAL: animalGraph } as const;
          const before = movingAgents.length;
          movingAgents = movingAgents.filter((agent) => {
            const graph = graphs[agent.kind];
            const retained = graph.has(key(agent.current)) && graph.has(key(agent.next));
            if (retained) {
              agent.graph = graph;
              agent.outgoing = agent.kind === "BUS" ? busEdges : agent.kind === "CAR" ? carEdges : undefined;
              if (!isAgentEdgeAllowed(agent.current, agent.next, agent.outgoing)) {
                if (agent.kind === "CAR" || agent.kind === "BUS") {
                  destroyMovingAgent(agent);
                  return false;
                }
                const planned = planAgentRoute(agent.graph, agent.current, agent.randomState, 9, agent.previous, agent.outgoing);
                agent.randomState = planned.randomState;
                agent.route = planned.route;
                agent.routeIndex = 1;
                agent.next = planned.route[1] ?? nextWithoutUTurn(agent.graph, agent.current, agent.previous, agent.outgoing);
                agent.progress = 0;
              }
            }
            else destroyMovingAgent(agent);
            return retained;
          });
          movingWalkers = movingAgents.filter((agent) => agent.kind === "WALKER");
          addAgents(roadGraph, Math.min(24, Math.max(3, Math.floor(roads.size / 120))), "CAR", carEdges);
          addAgents(busGraph, busStopRoadCells.size > 0 ? Math.min(4, Math.max(1, Math.floor(busStopRoadCells.size / 2))) : 0, "BUS", busEdges);
          addAgents(walkGraph, Math.min(24, Math.max(4, Math.floor(walkGraph.size / 120))), "WALKER");
          addAgents(walkGraph, Math.min(4, Math.floor(walkGraph.size / 340)), "CYCLIST");
          addAgents(walkGraph, Math.min(3, Math.floor(walkGraph.size / 440)), "SCOOTER");
          addAgents(animalGraph, Math.min(6, Math.floor(animalGraph.size / 1400)), "ANIMAL");
          movingWalkers = movingAgents.filter((agent) => agent.kind === "WALKER");
          host!.dataset.agentChanges = String(Math.abs(before - movingAgents.length));
        }
        // Diagnostics describe visible simulation state. Resident agents are
        // retained across overview for a seamless detail return, but hidden
        // sprites must not be reported as active/visible agents.
        host!.dataset.cars = String(agentsVisible ? movingAgents.filter((agent) => agent.kind === "CAR").length : 0);
        host!.dataset.buses = String(agentsVisible ? movingAgents.filter((agent) => agent.kind === "BUS").length : 0);
        host!.dataset.walkers = String(agentsVisible ? movingWalkers.length : 0);
        host!.dataset.cyclists = String(agentsVisible ? movingAgents.filter((agent) => agent.kind === "CYCLIST").length : 0);
        host!.dataset.scooters = String(agentsVisible ? movingAgents.filter((agent) => agent.kind === "SCOOTER").length : 0);
        host!.dataset.animals = String(agentsVisible ? movingAgents.filter((agent) => agent.kind === "ANIMAL").length : 0);
        host!.dataset.wrongWayCars = String(movingAgents.filter((agent) => agent.kind === "CAR"
          && key(agent.current) !== key(agent.next)
          && !agent.outgoing?.get(key(agent.current))?.some((candidate) => key(candidate) === key(agent.next))).length);
        host!.dataset.wrongWayBuses = String(movingAgents.filter((agent) => agent.kind === "BUS"
          && key(agent.current) !== key(agent.next)
          && !agent.outgoing?.get(key(agent.current))?.some((candidate) => key(candidate) === key(agent.next))).length);
        host!.dataset.agentSession = String(sessionSeed);
        host!.dataset.agentIds = movingAgents.map((agent) => agent.id).sort().join(",");
        host!.dataset.residentWalkFrames = [...new Set(movingWalkers.map((walker) => walker.visualKey))].sort().join(",");
        host!.dataset.residentWalkState = movingWalkers.map((walker) => `${walker.id}:${walker.visualKey}`).sort().join(",");
        host!.dataset.trafficSteps = String(movingAgents
          .filter((agent) => agent.kind === "CAR" || agent.kind === "BUS")
          .reduce((sum, agent) => sum + agent.steps, 0));
        sortWorldObjects();
        if (rebuildMovement) host!.dataset.movementRebuilds = String(Number(host!.dataset.movementRebuilds ?? 0) + 1);
        host!.dataset.entityRebuilds = String(Number(host!.dataset.entityRebuilds ?? 0) + 1);
        if (reducedMotion) {
          app.render();
          host!.dataset.staticRenders = String(Number(host!.dataset.staticRenders ?? 0) + 1);
        }
      }

      const lodForScale = (scale: number): MapLod => {
        if (currentLod === "DETAIL") return scale < DETAIL_LOD_EXIT_SCALE ? "OVERVIEW" : "DETAIL";
        return scale >= DETAIL_LOD_ENTER_SCALE ? "DETAIL" : "OVERVIEW";
      };
      const dataKey = (cacheKey: string, lod: MapLod) => `${cacheKey}:${lod}`;
      const storeChunkData = (cacheKey: string, lod: MapLod, chunk: ChunkDto) => {
        const key = dataKey(cacheKey, lod);
        chunkDataCache.delete(key);
        chunkDataCache.set(key, chunk);
        while (chunkDataCache.size > CHUNK_DATA_CACHE_LIMIT) {
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
        while (chunkPayloadCache.size > CHUNK_PAYLOAD_CACHE_LIMIT) {
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
      const preloadViewportPayloads = async (wanted: Array<[number, number]>, lod: MapLod): Promise<void> => {
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
                const response = await apiWithMetrics<ChunkPayloadDto | ChunkDto>(`/api/chunks/${chunkX}/${chunkY}?lod=${lod.toLowerCase()}`, {
                  signal: controller.signal,
                  cache: "no-cache",
                  headers: { accept: "application/vnd.tasktopia.chunk-payload+json; version=2" },
                });
                const responseWorldVersion = Number(response.headers.get("x-world-version"));
                exposeRollingMetric(host!, "chunkPayload", chunkPayloadMetric, response.metrics.decodedBytes, "Bytes");
                exposeRollingMetric(host!, "chunkRequest", chunkRequestMetric, response.metrics.requestMs);
                exposeRollingMetric(host!, "chunkParse", chunkParseMetric, response.metrics.parseMs);
                if (!("payloadVersion" in response.data)) {
                  // A v1.13.5 server ignores the v2 Accept header and returns a
                  // fully materialized chunk. Keep this reader during rollout
                  // and rollback so already-loaded v2 tabs remain functional.
                  const legacy = Number.isFinite(responseWorldVersion)
                    ? { ...response.data, worldVersion: responseWorldVersion }
                    : response.data;
                  return patchChunkTaskStatuses(legacy, latestTaskStatusPatches);
                }
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
            await withAssetSlot(() => loadTextureAssets(loadedAssets));
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
      const preloadAmbientAssets = (): void => {
        if (ambientAssetsReady || ambientAssetsPromise) return;
        ambientAssetsPromise = loadTextureAssets(ambientDetailAssets()).then(() => {
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
        setFirstFrameReady(true);
        paintedFrame = true;
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
        if (loadRunning) return;
        loadRunning = true;
        try {
          while (!disposed) {
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
                destroyGroundView(prepared.overlayView);
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
              for (const [chunkX, chunkY] of wanted) void primeSeedGround(chunkX, chunkY, lod, generation).catch(() => undefined);
              try {
                await preloadViewportPayloads(wanted, lod);
                host!.dataset.viewportBatch = "ready";
              } catch {
                // Rolling deploy / transient batch failure: individual chunk
                // requests below remain the compatibility fallback.
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
                if (lod === "DETAIL") preloadAmbientAssets();
                await withAssetSlot(() => loadTextureAssets(requiredGroundAssets([chunk], lod)));
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
                    destroyGroundView(prepared.overlayView);
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
                  await publishEntityWhenReady(
                    cacheKey,
                    chunk,
                    lod,
                    () => !disposed && generation === loadGeneration && desiredLod === lod && desiredKeys.has(cacheKey),
                    rebuildMovement,
                  );
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
                scheduleEntityReconcile(rebuildMovement);
                if (reducedMotion) {
                  app.render();
                  host!.dataset.staticRenders = String(Number(host!.dataset.staticRenders ?? 0) + 1);
                }
                // The coherent ground swap is complete. Dynamic entities may
                // now stream independently without leaving the old LOD visible.
                for (const [chunkX, chunkY] of wanted) {
                  const cacheKey = chunkKey(chunkX, chunkY);
                  const chunk = fetched.get(cacheKey);
                  if (!chunk || !desiredKeys.has(cacheKey)) continue;
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
                  setMapLoadError("Не удалось загрузить карту. Проверьте соединение и повторите попытку.");
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
            let removedEntities = false;
            for (const cacheKey of [...chunks.keys()]) {
              if (active.has(cacheKey)) continue;
              chunks.delete(cacheKey);
              entityChunks.delete(cacheKey);
              entityChunkLods.delete(cacheKey);
              chunkLods.delete(cacheKey);
              removedEntities = true;
            }
            if (removedEntities) scheduleEntityReconcile(rebuildMovement);
            scheduleEntityReconcile(rebuildMovement || lodTransition);
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
            delete host!.dataset.loadError;
            loadRetryAttempt = 0;
            setMapLoadError(undefined);
            break;
          }
        } finally {
          loadRunning = false;
          if (!disposed && host!.dataset.loading === "true") void drainVisibleLoads();
        }
      };

      function loadVisible(options: { forceKeys?: Set<string>; rebuildMovement?: boolean; isRetry?: boolean } = {}): void {
        if (!options.isRetry) {
          window.clearTimeout(loadRetryTimer);
          loadRetryAttempt = 0;
          setMapLoadError(undefined);
        }
        const nextLod = lodForScale(world.scale.x);
        const range = chunkRangeForViewport(
          world.position, world.scale.x, app.screen, currentViewBounds, CELL_SIZE, chunkSize,
        );
        const rangeLabel = `${range.minChunkX},${range.minChunkY}:${range.maxChunkX},${range.maxChunkY}`;
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
        const wanted = [...plan.critical, ...plan.background] as Array<[number, number]>;
        const activeKeys = new Set<string>();
        for (let chunkX = range.minChunkX; chunkX <= range.maxChunkX; chunkX += 1) {
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
              chunkPayloadCache.delete(dataKey(cacheKey, lod));
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

      runtimeRef.current = {
        setViewBounds(bounds) {
          currentViewBounds = bounds;
          redrawBackdrop();
          clampCamera();
          void loadVisible();
        },
        focus(area) {
          const scale = pixelPerfectCameraScale(
            fitCameraScale(app.screen, area.bounds, CELL_SIZE),
            minimumCameraScale(app.screen, currentViewBounds, CELL_SIZE),
          );
          cameraTargetScale = Math.max(
            fitCameraScale(app.screen, area.bounds, CELL_SIZE),
            minimumCameraScale(app.screen, currentViewBounds, CELL_SIZE),
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
        invalidate(event) {
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
          if (event.type === "task.comment_added" || event.type === "task.assignee_changed"
            || event.type === "country.profile_updated" || event.type === "archive.record_updated") return;
          if (event.type === "task.status_changed" && event.groundChanged === false
            && event.taskId && event.status && event.progress !== undefined && event.stage !== undefined) {
            let patched = false;
            const patchedChunks = new Map<string, ChunkDto>();
            const decorationRefreshes = new Map<string, { payload: ChunkPayloadDto; lod: MapLod }>();
            for (const [payloadKey, payload] of chunkPayloadCache) {
              const contextTask = payload.decorationContext.tasks.find((task) => task.id === event.taskId);
              const next = patchChunkPayloadTaskStatuses(payload, latestTaskStatusPatches);
              if (next !== payload) chunkPayloadCache.set(payloadKey, next);
              if (!contextTask || (contextTask.stage >= 3) === (event.stage >= 3)) continue;
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
          const rebuildMovement = new Set([
            "city.created", "city.deleted", "district.created", "district.deleted", "district.activated",
            "task.created", "task.deleted",
          ]).has(event.type);
          void loadVisible({ forceKeys, rebuildMovement });
        },
        retry() {
          desiredRange = "";
          delete host.dataset.loadError;
          void loadVisible();
        },
      };

      const finishDrag = () => { dragging = false; void loadVisible(); };
      app.stage.on("pointerup", finishDrag);
      app.stage.on("pointerupoutside", finishDrag);
      const wheel = (event: WheelEvent) => {
        event.preventDefault();
        const wheelAt = performance.now();
        const oldScale = world.scale.x;
        const minimumScale = minimumCameraScale(app.screen, currentViewBounds, CELL_SIZE);
        const wasAtMinimum = cameraTargetScale <= minimumScale + 0.001;
        const direction = event.deltaY > 0 ? "OUT" : "IN";
        if (direction === "IN") minimumZoomReachedAt = 0;
        if (direction === "OUT" && wasAtMinimum && minimumZoomReachedAt === 0) minimumZoomReachedAt = wheelAt;
        const boundaryStep = advanceAtlasZoomBoundary(zoomBoundary, {
          at: wheelAt,
          atBoundary: direction === "OUT" && Math.abs(event.deltaY) <= 600 && wasAtMinimum && wheelAt - minimumZoomReachedAt >= 900,
          direction,
        }, 1);
        zoomBoundary = boundaryStep.state;
        if (boundaryStep.triggered) {
          onZoomOutToCountryRef.current?.();
          return;
        }
        cameraTargetScale = nextCameraTargetScale(cameraTargetScale, event.deltaY);
        if (direction === "OUT" && !wasAtMinimum && cameraTargetScale <= minimumScale + 0.001) minimumZoomReachedAt = wheelAt;
        const rect = canvas.getBoundingClientRect();
        const mouse = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        const local = { x: (mouse.x - world.position.x) / oldScale, y: (mouse.y - world.position.y) / oldScale };
        const appliedScale = pixelPerfectCameraScale(
          cameraTargetScale,
          minimumCameraScale(app.screen, currentViewBounds, CELL_SIZE),
        );
        world.scale.set(appliedScale);
        host.dataset.renderScale = String(appliedScale);
        world.position.set(mouse.x - local.x * appliedScale, mouse.y - local.y * appliedScale);
        clampCamera();
        void loadVisible();
      };
      canvas.addEventListener("wheel", wheel, { passive: false });
      startupDisposers.push(() => canvas.removeEventListener("wheel", wheel));
      host.dataset.inputReady = "true";
      let intersectsViewport = true;
      const updateAnimation = () => {
        const active = !reducedMotion && !document.hidden && intersectsViewport;
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
      cleanupStartupResources();
      destroyApp();
    });

    return () => {
      disposed = true;
      (host as HTMLElement & { cleanupMap?: () => void }).cleanupMap?.();
      cleanupStartupResources();
      destroyApp();
    };
  }, [chunkSize, countryId, terrainSeed, rendererAttempt]);

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
