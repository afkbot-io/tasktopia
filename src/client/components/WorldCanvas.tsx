import { useEffect, useMemo, useRef, useState } from "react";
import "pixi.js/unsafe-eval";
import { Application, Assets, Cache, Container, FederatedPointerEvent, Graphics, Rectangle, Sprite, Text, TextStyle, Texture } from "pixi.js";
import { PROP_CATALOG, PROP_SPRITES, TERRAIN_SPRITES, TILE_SPRITES, VEHICLE_SPRITES, getBuilding } from "../../shared/catalog";
import type { BootstrapDto, Cell, ChunkDistrictDto, ChunkDto, ChunkTaskDto, PlatformKind, Rect, RoadCellDto, SurfaceCellDto, WorldFeatureDto } from "../../shared/contracts";
import { api } from "../api";
import { connectShortWalkGaps, mustYieldAtCrosswalk } from "../agent-routing";
import { reconcileEntityViews, type EntityViewRecord } from "../entity-reconciler";
import {
  chunkRangeForViewport,
  clampCameraPosition,
  fitCameraScale,
  minimumCameraScale,
} from "../world-camera";

const CELL_SIZE = 8;
const DETAIL_LOD_SCALE = 1.12;
const DETAIL_LOD_ENTER_SCALE = 1.2;
const DETAIL_LOD_EXIT_SCALE = 1.04;
const CHUNK_FETCH_CONCURRENCY = 6;
const CHUNK_DATA_CACHE_LIMIT = 160;
const GROUND_CACHE_LIMIT = 96;
type MapLod = "DETAIL" | "OVERVIEW";
type MapInvalidation = { id: number; type: string; affectedBounds?: Rect };
type FocusArea = { point: Cell; bounds: Rect };
type WorldRuntime = {
  focus(area: FocusArea): void;
  invalidate(event: MapInvalidation): void;
  retry(): void;
  setViewBounds(bounds: Rect): void;
};

const TERRAIN_COLORS: Record<string, number> = {
  GRASS: 0x668548, MEADOW: 0x789451, FOREST: 0x315f3d,
  DIRT: 0x8d6549, SAND: 0xc5aa73, CLAY: 0x9b5d47, STONE: 0x7d8581,
  HILL: 0x64754b, MOUNTAIN: 0x717875, SHALLOW_WATER: 0x287da0, DEEP_WATER: 0x1f648c,
};
const GRID_DIRECTIONS = [
  { x: 0, y: -1, bit: 1 }, { x: 1, y: 0, bit: 2 }, { x: 0, y: 1, bit: 4 }, { x: -1, y: 0, bit: 8 },
] as const;

const PLATFORM_TILE: Record<PlatformKind, string> = {
  YARD: TERRAIN_SPRITES.GRASS![1]!,
  STONE: TILE_SPRITES.pavement!,
  ASPHALT: TILE_SPRITES.road!,
  SERVICE: TILE_SPRITES.pavement!,
  PARK: TERRAIN_SPRITES.MEADOW![1]!,
};
const TASK_STATUS_LABEL: Record<ChunkTaskDto["status"], string> = {
  PLANNING: "Планируется", STARTED: "Начата", IN_PROGRESS: "В работе", TESTING: "Проверяется", COMPLETED: "Завершена",
};

function position(cell: Cell): { x: number; y: number } {
  return { x: cell.x * CELL_SIZE, y: cell.y * CELL_SIZE };
}

function key(cell: Cell): string { return `${cell.x},${cell.y}`; }

function clear(container: Container): void {
  for (const child of container.removeChildren()) child.destroy({ children: true });
}

function chunkKey(chunkX: number, chunkY: number): string { return `${chunkX},${chunkY}`; }

async function inParallel<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      if (item !== undefined) await worker(item);
    }
  }));
}

function sprite(url: string, x: number, y: number): Sprite {
  const result = new Sprite(Cache.has(url) ? Cache.get<Texture>(url) : Texture.EMPTY);
  result.texture.source.scaleMode = "nearest";
  result.position.set(x, y);
  return result;
}

function terrainSprite(cell: ChunkDto["terrain"][number]): Sprite {
  const variants = TERRAIN_SPRITES[cell.terrain] ?? TERRAIN_SPRITES.GRASS!;
  const p = position(cell);
  return sprite(`/game-assets/v4/${variants[cell.variant % variants.length]!}`, p.x, p.y);
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
          : `/game-assets/v4/${TERRAIN_SPRITES.DIRT![1]!}`;
  return sprite(url, p.x, p.y);
}

function drawRoad(cell: RoadCellDto, surfaces: Map<string, SurfaceCellDto>, roads: Map<string, RoadCellDto>): Container {
  const group = new Container();
  const p = position(cell);
  group.addChild(sprite(TILE_SPRITES.road!, p.x, p.y));
  const crossing = surfaces.get(key(cell));
  if (crossing?.kind === "CROSSWALK") {
    group.addChild(sprite(TILE_SPRITES[crossing.orientation === "V" ? "crosswalk-vertical" : "crosswalk-horizontal"]!, p.x, p.y));
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

function drawDistrictBoundary(district: ChunkDistrictDto): Container {
  const group = new Container();
  const graphics = new Graphics();
  const cells = new Set(district.cells.map(key));
  const color = Number.parseInt(district.color.slice(1), 16);
  for (const cell of district.cells) {
    const p = position(cell);
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
  group.addChild(graphics);
  if (district.status === "ACTIVE" && district.cells.length > 0) {
    const markerCell = district.cells.reduce((best, cell) => cell.y < best.y || cell.y === best.y && cell.x < best.x ? cell : best, district.cells[0]!);
    const marker = sprite(PROP_SPRITES["active-district-flag"]!, markerCell.x * CELL_SIZE + CELL_SIZE / 2, markerCell.y * CELL_SIZE + CELL_SIZE);
    marker.anchor.set(0.5, 1);
    group.addChild(marker);
  }
  return group;
}

function drawPlatform(task: ChunkTaskDto): Container {
  const group = new Container();
  const tile = PLATFORM_TILE[task.platformType];
  for (const cell of task.footprint) {
    const p = position(cell);
    group.addChild(sprite(tile.startsWith("/") ? tile : `/game-assets/v4/${tile}`, p.x, p.y));
  }
  return group;
}

function drawBuilding(task: ChunkTaskDto, onSelect: (taskId: string) => void): Container {
  const entry = getBuilding(task.buildingType);
  const group = new Container();
  group.eventMode = "static";
  group.cursor = "pointer";
  const building = sprite(entry.stages[task.stage - 1]!, 0, 0);
  building.anchor.set(0.5, 1);
  const x = task.origin.x * CELL_SIZE + entry.footprint.width * CELL_SIZE / 2;
  const y = task.origin.y * CELL_SIZE + entry.footprint.height * CELL_SIZE;
  group.position.set(x, y);
  group.hitArea = new Rectangle(-entry.spriteSize.width / 2, -entry.spriteSize.height, entry.spriteSize.width, entry.spriteSize.height);
  group.addChild(building);
  {
    const badgeColor = [0x9b72d2, 0xd6a13d, 0xf2c84b, 0x4fa5d7, 0x69ad67][task.stage - 1]!;
    const badgeX = entry.spriteSize.width / 2 - 5;
    const badgeY = -5;
    group.addChild(new Graphics().rect(badgeX - 5, badgeY - 5, 10, 10).fill(0x0b171a).stroke({ color: badgeColor, width: 2 }));
    const label = new Text({ text: String(task.stage), resolution: 4, style: new TextStyle({ fontFamily: "Arial, sans-serif", fontSize: 7, fontWeight: "900", fill: 0xffffff }) });
    label.anchor.set(0.5); label.position.set(badgeX, badgeY); group.addChild(label);
  }
  let tooltip: Container | undefined;
  group.on("pointerover", () => {
    if (!tooltip) {
      const details = task.descriptionPreview?.trim().replace(/\s+/g, " ") ?? "";
      tooltip = new Container();
      tooltip.eventMode = "none";
      const tooltipText = new Text({
        text: `${task.title}\n${TASK_STATUS_LABEL[task.status]} · ${task.progress}%${details ? `\n${details.slice(0, 96)}${details.length > 96 ? "…" : ""}` : ""}`,
        resolution: 4,
        style: new TextStyle({ fontFamily: "Arial, sans-serif", fontSize: 8, fontWeight: "600", lineHeight: 11, fill: 0xeaf2ee, wordWrap: true, wordWrapWidth: 144 }),
      });
      const padding = 5;
      const panel = new Graphics().roundRect(-padding, -padding, tooltipText.width + padding * 2, tooltipText.height + padding * 2, 3)
        .fill({ color: 0x0b181b, alpha: 0.96 }).stroke({ color: 0x4b6870, width: 1 });
      tooltip.addChild(panel, tooltipText);
      tooltip.position.set(-tooltipText.width / 2, -entry.spriteSize.height - tooltipText.height - 8);
      group.addChild(tooltip);
    }
    tooltip.visible = true;
  });
  group.on("pointerout", () => { if (tooltip) tooltip.visible = false; });
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
  group.addChild(new Graphics().rect(0, 0, width, height).fill(colors[entry.category]).stroke({ color: 0x263945, width: 2 }));
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

function drawWorldFeature(feature: WorldFeatureDto, includePlatform: boolean): { platform?: Container; visual?: Sprite } | null {
  if (feature.assetKind === "AREA") {
    if (!includePlatform) return null;
    const platform = new Container();
    const occupied = new Set(feature.footprint.map(key));
    for (const cell of feature.footprint) {
      const p = position(cell);
      const boundary = GRID_DIRECTIONS.some((direction) => !occupied.has(key({ x: cell.x + direction.x, y: cell.y + direction.y })));
      const tile = boundary ? TILE_SPRITES["path-brown"]! : `/game-assets/v4/${TERRAIN_SPRITES.MEADOW![1]!}`;
      platform.addChild(sprite(tile, p.x, p.y));
    }
    return { platform };
  }
  if (feature.assetKind === "PROP") {
    const metadata = PROP_CATALOG[feature.assetKey];
    if (!metadata) return null;
    const visual = sprite(
      metadata.path,
      feature.origin.x * CELL_SIZE + metadata.footprint.width * CELL_SIZE / 2,
      feature.origin.y * CELL_SIZE + metadata.footprint.height * CELL_SIZE,
    );
    visual.anchor.set(metadata.anchor.x / metadata.size.width, metadata.anchor.y / metadata.size.height);
    return { visual };
  }
  const entry = getBuilding(feature.assetKey);
  const platform = includePlatform ? new Container() : undefined;
  if (platform) {
    for (const cell of feature.footprint) {
      const p = position(cell);
      platform.addChild(sprite(TILE_SPRITES.road!, p.x, p.y));
    }
  }
  const visual = sprite(entry.stages[4]!, feature.origin.x * CELL_SIZE + entry.footprint.width * CELL_SIZE / 2, feature.origin.y * CELL_SIZE + entry.footprint.height * CELL_SIZE);
  visual.anchor.set(0.5, 1);
  return { platform, visual };
}

function assetUrl(path: string): string {
  return path.startsWith("/") ? path : `/game-assets/v4/${path}`;
}

function requiredAssets(chunks: Iterable<ChunkDto>, lod: MapLod): string[] {
  const urls = new Set<string>();
  urls.add(PROP_SPRITES["active-district-flag"]!);
  for (const chunk of chunks) {
    for (const task of chunk.tasks) {
      const entry = getBuilding(task.buildingType);
      if (lod === "DETAIL") {
        urls.add(entry.stages[task.stage - 1]!);
        urls.add(assetUrl(PLATFORM_TILE[task.platformType]));
      }
    }
    for (const feature of chunk.worldFeatures) {
      if (feature.assetKind === "PROP") {
        const metadata = PROP_CATALOG[feature.assetKey];
        if (metadata) urls.add(metadata.path);
      } else if (feature.assetKind === "BUILDING") {
        urls.add(getBuilding(feature.assetKey).stages[4]!);
        if (lod === "DETAIL") urls.add(TILE_SPRITES.road!);
      } else if (lod === "DETAIL") {
        urls.add(TILE_SPRITES["path-brown"]!);
        urls.add(assetUrl(TERRAIN_SPRITES.MEADOW![1]!));
      }
    }
    if (lod !== "DETAIL") continue;
    for (const cell of chunk.terrain) {
      const variants = TERRAIN_SPRITES[cell.terrain] ?? TERRAIN_SPRITES.GRASS!;
      urls.add(assetUrl(variants[cell.variant % variants.length]!));
    }
    for (const decoration of chunk.decorations) {
      const metadata = PROP_CATALOG[decoration.kind];
      if (metadata) urls.add(metadata.path);
    }
  }
  if (lod === "DETAIL") {
    urls.add(assetUrl(TERRAIN_SPRITES.DIRT![1]!));
    for (const path of Object.values(TILE_SPRITES)) urls.add(path);
    for (const path of Object.values(VEHICLE_SPRITES).flatMap((axes) => [axes.horizontal, axes.vertical])) urls.add(path);
    for (const key of ["walker-east", "walker-west", "walker-south", "walker-north"] as const) urls.add(PROP_SPRITES[key]!);
    for (const species of ["fox", "deer"] as const) for (const direction of ["north", "east", "south", "west"] as const) {
      urls.add(PROP_SPRITES[`animal-${species}-${direction}`]!);
    }
  }
  return [...urls];
}

export function WorldCanvas({ countryId, chunkSize, viewBounds, focusCity, invalidation, showDistricts, onTaskSelect }: {
  countryId: string;
  chunkSize: number;
  viewBounds: Rect;
  focusCity?: BootstrapDto["initialCity"];
  invalidation?: MapInvalidation;
  showDistricts: boolean;
  onTaskSelect: (taskId: string) => void;
}) {
  const [firstFrameReady, setFirstFrameReady] = useState(false);
  const [mapLoadError, setMapLoadError] = useState<string>();
  const hostRef = useRef<HTMLDivElement>(null);
  const districtLayerRef = useRef<Container | null>(null);
  const runtimeRef = useRef<WorldRuntime | null>(null);
  const showDistrictsRef = useRef(showDistricts);
  const focusArea = useMemo(() => {
    if (!focusCity) return undefined;
    return { point: focusCity.center, bounds: focusCity.bounds };
  }, [focusCity]);
  const focusX = focusArea?.point.x;
  const focusY = focusArea?.point.y;
  const focusMinX = focusArea?.bounds.minX;
  const focusMinY = focusArea?.bounds.minY;
  const focusMaxX = focusArea?.bounds.maxX;
  const focusMaxY = focusArea?.bounds.maxY;
  const viewBoundsKey = `${viewBounds.minX},${viewBounds.minY},${viewBounds.maxX},${viewBounds.maxY}`;
  const initialFocusRef = useRef(focusArea);
  const initialViewBoundsRef = useRef(viewBounds);

  useEffect(() => {
    showDistrictsRef.current = showDistricts;
    if (districtLayerRef.current) districtLayerRef.current.visible = showDistricts;
  }, [showDistricts]);

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

  useEffect(() => {
    const [minX, minY, maxX, maxY] = viewBoundsKey.split(",").map(Number);
    runtimeRef.current?.setViewBounds({ minX: minX!, minY: minY!, maxX: maxX!, maxY: maxY! });
  }, [viewBoundsKey]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    setFirstFrameReady(false);
    setMapLoadError(undefined);
    delete host.dataset.residentChunks;
    delete host.dataset.chunkRange;
    let disposed = false;
    const app = new Application();
    const chunks = new Map<string, ChunkDto>();
    const chunkLods = new Map<string, MapLod>();
    const chunkDataCache = new Map<string, ChunkDto>();
    const groundContainers = new Map<string, { terrain: Container; surfaces: Container; roads: Container; lod: MapLod; usedAt: number }>();
    const pendingChunks = new Map<string, { promise: Promise<ChunkDto>; controller: AbortController }>();
    const invalidatedGroundKeys = new Set<string>();
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
      const platformLayer = new Container();
      const featurePlatformLayer = new Container();
      const decorationLayer = new Container();
      const buildingLayer = new Container();
      const featureLayer = new Container();
      const agentLayer = new Container();
      districtLayer.visible = showDistrictsRef.current;
      world.addChild(backdropLayer, terrainLayer, surfaceLayer, roadLayer, districtLayer, platformLayer, featurePlatformLayer, decorationLayer, agentLayer, buildingLayer, featureLayer);
      app.stage.addChild(world);
      type RenderNode = Container | Graphics | Sprite;
      const districtViews = new Map<string, EntityViewRecord<Container>>();
      const taskPlatformViews = new Map<string, EntityViewRecord<Container>>();
      const taskBuildingViews = new Map<string, EntityViewRecord<Container>>();
      const decorationViews = new Map<string, EntityViewRecord<Sprite>>();
      const featureViews = new Map<string, { signature: string; platform?: Container; visual?: Sprite }>();
      let entityReplacementCount = 0;
      let currentViewBounds = initialViewBoundsRef.current;
      let currentLod: MapLod = world.scale.x < DETAIL_LOD_SCALE ? "OVERVIEW" : "DETAIL";
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
        view: Sprite;
        graph: Map<string, Cell>;
        current: Cell;
        next: Cell;
        previous?: Cell;
        progress: number;
        speed: number;
        kind: "CAR" | "WALKER" | "ANIMAL";
        variant: string;
        phase: number;
        pauseMs: number;
        steps: number;
      };
      let movingAgents: MovingAgent[] = [];
      let movingWalkers: MovingAgent[] = [];
      let activeCrosswalks = new Set<string>();
      let activityCells = new Set<string>();
      const straightRun = (graph: Map<string, Cell>, origin: Cell, direction: Cell, limit = 7): number => {
        let length = 0;
        let current = origin;
        while (length < limit) {
          const next = graph.get(key({ x: current.x + direction.x, y: current.y + direction.y }));
          if (!next) break;
          length += 1;
          current = next;
        }
        return length;
      };
      const bestLongitudinalNeighbor = (graph: Map<string, Cell>, current: Cell, excluded?: Cell): Cell | undefined => GRID_DIRECTIONS
        .map((direction, order) => ({
          direction,
          order,
          cell: graph.get(key({ x: current.x + direction.x, y: current.y + direction.y })),
          run: straightRun(graph, current, direction),
        }))
        .filter((candidate) => Boolean(candidate.cell) && (!excluded || key(candidate.cell!) !== key(excluded)))
        .sort((left, right) => right.run - left.run || left.order - right.order)[0]?.cell;
      const laneNeighbors = (graph: Map<string, Cell>, current: Cell): Cell[] => {
        const north = graph.get(key({ x: current.x, y: current.y - 1 }));
        const east = graph.get(key({ x: current.x + 1, y: current.y }));
        const south = graph.get(key({ x: current.x, y: current.y + 1 }));
        const west = graph.get(key({ x: current.x - 1, y: current.y }));
        const lanes = [
          east && !south ? east : undefined,
          south && !west ? south : undefined,
          west && !north ? west : undefined,
          north && !east ? north : undefined,
        ].filter((cell): cell is Cell => Boolean(cell));
        return lanes.length > 0 ? lanes : [north, east, south, west].filter((cell): cell is Cell => Boolean(cell));
      };
      const orientVehicle = (agent: MovingAgent): void => {
        if (agent.kind !== "CAR") return;
        agent.view.scale.set(1.08);
        if (agent.next.x < agent.current.x) agent.view.scale.x = -1.08;
        if (agent.next.y < agent.current.y) agent.view.scale.y = -1.08;
      };
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      host.dataset.animationActive = String(!reducedMotion);
      app.ticker.add(() => {
        if (reducedMotion) return;
        const elapsed = Math.min(50, app.ticker.deltaMS);
        for (const agent of movingAgents) {
          if (agent.pauseMs > 0) {
            agent.pauseMs = Math.max(0, agent.pauseMs - elapsed);
            continue;
          }
          if (agent.kind === "CAR" && mustYieldAtCrosswalk(
            agent.next,
            activeCrosswalks,
            movingWalkers,
          )) continue;
          agent.progress += elapsed * agent.speed;
          while (agent.progress >= 1) {
            agent.progress -= 1;
            agent.previous = agent.current;
            agent.current = agent.next;
            agent.steps += 1;
            const candidates = GRID_DIRECTIONS
              .map((direction) => agent.graph.get(key({ x: agent.current.x + direction.x, y: agent.current.y + direction.y })))
              .filter((cell): cell is Cell => Boolean(cell));
            const forward = agent.previous ? candidates.find((cell) => cell.x - agent.current.x === agent.current.x - agent.previous!.x && cell.y - agent.current.y === agent.current.y - agent.previous!.y) : undefined;
            const laneCandidates = agent.kind === "CAR" ? laneNeighbors(agent.graph, agent.current) : candidates;
            const alternatives = laneCandidates.filter((cell) => !agent.previous || key(cell) !== key(agent.previous));
            const wander = agent.kind === "WALKER" && alternatives.length > 1 && (agent.steps + Math.floor(agent.phase * 11)) % 4 === 0
              ? alternatives[(agent.steps + Math.floor(agent.phase * 7)) % alternatives.length]
              : undefined;
            agent.next = wander ?? forward
              ?? laneCandidates.find((cell) => !agent.previous || key(cell) !== key(agent.previous))
              ?? (agent.kind === "CAR" ? bestLongitudinalNeighbor(agent.graph, agent.current, agent.previous) : undefined)
              ?? candidates.find((cell) => !agent.previous || key(cell) !== key(agent.previous))
              ?? agent.previous ?? agent.current;
            const horizontal = agent.next.x !== agent.current.x;
            const direction = horizontal ? agent.next.x > agent.current.x ? "east" : "west" : agent.next.y > agent.current.y ? "south" : "north";
            const url = agent.kind === "CAR"
              ? VEHICLE_SPRITES[agent.variant]![horizontal ? "horizontal" : "vertical"]
              : agent.kind === "ANIMAL" ? PROP_SPRITES[`animal-${agent.variant}-${direction}`]
                : PROP_SPRITES[`walker-${direction}`];
            const texture = url ? Assets.get<Texture>(url) : undefined;
            if (texture) agent.view.texture = texture;
            orientVehicle(agent);
            if (agent.kind === "WALKER" && activityCells.has(key(agent.current)) && (agent.steps + Math.floor(agent.phase * 13)) % 3 === 0) {
              agent.pauseMs = 450 + Math.floor(agent.phase * 900);
            }
          }
          const x = agent.current.x + (agent.next.x - agent.current.x) * agent.progress;
          const y = agent.current.y + (agent.next.y - agent.current.y) * agent.progress;
          const cycle = Math.sin((agent.progress + agent.phase) * Math.PI * 4);
          const step = agent.kind === "WALKER" ? Math.abs(cycle) * 0.7 : agent.kind === "ANIMAL" ? Math.abs(cycle) * 0.35 : Math.abs(cycle) * 0.14;
          agent.view.position.set(x * CELL_SIZE + CELL_SIZE / 2, y * CELL_SIZE + CELL_SIZE / 2 - step);
          agent.view.rotation = agent.kind === "WALKER" ? cycle * 0.055 : agent.kind === "ANIMAL" ? cycle * 0.025 : cycle * 0.008;
        }
      });
      const initialScale = !initialFocus
        ? 1.25
        : fitCameraScale(app.screen, initialFocus.bounds, CELL_SIZE);
      const focus = initialFocus ? position(initialFocus.point) : { x: 0, y: 0 };
      const appliedInitialScale = Math.max(initialScale, minimumCameraScale(app.screen, currentViewBounds, CELL_SIZE));
      world.scale.set(appliedInitialScale);
      currentLod = appliedInitialScale < DETAIL_LOD_SCALE ? "OVERVIEW" : "DETAIL";
      world.position.set(app.screen.width / 2 - focus.x * appliedInitialScale, app.screen.height / 2 - focus.y * appliedInitialScale);

      let screenSize = { width: app.screen.width, height: app.screen.height };
      let resizeFrame = 0;
      let panFrame = 0;
      let reconcileFrame = 0;
      let reconcileMovement = false;
      let pendingMovementRebuild = false;
      let loadGeneration = 0;
      let loadRunning = false;
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
        if (world.scale.x < minimumScale) world.scale.set(minimumScale);
        const clamped = clampCameraPosition(world.position, world.scale.x, app.screen, currentViewBounds, CELL_SIZE);
        world.position.set(clamped.x, clamped.y);
      };
      const scheduleVisibleLoad = () => {
        cancelAnimationFrame(panFrame);
        panFrame = requestAnimationFrame(() => { void loadVisible(); });
      };
      clampCamera();
      const resizeObserver = new ResizeObserver(() => {
        cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(() => {
          world.position.x += (app.screen.width - screenSize.width) / 2;
          world.position.y += (app.screen.height - screenSize.height) / 2;
          screenSize = { width: app.screen.width, height: app.screen.height };
          app.stage.hitArea = app.screen;
          clampCamera();
          void loadVisible();
        });
      });
      resizeObserver.observe(host);
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

      function removeGround(cacheKey: string): void {
        const record = groundContainers.get(cacheKey);
        if (!record) return;
        record.terrain.removeFromParent(); record.terrain.destroy({ children: true });
        record.surfaces.removeFromParent(); record.surfaces.destroy({ children: true });
        record.roads.removeFromParent(); record.roads.destroy({ children: true });
        groundContainers.delete(cacheKey);
      }

      function buildGround(cacheKey: string, chunk: ChunkDto, lod: MapLod): void {
        removeGround(cacheKey);
        const terrain = new Container();
        const surfaces = new Container();
        const roads = new Container();
        terrain.eventMode = "none"; surfaces.eventMode = "none"; roads.eventMode = "none";
        if (lod === "DETAIL") {
          for (const cell of chunk.terrain) terrain.addChild(terrainSprite(cell));
          const surfaceMap = new Map(chunk.surfaces.map((surface) => [key(surface), surface]));
          for (const surface of chunk.surfaces) surfaces.addChild(drawSurface(surface));
          const roadMap = new Map(chunk.roads.map((road) => [key(road), road]));
          for (const road of chunk.roads) roads.addChild(drawRoad(road, surfaceMap, roadMap));
        } else {
          const terrainGraphics = new Graphics();
          for (const cell of chunk.terrain) {
            const localX = cell.x - chunk.chunkX * chunk.size;
            const localY = cell.y - chunk.chunkY * chunk.size;
            if (localX % 4 !== 0 || localY % 4 !== 0) continue;
            terrainGraphics.rect(cell.x * CELL_SIZE, cell.y * CELL_SIZE, CELL_SIZE * 4, CELL_SIZE * 4)
              .fill(TERRAIN_COLORS[cell.terrain] ?? TERRAIN_COLORS.GRASS);
          }
          terrain.addChild(terrainGraphics);
          const roadGraphics = new Graphics();
          for (const road of chunk.roads) roadGraphics.rect(road.x * CELL_SIZE, road.y * CELL_SIZE, CELL_SIZE, CELL_SIZE).fill(0x35414f);
          roads.addChild(roadGraphics);
        }
        terrainLayer.addChild(terrain); surfaceLayer.addChild(surfaces); roadLayer.addChild(roads);
        groundContainers.set(cacheKey, { terrain, surfaces, roads, lod, usedAt: performance.now() });
      }

      function renderEntities(rebuildMovement: boolean): void {
        if (rebuildMovement) {
          clear(agentLayer);
          movingAgents = [];
          movingWalkers = [];
        }
        const districts = new Map<string, ChunkDistrictDto>();
        const tasks = new Map<string, ChunkTaskDto>();
        const roads = new Map<string, RoadCellDto>();
        const surfaces = new Map<string, SurfaceCellDto>();
        const terrain = new Map<string, ChunkDto["terrain"][number]>();
        const decorations = new Map<string, ChunkDto["decorations"][number]>();
        const features = new Map<string, WorldFeatureDto>();
        for (const chunk of chunks.values()) {
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

        const reconcile = <T extends RenderNode, D>(
          source: Map<string, D>,
          records: Map<string, EntityViewRecord<T>>,
          layer: Container,
          factory: (item: D) => T | null,
          signatureOf: (item: D) => string = JSON.stringify,
        ) => {
          entityReplacementCount += reconcileEntityViews({
            source, records, signatureOf, create: factory,
            attach: (view) => { layer.addChild(view); },
            dispose: (view) => { view.removeFromParent(); view.destroy({ children: true }); },
          });
        };

        reconcile(districts, districtViews, districtLayer, drawDistrictBoundary);
        reconcile(
          currentLod === "DETAIL" ? tasks : new Map<string, ChunkTaskDto>(),
          taskPlatformViews,
          platformLayer,
          drawPlatform,
          (task) => JSON.stringify([task.platformType, task.footprint]),
        );
        reconcile(tasks, taskBuildingViews, buildingLayer, (task) => currentLod === "DETAIL" ? drawBuilding(task, onTaskSelect) : drawOverviewBuilding(task, onTaskSelect), (task) => `${currentLod}:${JSON.stringify(task)}`);
        reconcile(currentLod === "DETAIL" ? decorations : new Map<string, ChunkDto["decorations"][number]>(), decorationViews, decorationLayer, drawDecoration);

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
          const drawn = drawWorldFeature(feature, currentLod === "DETAIL");
          if (!drawn) { featureViews.delete(id); continue; }
          if (drawn.platform && currentLod === "DETAIL") featurePlatformLayer.addChild(drawn.platform);
          else if (drawn.platform) drawn.platform.destroy({ children: true });
          if (drawn.visual) featureLayer.addChild(drawn.visual);
          featureViews.set(id, {
            signature,
            platform: currentLod === "DETAIL" ? drawn.platform : undefined,
            visual: drawn.visual,
          });
          entityReplacementCount += 1;
        }
        decorationLayer.children.sort((a, b) => a.y - b.y);
        buildingLayer.children.sort((a, b) => a.y - b.y || a.x - b.x);
        featureLayer.children.sort((a, b) => a.y - b.y || a.x - b.x);
        host!.dataset.entityViews = String(
          districtViews.size + taskPlatformViews.size + taskBuildingViews.size + decorationViews.size + featureViews.size,
        );
        host!.dataset.entityReplacements = String(entityReplacementCount);

        if (!rebuildMovement) {
          host!.dataset.entityRebuilds = String(Number(host!.dataset.entityRebuilds ?? 0) + 1);
          return;
        }

        const addAgents = (graph: Map<string, Cell>, count: number, kind: MovingAgent["kind"]): void => {
          const candidates = [...graph.values()].filter((cell) => GRID_DIRECTIONS.some((direction) => graph.has(key({ x: cell.x + direction.x, y: cell.y + direction.y }))));
          if (candidates.length === 0) return;
          const colors = Object.keys(VEHICLE_SPRITES);
          const stride = Math.max(1, Math.floor(candidates.length / Math.max(1, count)));
          let created = 0;
          for (let index = 0; index < candidates.length && created < count; index += stride) {
            const current = candidates[index]!;
            const next = kind === "CAR"
              ? laneNeighbors(graph, current)[0] ?? bestLongitudinalNeighbor(graph, current)
              : GRID_DIRECTIONS.map((direction) => graph.get(key({ x: current.x + direction.x, y: current.y + direction.y }))).find((cell): cell is Cell => Boolean(cell));
            if (!next) continue;
            const horizontal = next.x !== current.x;
            const variant = kind === "ANIMAL" ? (created % 2 === 0 ? "fox" : "deer") : colors[(index / stride) % colors.length | 0] ?? "blue";
            const direction = horizontal ? next.x > current.x ? "east" : "west" : next.y > current.y ? "south" : "north";
            const url = kind === "CAR"
              ? VEHICLE_SPRITES[variant]![horizontal ? "horizontal" : "vertical"]
              : kind === "ANIMAL" ? PROP_SPRITES[`animal-${variant}-${direction}`]!
                : PROP_SPRITES[`walker-${direction}`]!;
            const view = sprite(url, current.x * CELL_SIZE + CELL_SIZE / 2, current.y * CELL_SIZE + CELL_SIZE / 2);
            view.anchor.set(0.5);
            agentLayer.addChild(view);
            const agent: MovingAgent = {
              view, graph, current, next, progress: (index % 7) / 7,
              speed: kind === "CAR" ? 0.0022 + (index % 3) * 0.00016 : kind === "ANIMAL" ? 0.00065 + (index % 3) * 0.00008 : 0.00115 + (index % 5) * 0.00013,
              kind, variant, phase: (index % 11) / 11, pauseMs: 0, steps: index % 17,
            };
            orientVehicle(agent);
            movingAgents.push(agent);
            if (kind === "WALKER") movingWalkers.push(agent);
            created += 1;
          }
        };
        const roadGraph = new Map([...roads].map(([cellKey, road]) => [cellKey, { x: road.x, y: road.y }]));
        const blockedWalkCells = new Set([
          ...[...tasks.values()].flatMap((task) => task.footprint),
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
        if (currentLod === "DETAIL") {
          addAgents(roadGraph, Math.min(24, Math.max(3, Math.floor(roads.size / 120))), "CAR");
          addAgents(walkGraph, Math.min(24, Math.max(4, Math.floor(walkGraph.size / 120))), "WALKER");
          addAgents(animalGraph, Math.min(4, Math.floor(animalGraph.size / 1800)), "ANIMAL");
        }
        host!.dataset.cars = String(movingAgents.filter((agent) => agent.kind === "CAR").length);
        host!.dataset.walkers = String(movingWalkers.length);
        host!.dataset.animals = String(movingAgents.filter((agent) => agent.kind === "ANIMAL").length);
        host!.dataset.movementRebuilds = String(Number(host!.dataset.movementRebuilds ?? 0) + 1);
        host!.dataset.entityRebuilds = String(Number(host!.dataset.entityRebuilds ?? 0) + 1);
        if (reducedMotion) {
          app.render();
          host!.dataset.staticRenders = String(Number(host!.dataset.staticRenders ?? 0) + 1);
        }
      }

      const lodForScale = (scale: number): MapLod => {
        if (currentLod === "DETAIL") return scale < DETAIL_LOD_EXIT_SCALE ? "OVERVIEW" : "DETAIL";
        return scale > DETAIL_LOD_ENTER_SCALE ? "DETAIL" : "OVERVIEW";
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
      const prepareChunk = async (chunkX: number, chunkY: number, lod: MapLod): Promise<ChunkDto> => {
        const cacheKey = chunkKey(chunkX, chunkY);
        let chunk = cachedChunkData(cacheKey, lod);
        if (!chunk) {
          const key = dataKey(cacheKey, lod);
          let pending = pendingChunks.get(key);
          if (!pending) {
            const controller = new AbortController();
            const promise = api<ChunkDto>(`/api/chunks/${chunkX}/${chunkY}?lod=${lod.toLowerCase()}`, { signal: controller.signal });
            pending = { controller, promise };
            pendingChunks.set(key, pending);
          }
          try {
            chunk = await pending.promise;
            storeChunkData(cacheKey, lod, chunk);
          } finally {
            if (pendingChunks.get(key) === pending) pendingChunks.delete(key);
          }
        }
        await Assets.load(requiredAssets([chunk], lod));
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
      const commitChunk = (cacheKey: string, chunk: ChunkDto, lod: MapLod, rebuildMovement: boolean) => {
        chunks.set(cacheKey, chunk);
        chunkLods.set(cacheKey, lod);
        const ground = groundContainers.get(cacheKey);
        const rebuildGround = invalidatedGroundKeys.delete(cacheKey) || ground?.lod !== lod;
        if (!rebuildGround && ground) ground.usedAt = performance.now();
        else buildGround(cacheKey, chunk, lod);
        scheduleEntityReconcile(rebuildMovement);
        host!.dataset.groundRebuilds = String(Number(host!.dataset.groundRebuilds ?? 0) + (rebuildGround ? 1 : 0));
        host!.dataset.residentChunks = String(chunks.size);
        host!.dataset.mapLod = lod.toLowerCase();
        if (reducedMotion) {
          app.render();
          host!.dataset.staticRenders = String(Number(host!.dataset.staticRenders ?? 0) + 1);
        }
        setFirstFrameReady(true);
      };
      const pruneGroundCache = (active: Set<string>) => {
        if (groundContainers.size <= GROUND_CACHE_LIMIT) return;
        const candidates = [...groundContainers.entries()]
          .filter(([cacheKey]) => !active.has(cacheKey))
          .sort((left, right) => left[1].usedAt - right[1].usedAt);
        for (const [cacheKey] of candidates) {
          if (groundContainers.size <= GROUND_CACHE_LIMIT) break;
          removeGround(cacheKey);
        }
      };
      const drainVisibleLoads = async (): Promise<void> => {
        if (loadRunning) return;
        loadRunning = true;
        try {
          while (!disposed) {
            const generation = loadGeneration;
            const lod = desiredLod;
            const wanted = [...desiredWanted];
            const active = new Set(desiredKeys);
            const residentBefore = new Set(chunks.keys());
            const rebuildMovement = pendingMovementRebuild;
            const lodTransition = lod !== currentLod;
            try {
              await inParallel(wanted, CHUNK_FETCH_CONCURRENCY, async ([chunkX, chunkY]) => {
                if (disposed || generation !== loadGeneration) return;
                const cacheKey = chunkKey(chunkX, chunkY);
                if (!lodTransition
                  && chunks.has(cacheKey)
                  && chunkLods.get(cacheKey) === lod
                  && groundContainers.get(cacheKey)?.lod === lod
                  && !invalidatedGroundKeys.has(cacheKey)) {
                  const ground = groundContainers.get(cacheKey);
                  if (ground) ground.usedAt = performance.now();
                  return;
                }
                const chunk = await prepareChunk(chunkX, chunkY, lod);
                if (disposed || generation !== loadGeneration || desiredLod !== lod || !desiredKeys.has(cacheKey)) return;
                if (!lodTransition) commitChunk(cacheKey, chunk, lod, rebuildMovement);
                else {
                  invalidatedGroundKeys.delete(cacheKey);
                  buildGround(cacheKey, chunk, lod);
                  host!.dataset.groundRebuilds = String(Number(host!.dataset.groundRebuilds ?? 0) + 1);
                  if (reducedMotion) {
                    app.render();
                    host!.dataset.staticRenders = String(Number(host!.dataset.staticRenders ?? 0) + 1);
                  }
                }
              });
            } catch (error) {
              if (!disposed && generation === loadGeneration && !(error instanceof DOMException && error.name === "AbortError")) {
                host!.dataset.loadError = "true";
                host!.dataset.loading = "false";
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
            if (lodTransition) {
              currentLod = lod;
              for (const [chunkX, chunkY] of wanted) {
                const cacheKey = chunkKey(chunkX, chunkY);
                const chunk = cachedChunkData(cacheKey, lod);
                if (chunk) commitChunk(cacheKey, chunk, lod, rebuildMovement);
              }
            }
            const covered = wanted.every(([chunkX, chunkY]) => {
              const cacheKey = chunkKey(chunkX, chunkY);
              return chunks.has(cacheKey) && chunkLods.get(cacheKey) === lod && groundContainers.get(cacheKey)?.lod === lod;
            });
            if (!covered) continue;
            let removedEntities = false;
            for (const cacheKey of [...chunks.keys()]) {
              if (active.has(cacheKey)) continue;
              chunks.delete(cacheKey);
              chunkLods.delete(cacheKey);
              removedEntities = true;
            }
            if (removedEntities) scheduleEntityReconcile(rebuildMovement);
            const activeSetChanged = lodTransition
              || removedEntities
              || active.size !== residentBefore.size
              || [...active].some((cacheKey) => !residentBefore.has(cacheKey));
            scheduleEntityReconcile(rebuildMovement || activeSetChanged);
            if (rebuildMovement) pendingMovementRebuild = false;
            pruneGroundCache(active);
            renderedRange = desiredRange;
            host!.dataset.residentChunks = String(chunks.size);
            host!.dataset.groundCache = String(groundContainers.size);
            host!.dataset.chunkDataCache = String(chunkDataCache.size);
            host!.dataset.chunkRange = renderedRange;
            host!.dataset.mapLod = currentLod.toLowerCase();
            host!.dataset.loading = "false";
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
        const wanted: Array<[number, number]> = [];
        for (let chunkX = range.minChunkX; chunkX <= range.maxChunkX; chunkX += 1) {
          for (let chunkY = range.minChunkY; chunkY <= range.maxChunkY; chunkY += 1) wanted.push([chunkX, chunkY]);
        }
        const centerX = (range.minChunkX + range.maxChunkX) / 2;
        const centerY = (range.minChunkY + range.maxChunkY) / 2;
        wanted.sort((left, right) => (
          Math.abs(left[0] - centerX) + Math.abs(left[1] - centerY)
          - Math.abs(right[0] - centerX) - Math.abs(right[1] - centerY)
        ));
        desiredLod = nextLod;
        desiredRange = rangeLabel;
        desiredWanted = wanted;
        desiredKeys = new Set(wanted.map(([chunkX, chunkY]) => chunkKey(chunkX, chunkY)));
        if (options.forceKeys?.size) {
          for (const cacheKey of options.forceKeys) {
            for (const lod of ["DETAIL", "OVERVIEW"] as const) {
              chunkDataCache.delete(dataKey(cacheKey, lod));
              const pending = pendingChunks.get(dataKey(cacheKey, lod));
              pending?.controller.abort();
              pendingChunks.delete(dataKey(cacheKey, lod));
            }
            chunkLods.delete(cacheKey);
          }
        }
        pendingMovementRebuild ||= Boolean(options.rebuildMovement);
        loadGeneration += 1;
        host!.dataset.loading = "true";
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
          const scale = Math.max(fitCameraScale(app.screen, area.bounds, CELL_SIZE), minimumCameraScale(app.screen, currentViewBounds, CELL_SIZE));
          const point = position(area.point);
          world.scale.set(scale);
          world.position.set(app.screen.width / 2 - point.x * scale, app.screen.height / 2 - point.y * scale);
          clampCamera();
          renderedRange = "";
          void loadVisible();
        },
        invalidate(event) {
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
          }
          for (const cacheKey of affectedKeys) {
            if (groundContainers.has(cacheKey)) invalidatedGroundKeys.add(cacheKey);
            for (const lod of ["DETAIL", "OVERVIEW"] as const) {
              const key = dataKey(cacheKey, lod);
              chunkDataCache.delete(key);
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
        const oldScale = world.scale.x;
        const newScale = Math.max(0.8, Math.min(4, oldScale * (event.deltaY > 0 ? 0.88 : 1.12)));
        const rect = canvas.getBoundingClientRect();
        const mouse = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        const local = { x: (mouse.x - world.position.x) / oldScale, y: (mouse.y - world.position.y) / oldScale };
        const appliedScale = Math.max(newScale, minimumCameraScale(app.screen, currentViewBounds, CELL_SIZE));
        world.scale.set(appliedScale);
        world.position.set(mouse.x - local.x * appliedScale, mouse.y - local.y * appliedScale);
        clampCamera();
        void loadVisible();
      };
      canvas.addEventListener("wheel", wheel, { passive: false });
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
      document.addEventListener("visibilitychange", visibility);
      loadVisible();
      updateAnimation();
      (host as HTMLElement & { cleanupMap?: () => void }).cleanupMap = () => {
        if (districtLayerRef.current === districtLayer) districtLayerRef.current = null;
        if (runtimeRef.current) runtimeRef.current = null;
        resizeObserver.disconnect(); cancelAnimationFrame(resizeFrame); cancelAnimationFrame(panFrame); cancelAnimationFrame(reconcileFrame); window.clearTimeout(loadRetryTimer);
        intersectionObserver.disconnect();
        for (const pending of pendingChunks.values()) pending.controller.abort();
        pendingChunks.clear();
        canvas.removeEventListener("wheel", wheel); document.removeEventListener("visibilitychange", visibility);
      };
    })();

    return () => {
      disposed = true;
      (host as HTMLElement & { cleanupMap?: () => void }).cleanupMap?.();
      if (app.renderer) app.destroy({ removeView: true }, { children: true });
    };
  }, [chunkSize, countryId, onTaskSelect]);

  return <div className="world-canvas-wrap">
    <div ref={hostRef} className="world-canvas" data-animation-active="true" />
    {!firstFrameReady && !mapLoadError && <div className="app-loading world-first-frame-loading" role="status"><div className="loader-square" /><span>Готовим карту…</span></div>}
    {mapLoadError && <div className="app-loading world-first-frame-loading" role="alert"><span>{mapLoadError}</span><button type="button" className="map-retry-button" onClick={() => runtimeRef.current?.retry()}>Повторить</button></div>}
  </div>;
}
