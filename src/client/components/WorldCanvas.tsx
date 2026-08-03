import { useEffect, useMemo, useRef } from "react";
import { Application, Assets, Container, FederatedPointerEvent, Graphics, Rectangle, Sprite, Text, TextStyle, Texture } from "pixi.js";
import { BUILDING_CATALOG, PROP_CATALOG, PROP_SPRITES, TERRAIN_SPRITES, TILE_SPRITES, VEHICLE_SPRITES, getBuilding } from "../../shared/catalog";
import type { BootstrapDto, Cell, ChunkDto, DistrictDto, PlatformKind, RoadCellDto, SurfaceCellDto, TaskDto, WorldFeatureDto } from "../../shared/contracts";
import { api } from "../api";
import { connectShortWalkGaps, mustYieldAtCrosswalk } from "../agent-routing";
import {
  chunkRangeForViewport,
  clampCameraPosition,
  countryViewBounds,
  fitCameraScale,
  minimumCameraScale,
} from "../world-camera";

const CELL_SIZE = 8;
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

function position(cell: Cell): { x: number; y: number } {
  return { x: cell.x * CELL_SIZE, y: cell.y * CELL_SIZE };
}

function key(cell: Cell): string { return `${cell.x},${cell.y}`; }

function clear(container: Container): void {
  for (const child of container.removeChildren()) child.destroy({ children: true });
}

function sprite(url: string, x: number, y: number): Sprite {
  const result = Sprite.from(url);
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
    : cell.kind === "PATH" ? TILE_SPRITES["path-brown"]!
      : cell.kind === "DRIVEWAY" ? TILE_SPRITES.road!
        : cell.kind === "CROSSWALK" ? TILE_SPRITES[cell.orientation === "V" ? "crosswalk-vertical" : "crosswalk-horizontal"]!
          : `/game-assets/v4/${TERRAIN_SPRITES.DIRT![1]!}`;
  return sprite(url, p.x, p.y);
}

function drawRoad(cell: RoadCellDto, surfaces: Map<string, SurfaceCellDto>): Container {
  const group = new Container();
  const p = position(cell);
  group.addChild(sprite(TILE_SPRITES.road!, p.x, p.y));
  const crossing = surfaces.get(key(cell));
  if (crossing?.kind === "CROSSWALK") {
    group.addChild(sprite(TILE_SPRITES[crossing.orientation === "V" ? "crosswalk-vertical" : "crosswalk-horizontal"]!, p.x, p.y));
  }
  for (let direction = 0; direction < GRID_DIRECTIONS.length; direction += 1) {
    const config = GRID_DIRECTIONS[direction]!;
    if (cell.mask & config.bit) continue;
    if (cell.structure === "BRIDGE") {
      const edgeUrl = (cell.mask & (2 | 8)) ? TILE_SPRITES["bridge-side-horizontal"]! : TILE_SPRITES["bridge-side-vertical"]!;
      group.addChild(edgeSprite(edgeUrl, cell, direction));
    }
  }
  return group;
}

function drawDistrictBoundary(district: DistrictDto): Graphics {
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
  graphics.stroke({ color, width: 1.4, alpha: district.status === "ACTIVE" ? 0.95 : 0.72, cap: "square" });
  return graphics;
}

function drawPlatform(task: TaskDto): Container {
  const group = new Container();
  const tile = PLATFORM_TILE[task.platformType];
  for (const cell of task.footprint) {
    const p = position(cell);
    group.addChild(sprite(tile.startsWith("/") ? tile : `/game-assets/v4/${tile}`, p.x, p.y));
  }
  return group;
}

function drawBuilding(task: TaskDto, onSelect: (taskId: string) => void): Container {
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
  if (task.stage < 5) {
    const badgeColor = [0x9b72d2, 0xd6a13d, 0xf2c84b, 0x4fa5d7][task.stage - 1]!;
    const badgeX = entry.spriteSize.width / 2 - 2;
    const badgeY = -entry.spriteSize.height + 3;
    group.addChild(new Graphics().circle(badgeX, badgeY, 4).fill(0x122126).stroke({ color: badgeColor, width: 1 }));
    const label = new Text({ text: String(task.stage), style: new TextStyle({ fontFamily: "monospace", fontSize: 5, fontWeight: "700", fill: 0xffffff }) });
    label.anchor.set(0.5); label.position.set(badgeX, badgeY); group.addChild(label);
  }
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

function drawWorldFeature(feature: WorldFeatureDto): { platform?: Container; visual?: Sprite } | null {
  if (feature.assetKind === "AREA") {
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
  const platform = new Container();
  for (const cell of feature.footprint) {
    const p = position(cell);
    platform.addChild(sprite(TILE_SPRITES.road!, p.x, p.y));
  }
  const visual = sprite(entry.stages[4]!, feature.origin.x * CELL_SIZE + entry.footprint.width * CELL_SIZE / 2, feature.origin.y * CELL_SIZE + entry.footprint.height * CELL_SIZE);
  visual.anchor.set(0.5, 1);
  return { platform, visual };
}

const ASSET_URLS = [
  ...Object.values(TERRAIN_SPRITES).flat().map((value) => `/game-assets/v4/${value}`),
  ...Object.values(PROP_SPRITES),
  ...Object.values(TILE_SPRITES),
  ...Object.values(VEHICLE_SPRITES).flatMap((axes) => [axes.horizontal, axes.vertical]),
  ...BUILDING_CATALOG.flatMap((entry) => entry.stages),
];

export function WorldCanvas({ bootstrap, revision, focusCityId, showDistricts, onTaskSelect }: {
  bootstrap: BootstrapDto;
  revision: number;
  focusCityId?: string;
  showDistricts: boolean;
  onTaskSelect: (taskId: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const districtLayerRef = useRef<Container | null>(null);
  const showDistrictsRef = useRef(showDistricts);
  const focusCity = bootstrap.cities.find((city) => city.id === focusCityId) ?? bootstrap.cities[0];
  const focusArea = useMemo(() => {
    if (!focusCity) return undefined;
    const cells = bootstrap.districts.filter((district) => district.cityId === focusCity.id).flatMap((district) => district.cells);
    if (cells.length === 0) return { point: focusCity.center, bounds: focusCity.bounds };
    const bounds = {
      minX: Math.min(...cells.map((cell) => cell.x)) - 4,
      minY: Math.min(...cells.map((cell) => cell.y)) - 12,
      maxX: Math.max(...cells.map((cell) => cell.x)) + 4,
      maxY: Math.max(...cells.map((cell) => cell.y)) + 4,
    };
    return {
      point: { x: (bounds.minX + bounds.maxX + 1) / 2, y: (bounds.minY + bounds.maxY + 1) / 2 },
      bounds,
    };
  }, [bootstrap.districts, focusCity]);
  const focusX = focusArea?.point.x;
  const focusY = focusArea?.point.y;
  const viewBounds = useMemo(() => countryViewBounds(bootstrap.cities), [bootstrap.cities]);
  const accessibleTasks = useMemo(() => bootstrap.tasks.slice(0, 50), [bootstrap.tasks]);

  useEffect(() => {
    showDistrictsRef.current = showDistricts;
    if (districtLayerRef.current) districtLayerRef.current.visible = showDistricts;
  }, [showDistricts]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    delete host.dataset.residentChunks;
    delete host.dataset.chunkRange;
    let disposed = false;
    const app = new Application();
    const chunks = new Map<string, ChunkDto>();
    const pendingChunks = new Map<string, Promise<ChunkDto>>();

    void (async () => {
      await Assets.load(ASSET_URLS);
      await app.init({ resizeTo: host, backgroundColor: 0x101d20, antialias: false, autoDensity: true, resolution: Math.min(devicePixelRatio, 2), preference: "webgl" });
      if (disposed) { app.destroy({ removeView: true }, { children: true }); return; }
      const canvas = app.canvas;
      canvas.className = "world-canvas-element";
      canvas.setAttribute("aria-label", "Интерактивная карта страны");
      host.appendChild(canvas);

      const world = new Container();
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
      world.addChild(terrainLayer, surfaceLayer, roadLayer, districtLayer, platformLayer, featurePlatformLayer, decorationLayer, agentLayer, buildingLayer, featureLayer);
      app.stage.addChild(world);
      type MovingAgent = {
        view: Sprite;
        graph: Map<string, Cell>;
        current: Cell;
        next: Cell;
        previous?: Cell;
        progress: number;
        speed: number;
        kind: "CAR" | "WALKER";
        variant: string;
        phase: number;
        pauseMs: number;
        steps: number;
      };
      let movingAgents: MovingAgent[] = [];
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
        agent.view.scale.set(1);
        if (agent.next.x < agent.current.x) agent.view.scale.x = -1;
        if (agent.next.y < agent.current.y) agent.view.scale.y = -1;
      };
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      host.dataset.animationActive = String(!reducedMotion);
      app.ticker.add(() => {
        if (reducedMotion) return;
        const elapsed = Math.min(50, app.ticker.deltaMS);
        const walkers = movingAgents.filter((agent) => agent.kind === "WALKER");
        for (const agent of movingAgents) {
          if (agent.pauseMs > 0) {
            agent.pauseMs = Math.max(0, agent.pauseMs - elapsed);
            continue;
          }
          if (agent.kind === "CAR" && mustYieldAtCrosswalk(
            agent.next,
            activeCrosswalks,
            walkers,
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
            const url = agent.kind === "CAR"
              ? VEHICLE_SPRITES[agent.variant]![horizontal ? "horizontal" : "vertical"]
              : PROP_SPRITES[horizontal ? agent.next.x > agent.current.x ? "walker-east" : "walker-west" : agent.next.y > agent.current.y ? "walker-south" : "walker-north"];
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
          const step = agent.kind === "WALKER" ? Math.abs(cycle) * 0.7 : Math.abs(cycle) * 0.14;
          agent.view.position.set(x * CELL_SIZE + CELL_SIZE / 2, y * CELL_SIZE + CELL_SIZE / 2 - step);
          agent.view.rotation = agent.kind === "WALKER" ? cycle * 0.055 : cycle * 0.008;
        }
      });
      const initialScale = focusX == null || focusY == null || !focusArea
        ? 1.25
        : fitCameraScale(app.screen, focusArea.bounds, CELL_SIZE);
      const focus = focusX == null || focusY == null ? { x: 0, y: 0 } : position({ x: focusX, y: focusY });
      const appliedInitialScale = Math.max(initialScale, minimumCameraScale(app.screen, viewBounds, CELL_SIZE));
      world.scale.set(appliedInitialScale);
      world.position.set(app.screen.width / 2 - focus.x * appliedInitialScale, app.screen.height / 2 - focus.y * appliedInitialScale);

      let screenSize = { width: app.screen.width, height: app.screen.height };
      let resizeFrame = 0;
      let panFrame = 0;
      let loadRevision = 0;
      let dragging = false;
      let previous = { x: 0, y: 0 };
      const clampCamera = () => {
        const minimumScale = minimumCameraScale(app.screen, viewBounds, CELL_SIZE);
        if (world.scale.x < minimumScale) world.scale.set(minimumScale);
        const clamped = clampCameraPosition(world.position, world.scale.x, app.screen, viewBounds, CELL_SIZE);
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

      async function loadVisible(): Promise<void> {
        const currentLoad = ++loadRevision;
        const range = chunkRangeForViewport(
          world.position, world.scale.x, app.screen, viewBounds, CELL_SIZE, bootstrap.chunkSize,
        );
        const wanted: Array<[number, number]> = [];
        for (let chunkX = range.minChunkX; chunkX <= range.maxChunkX; chunkX += 1) {
          for (let chunkY = range.minChunkY; chunkY <= range.maxChunkY; chunkY += 1) wanted.push([chunkX, chunkY]);
        }
        try {
          await Promise.all(wanted.map(async ([chunkX, chunkY]) => {
            const cacheKey = `${chunkX},${chunkY}`;
            if (chunks.has(cacheKey)) return;
            let pending = pendingChunks.get(cacheKey);
            if (!pending) {
              pending = api<ChunkDto>(`/api/chunks/${chunkX}/${chunkY}`);
              pendingChunks.set(cacheKey, pending);
            }
            try { chunks.set(cacheKey, await pending); }
            finally { pendingChunks.delete(cacheKey); }
          }));
        } catch {
          if (!disposed && currentLoad === loadRevision) host!.dataset.loadError = "true";
          return;
        }
        if (disposed || currentLoad !== loadRevision) return;
        const active = new Set(wanted.map(([chunkX, chunkY]) => `${chunkX},${chunkY}`));
        for (const cacheKey of chunks.keys()) if (!active.has(cacheKey)) chunks.delete(cacheKey);
        host!.dataset.residentChunks = String(chunks.size);
        host!.dataset.chunkRange = `${range.minChunkX},${range.minChunkY}:${range.maxChunkX},${range.maxChunkY}`;
        delete host!.dataset.loadError;
        render();
      }

      function render(): void {
        [terrainLayer, surfaceLayer, roadLayer, districtLayer, platformLayer, featurePlatformLayer, decorationLayer, buildingLayer, featureLayer, agentLayer].forEach(clear);
        movingAgents = [];
        const districts = new Map<string, DistrictDto>();
        const tasks = new Map<string, TaskDto>();
        const roads = new Map<string, RoadCellDto>();
        const surfaces = new Map<string, SurfaceCellDto>();
        const terrain = new Map<string, ChunkDto["terrain"][number]>();
        const decorations = new Map<string, ChunkDto["decorations"][number]>();
        const features = new Map<string, WorldFeatureDto>();
        for (const chunk of chunks.values()) {
          for (const cell of chunk.terrain) { terrain.set(key(cell), cell); terrainLayer.addChild(terrainSprite(cell)); }
          for (const road of chunk.roads) roads.set(key(road), road);
          for (const surface of chunk.surfaces) surfaces.set(key(surface), surface);
          for (const district of chunk.districts) districts.set(district.id, district);
          for (const task of chunk.tasks) tasks.set(task.id, task);
          for (const decoration of chunk.decorations) decorations.set(decoration.id, decoration);
          for (const feature of chunk.worldFeatures) features.set(feature.id, feature);
        }
        for (const surface of surfaces.values()) surfaceLayer.addChild(drawSurface(surface));
        for (const road of roads.values()) roadLayer.addChild(drawRoad(road, surfaces));
        for (const district of districts.values()) districtLayer.addChild(drawDistrictBoundary(district));
        for (const task of tasks.values()) platformLayer.addChild(drawPlatform(task));
        for (const decoration of decorations.values()) {
          const item = drawDecoration(decoration);
          if (item) decorationLayer.addChild(item);
        }
        decorationLayer.children.sort((a, b) => a.y - b.y);
        [...tasks.values()].sort((a, b) => a.origin.y - b.origin.y || a.origin.x - b.origin.x)
          .forEach((task) => buildingLayer.addChild(drawBuilding(task, onTaskSelect)));
        for (const feature of [...features.values()].sort((a, b) => a.origin.y - b.origin.y || a.origin.x - b.origin.x)) {
          const drawn = drawWorldFeature(feature);
          if (!drawn) continue;
          if (drawn.platform) featurePlatformLayer.addChild(drawn.platform);
          if (drawn.visual) featureLayer.addChild(drawn.visual);
        }

        const addAgents = (graph: Map<string, Cell>, count: number, kind: MovingAgent["kind"]): void => {
          const candidates = [...graph.values()].filter((cell) => GRID_DIRECTIONS.some((direction) => graph.has(key({ x: cell.x + direction.x, y: cell.y + direction.y }))));
          if (candidates.length === 0) return;
          const colors = Object.keys(VEHICLE_SPRITES);
          const stride = Math.max(1, Math.floor(candidates.length / Math.max(1, count)));
          for (let index = 0; index < candidates.length && movingAgents.filter((agent) => agent.kind === kind).length < count; index += stride) {
            const current = candidates[index]!;
            const next = kind === "CAR"
              ? laneNeighbors(graph, current)[0] ?? bestLongitudinalNeighbor(graph, current)
              : GRID_DIRECTIONS.map((direction) => graph.get(key({ x: current.x + direction.x, y: current.y + direction.y }))).find((cell): cell is Cell => Boolean(cell));
            if (!next) continue;
            const horizontal = next.x !== current.x;
            const variant = colors[(index / stride) % colors.length | 0] ?? "blue";
            const url = kind === "CAR"
              ? VEHICLE_SPRITES[variant]![horizontal ? "horizontal" : "vertical"]
              : PROP_SPRITES[horizontal ? next.x > current.x ? "walker-east" : "walker-west" : next.y > current.y ? "walker-south" : "walker-north"]!;
            const view = sprite(url, current.x * CELL_SIZE + CELL_SIZE / 2, current.y * CELL_SIZE + CELL_SIZE / 2);
            view.anchor.set(0.5);
            agentLayer.addChild(view);
            const agent: MovingAgent = {
              view, graph, current, next, progress: (index % 7) / 7,
              speed: kind === "CAR" ? 0.0022 + (index % 3) * 0.00016 : 0.00115 + (index % 5) * 0.00013,
              kind, variant, phase: (index % 11) / 11, pauseMs: 0, steps: index % 17,
            };
            orientVehicle(agent);
            movingAgents.push(agent);
          }
        };
        const roadGraph = new Map([...roads].map(([cellKey, road]) => [cellKey, { x: road.x, y: road.y }]));
        const blockedWalkCells = new Set([
          ...[...tasks.values()].flatMap((task) => task.footprint),
          ...[...features.values()].filter((feature) => feature.assetKind !== "AREA").flatMap((feature) => feature.footprint),
          ...[...decorations.values()].map((decoration) => decoration.origin),
        ].map(key));
        const baseWalkGraph = new Map([...surfaces]
          .filter(([cellKey, surface]) => !blockedWalkCells.has(cellKey) && (surface.kind === "SIDEWALK" || surface.kind === "PATH" || surface.kind === "CROSSWALK"))
          .map(([cellKey, surface]) => [cellKey, { x: surface.x, y: surface.y }]));
        const safeGround = new Map([...terrain]
          .filter(([cellKey, cell]) => !blockedWalkCells.has(cellKey) && !roads.has(cellKey) && ["GRASS", "MEADOW", "DIRT"].includes(cell.terrain))
          .map(([cellKey, cell]) => [cellKey, { x: cell.x, y: cell.y }]));
        const walkGraph = connectShortWalkGaps(baseWalkGraph, safeGround, 2);
        activeCrosswalks = new Set([...surfaces].filter(([, surface]) => surface.kind === "CROSSWALK").map(([cellKey]) => cellKey));
        activityCells = new Set<string>();
        for (const decoration of decorations.values()) {
          if (!["bench-horizontal", "bench-vertical", "picnic-table", "playground-small", "trash-bin"].includes(decoration.kind)) continue;
          for (const direction of GRID_DIRECTIONS) activityCells.add(key({ x: decoration.origin.x + direction.x, y: decoration.origin.y + direction.y }));
        }
        for (const feature of features.values()) if (feature.kind === "BUS_STOP" || feature.kind === "PARK") {
          for (const cell of [...feature.footprint, ...feature.accessPath]) activityCells.add(key(cell));
        }
        addAgents(roadGraph, Math.min(28, Math.max(3, Math.floor(roads.size / 90))), "CAR");
        addAgents(walkGraph, Math.min(96, Math.max(8, Math.floor(walkGraph.size / 38))), "WALKER");
        host!.dataset.cars = String(movingAgents.filter((agent) => agent.kind === "CAR").length);
        host!.dataset.walkers = String(movingAgents.filter((agent) => agent.kind === "WALKER").length);
      }

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
        const appliedScale = Math.max(newScale, minimumCameraScale(app.screen, viewBounds, CELL_SIZE));
        world.scale.set(appliedScale);
        world.position.set(mouse.x - local.x * appliedScale, mouse.y - local.y * appliedScale);
        clampCamera();
        void loadVisible();
      };
      canvas.addEventListener("wheel", wheel, { passive: false });
      const visibility = () => document.hidden ? app.stop() : app.start();
      document.addEventListener("visibilitychange", visibility);
      await loadVisible();
      (host as HTMLElement & { cleanupMap?: () => void }).cleanupMap = () => {
        if (districtLayerRef.current === districtLayer) districtLayerRef.current = null;
        resizeObserver.disconnect(); cancelAnimationFrame(resizeFrame); cancelAnimationFrame(panFrame);
        canvas.removeEventListener("wheel", wheel); document.removeEventListener("visibilitychange", visibility);
      };
    })();

    return () => {
      disposed = true;
      (host as HTMLElement & { cleanupMap?: () => void }).cleanupMap?.();
      if (app.renderer) app.destroy({ removeView: true }, { children: true });
    };
  }, [bootstrap.chunkSize, focusArea, focusX, focusY, onTaskSelect, revision, viewBounds]);

  return <div className="world-canvas-wrap">
    <div ref={hostRef} className="world-canvas" data-animation-active="true" />
    <div className="sr-only" aria-label="Задачи на карте">
      {accessibleTasks.map((task) => <button key={task.id} onClick={() => onTaskSelect(task.id)}>Открыть задачу {task.title}</button>)}
    </div>
  </div>;
}
