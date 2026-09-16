import { seaVessel } from "../../shared/sea-vessel";
import { railPolyline, railConvoy, type RailPolyline } from "../../shared/rail-convoy";
import { readServerWorldTime } from "../server-world-clock";
import { transportSchedule, transportProgress, type TransportSchedule } from "../../shared/transport-schedule";
import { useAtlasQuality } from "../use-atlas-quality";
import { startVisibleAnimation } from "../visible-animation";
import { retainCountryRenderSnapshot } from "../country-render-snapshot";
import { miniatureBuildingArt, miniatureTransportMarkers } from "../../shared/city-miniature";
import { loadMapImage } from "../map-image";
import { loadMapWithTimeout } from "../map-load-timeout";
import { countryRailways } from "../../shared/country-railways";
import { useEffect, useRef, useState } from "react";
import type { RealtimeEvent } from "../../shared/contracts";
import { COUNTRY_OVERVIEW_SCHEMA_VERSION, decodeCountryTerrain, type CountryOverviewCityDto, type CountryOverviewDto } from "../../shared/country-overview-contract";
import { gameAssetUrl, PROP_SPRITES } from "../../shared/catalog";
import { atlasAircraftEndpointScale, atlasTerrainConnectionMask, buildAtlasFlightGeometry, sampleAtlasFlight, type AtlasFlightGeometry } from "../../shared/atlas-scene";
import { api } from "../api";
import { countrySceneCache } from "../map-scene-cache";
import { microAmbientSprite } from "../../shared/micro-ambient";
import { smoothCameraScale } from "../world-camera";
import { bindMapPointerGestures } from "../map-pointer-gesture";
import { COUNTRY_FULL_LABEL_LIMIT, layoutCountryCityLabels } from "../country-city-labels";
import { atlasHitTarget, continuousAtlasZoom, mapAtlasFocusPoint, type AtlasWheelNavigation } from "../atlas-zoom-navigation";
import { overviewTerrainPatches } from "../../shared/overview-terrain-presentation";
import type { RoadAtlasTile } from "../../shared/road-atlas";
import { COUNTRY_ROAD_ASPHALT_PIXELS, COUNTRY_ROAD_ATLAS_TILES, COUNTRY_ROAD_PAVEMENT_PIXELS, drawCountryRoadRaster, planCountryRoadRaster } from "../country-road-render";

const MIN_ZOOM = .55;
const MAX_ZOOM = 2.6;
// One miniature coordinate is eight CITY cells; actual block centers retain
// their relative positions, with one finished house per occupied block.
const CITY_LOD_CELL_SIZE = .72;

type Camera = { zoom: number; centerX: number; centerY: number };
type Flight = { view: HTMLImageElement; schedule:TransportSchedule; fromAirportId:string; toAirportId:string; route: AtlasFlightGeometry; startsAtAirport: boolean; fromCityId: string; toCityId: string; from: { x: number; y: number }; to: { x: number; y: number } };

export function CountryOverviewCanvas({ countryId, transportRevision = 0, worldRevision, activeCityId, initialFocusCityId, events, onEventsProcessed, onCitySelect, onCityHover, onZoomOut, wheelNavigation }: {
  countryId: string;
  worldRevision: number;
  transportRevision?: number;
  activeCityId?: string;
  initialFocusCityId?: string;
  events: RealtimeEvent[];
  onEventsProcessed: (eventId: number) => void;
  onCitySelect: (city: CountryOverviewCityDto, focus?: { x: number; y: number }, sourcePoint?: { x: number; y: number }) => void;
  onCityHover: (city: CountryOverviewCityDto | null) => void;
  onZoomOut: (focus?: { x: number; y: number }) => void;
  wheelNavigation: AtlasWheelNavigation;
}) {
  const cacheKey = `${countryId}:${worldRevision}`;
  const [overview, setOverview] = useState<CountryOverviewDto | null>(()=>countrySceneCache.peek(cacheKey)??null);
  const [renderOverview, setRenderOverview] = useState(overview);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const retry = () => { setError(""); setAttempt(value => value + 1); };
  const [renderReady, setRenderReady] = useState(false);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [cityQuery, setCityQuery] = useState("");
  const hostRef = useRef<HTMLDivElement>(null);
  useAtlasQuality(hostRef, renderReady);
  const labelsRef = useRef<HTMLDivElement>(null);
  const directoryRef = useRef<HTMLDivElement>(null);
  const directoryToggleRef = useRef<HTMLButtonElement>(null);
  const directorySearchRef = useRef<HTMLInputElement>(null);
  const activeCityRef = useRef(activeCityId);
  const scheduleLabelsRef = useRef<(() => void) | null>(null);
  const processedEventIdRef = useRef(0);
  const mountedAtRef = useRef(0);
  const onZoomOutRef = useRef(onZoomOut);
  const onCitySelectRef = useRef(onCitySelect);

  useEffect(() => {
    onZoomOutRef.current = onZoomOut;
    onCitySelectRef.current = onCitySelect;
  }, [onCitySelect, onZoomOut]);

  useEffect(() => {
    activeCityRef.current = activeCityId;
    scheduleLabelsRef.current?.();
  }, [activeCityId, overview]);

  useEffect(() => {
    if (!directoryOpen) return;
    directorySearchRef.current?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !directoryRef.current?.contains(event.target) && !directoryToggleRef.current?.contains(event.target)) setDirectoryOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [directoryOpen]);

  useEffect(() => {
    const controller = new AbortController();
    mountedAtRef.current = performance.now();
    const cached = countrySceneCache.peek(cacheKey);
    const publish = (next: CountryOverviewDto) => {
      setOverview(next);
      setRenderOverview(previous => retainCountryRenderSnapshot(previous,next));
    };
    if (cached) publish(cached);
    setError("");
    void countrySceneCache.read(cacheKey, ()=>loadMapWithTimeout(signal => api<CountryOverviewDto>(`/api/countries/${countryId}/overview`, {
      signal, headers: { accept: `application/vnd.tasktopia.country-overview+json; version=${COUNTRY_OVERVIEW_SCHEMA_VERSION}` },
    })))
      .then((next) => {
        if (controller.signal.aborted) return;
        if (next.schemaVersion !== COUNTRY_OVERVIEW_SCHEMA_VERSION || next.countryId !== countryId) throw new Error("Сервер вернул карту другой страны");
        publish(next);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Не удалось загрузить страну");
      });
    return () => controller.abort();
  }, [countryId, cacheKey, attempt, transportRevision]);

  useEffect(() => {
    if (!overview) return;
    const pending = events
      .filter((event) => event.countryId === countryId && event.id > processedEventIdRef.current)
      .sort((left, right) => left.id - right.id);
    if (pending.length === 0) return;
    const latestId = pending.at(-1)!.id;
    // App advances the revision and its scoped cache in the same event batch.
    // The revision loader above is the only data-fetch owner.
    if (pending.some(event => event.worldVersion > worldRevision)) return;
    processedEventIdRef.current = latestId;
    onEventsProcessed(latestId);
  }, [countryId, events, onEventsProcessed, overview, worldRevision]);

  useEffect(() => {
    const overview = renderOverview;
    const host = hostRef.current;
    const labels = labelsRef.current;
    if (!host || !labels || !overview || overview.countryId !== countryId) return;
    host.dataset.countrySceneBuilds = String(Number(host.dataset.countrySceneBuilds ?? 0)+1);
    setRenderReady(false);
    let disposed = false;
    const imageController = new AbortController();
    const loadAtlasImage = (url: string) => loadMapImage(url, imageController.signal);
    let frame = 0;
    let zoomFrame = 0;
    let stopFlights: (() => void) | undefined;
    let stopShips: (() => void) | undefined;
    let stopTrains: (() => void) | undefined;
    let lastZoomFrame = 0;
    let readyTimer = 0;
    let maxCameraFrameMs = 0;
    let rasterCanvas: HTMLCanvasElement | null = null;
    let terrainSource: HTMLCanvasElement | null = null;
    const entryCity = overview.cities.find((city) => city.id === initialFocusCityId);
    const camera: Camera = {
      zoom: entryCity ? 1.1 : .72,
      centerX: entryCity?.atlasCenter.x ?? (overview.bounds.minX + overview.bounds.maxX) / 2,
      centerY: entryCity?.atlasCenter.y ?? (overview.bounds.minY + overview.bounds.maxY) / 2,
    };
    const targetCamera: Camera = { ...camera };
    const flights: Flight[] = [];
    const citiesById = new Map(overview.cities.map(city => [city.id, city]));
    const railways = countryRailways(overview);
    let renderShips=()=>{};
    let shipTime:number|undefined;
    const shipPaths=new Map<string,RailPolyline>();
    const ships:Array<{route:NonNullable<CountryOverviewDto["seaConnections"]>[number];view:HTMLImageElement;schedule:TransportSchedule}>=[];
    const trainPaths=new Map<string,RailPolyline>();
    const trains:Array<{route:typeof railways[number];view:HTMLDivElement;cars:HTMLImageElement[];schedule:TransportSchedule}>=[];
    const railwayCanvas = document.createElement("canvas");
    railwayCanvas.className = "country-railway-overlay";
    railwayCanvas.setAttribute("aria-hidden", "true");
    const railwayContext = railwayCanvas.getContext("2d")!;
    host.append(railwayCanvas);
    let miniatureTextureRevision = 0;
    const cityGlyphs: Array<{ city: CountryOverviewCityDto; canvas: HTMLCanvasElement; draw: () => void }> = [];
    const cityZoom = () => camera.zoom / .72;
    const cityUnit = (city: CountryOverviewCityDto) => Math.min(3, 96 / Math.max(1, city.miniature.columns, city.miniature.rows)) * cityZoom();
    const screenPoint = (city: CountryOverviewCityDto, x: number, y: number) => ({
      x: Math.round(sceneX + city.atlasCenter.x * sceneScale + (x - city.miniature.columns / 2) * cityUnit(city)),
      y: Math.round(sceneY + city.atlasCenter.y * sceneScale + (y - city.miniature.rows / 2) * cityUnit(city)),
    });
    let sceneScale = 1;
    let sceneX = 0;
    let sceneY = 0;
    const orderedCities = [...overview.cities].sort((left, right) => left.atlasCenter.y - right.atlasCenter.y || left.atlasCenter.x - right.atlasCenter.x);
    const dense = overview.cities.length > COUNTRY_FULL_LABEL_LIMIT;
    let labelMetrics: Array<{ city: CountryOverviewCityDto; label: HTMLElement; leader: HTMLElement | null; width: number; height: number }> | null = null;

    const applyCamera = () => {
      const startedAt = performance.now();
      frame = 0;
      if (disposed) return;
      const width = host.clientWidth;
      const height = host.clientHeight;
      const worldWidth = overview.bounds.maxX - overview.bounds.minX;
      const worldHeight = overview.bounds.maxY - overview.bounds.minY;
      const scale = Math.min(width / worldWidth, height / worldHeight) * camera.zoom;
      // Keep a world point under the viewport centre; the tiled ocean fills
      // exposed margins even when the island is smaller than the viewport.
      camera.centerX = Math.max(overview.bounds.minX, Math.min(overview.bounds.maxX, camera.centerX));
      camera.centerY = Math.max(overview.bounds.minY, Math.min(overview.bounds.maxY, camera.centerY));
      sceneScale = scale;
      sceneX = width / 2 - camera.centerX * scale;
      sceneY = height / 2 - camera.centerY * scale;
      host.style.backgroundSize = `${overview.geography.cellSize * scale / 2}px ${overview.geography.cellSize * scale / 2}px`;
      host.style.backgroundPosition = `${sceneX}px ${sceneY}px`;
      if (rasterCanvas && terrainSource) {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const pixelWidth = Math.round(width * dpr), pixelHeight = Math.round(height * dpr);
        if (rasterCanvas.width !== pixelWidth || rasterCanvas.height !== pixelHeight) {
          rasterCanvas.width = pixelWidth; rasterCanvas.height = pixelHeight;
          rasterCanvas.style.width = `${width}px`; rasterCanvas.style.height = `${height}px`;
        }
        const ctx = rasterCanvas.getContext("2d")!;
        ctx.clearRect(0, 0, pixelWidth, pixelHeight);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(terrainSource, Math.round(sceneX * dpr), Math.round(sceneY * dpr),
          Math.round(overview.geography.columns * overview.geography.cellSize * scale * dpr),
          Math.round(overview.geography.rows * overview.geography.cellSize * scale * dpr));
      }
      railwayCanvas.width = width;
      railwayCanvas.height = height;
      for (const route of overview.seaConnections ?? []) {
        shipPaths.set(route.id,railPolyline(route.points.map(p=>({x:sceneX+p.x*scale,y:sceneY+p.y*scale}))));
      }
      renderShips();
      for (const railway of railways) {
        const stationPoint = (id: string, stationId: string) => {
          const city = citiesById.get(id);
          const station = city?.miniature.stations?.find(station=>station.taskId===stationId);
          if (!city || !station) return undefined;
          return screenPoint(city, station.x, station.y);
        };
        const points = railway.points.map(p => ({ x: Math.round(sceneX + p.x * scale), y: Math.round(sceneY + p.y * scale) }));
        points[0] = stationPoint(railway.fromCityId,railway.fromStationId) ?? points[0]!;
        points[points.length - 1] = stationPoint(railway.toCityId,railway.toStationId) ?? points.at(-1)!;
        trainPaths.set(railway.id,railPolyline(points));
        railwayContext.beginPath();
        points.forEach((p, i) => i ? railwayContext.lineTo(p.x, p.y) : railwayContext.moveTo(p.x, p.y));
        railwayContext.setLineDash([]);
        railwayContext.strokeStyle = "#293c39"; railwayContext.lineWidth = 3; railwayContext.stroke();
        railwayContext.strokeStyle = "#b5b69a"; railwayContext.lineWidth = 1; railwayContext.stroke();
        railwayContext.setLineDash([1, 4]);
        railwayContext.strokeStyle = "#293c39"; railwayContext.lineWidth = 4; railwayContext.stroke();
      }
      for (const { city, canvas, draw } of cityGlyphs) {
        draw();
        const center = screenPoint(city, city.miniature.columns / 2, city.miniature.rows / 2);
        canvas.style.transform = `translate3d(${center.x - Math.floor(canvas.width / 2)}px, ${center.y - Math.floor(canvas.height / 2)}px, 0)`;
        canvas.hidden = center.x < -canvas.width || center.y < -canvas.height || center.x > width + canvas.width || center.y > height + canvas.height;
      }
      // Read label geometry once and perform only compositor-friendly transform
      // writes during camera frames. Interleaving offset reads and style writes
      // forced a full document layout for every city on every wheel event.
      labelMetrics ??= orderedCities.flatMap((city) => {
        const label = labels.querySelector<HTMLElement>(`[data-city-id="${city.id}"]`);
        return label ? [{ city, label, leader: labels.querySelector<HTMLElement>(`[data-leader-city="${city.id}"]`),
          width: dense ? 140 : Math.max(116, label.offsetWidth), height: dense ? 44 : Math.max(34, label.offsetHeight) }] : [];
      });
      const placements = new Map(layoutCountryCityLabels(labelMetrics.map(({ city, width, height }) => ({ id: city.id,
        x: sceneX + city.atlasCenter.x * scale, y: sceneY + city.atlasCenter.y * scale, width, height,
        priority: city.id === activeCityRef.current ? 1 : 0,
        offset: Math.max(28, city.miniature.rows * cityUnit(city) / 2 + 10),
      })), { width, height }).map(point => [point.id, point]));
      for (const { city, label, leader } of labelMetrics) {
        const chosen = placements.get(city.id);
        label.hidden = !chosen;
        if (leader) leader.hidden = !chosen;
        if (!chosen) continue;
        label.style.transform = `translate3d(${chosen.x}px, ${chosen.y}px, 0) translate(-50%, -50%)`;
        if (leader) {
          const endX = Math.max(chosen.x - chosen.width / 2, Math.min(chosen.x + chosen.width / 2, chosen.anchor.x));
          const endY = Math.max(chosen.y - chosen.height / 2, Math.min(chosen.y + chosen.height / 2, chosen.anchor.y));
          const dx = endX - chosen.anchor.x, dy = endY - chosen.anchor.y;
          leader.style.width = `${Math.hypot(dx, dy)}px`;
          leader.style.transform = `translate3d(${chosen.anchor.x}px, ${chosen.anchor.y}px, 0) rotate(${Math.atan2(dy, dx)}rad)`;
        }
      }
      host.dataset.countryZoom = camera.zoom.toFixed(2);
      host.dataset.countryVisibleLabels = String(placements.size);
      maxCameraFrameMs = Math.max(maxCameraFrameMs, performance.now() - startedAt);
      host.dataset.countryCameraFrameMaxMs = maxCameraFrameMs.toFixed(1);
    };
    const scheduleCamera = () => {
      if (!frame) frame = requestAnimationFrame(applyCamera);
    };
    scheduleLabelsRef.current = () => { labelMetrics = null; scheduleCamera(); };
    const animateZoom = (timestamp: number) => {
      zoomFrame = 0;
      if (disposed) return;
      const deltaMs = lastZoomFrame ? timestamp - lastZoomFrame : 16;
      lastZoomFrame = timestamp;
      camera.zoom = smoothCameraScale(camera.zoom, targetCamera.zoom, deltaMs);
      camera.centerX = smoothCameraScale(camera.centerX, targetCamera.centerX, deltaMs);
      camera.centerY = smoothCameraScale(camera.centerY, targetCamera.centerY, deltaMs);
      applyCamera();
      if (camera.zoom !== targetCamera.zoom || camera.centerX !== targetCamera.centerX || camera.centerY !== targetCamera.centerY) {
        zoomFrame = requestAnimationFrame(animateZoom);
      } else {
        lastZoomFrame = 0;
      }
    };
    const scheduleZoom = () => {
      if (!zoomFrame) zoomFrame = requestAnimationFrame(animateZoom);
    };

    void (async () => {
      const { columns, rows, cellSize, terrainCodes, territoryCodes } = overview.geography;
      const rasterScale = 4;
      const groundRoadPlan = planCountryRoadRaster(overview.groundRoads, overview.geography, rasterScale);
      const terrainKinds = Array.from({ length: terrainCodes.length }, (_, index) => decodeCountryTerrain(terrainCodes[index] ?? "0"));
      const terrainAt = (column: number, row: number) => column >= 0 && row >= 0 && column < columns && row < rows
        ? terrainKinds[row * columns + column]
        : undefined;
      const terrainTiles = terrainKinds.map((kind, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        return overviewTerrainPatches(kind, "country", column, row, atlasTerrainConnectionMask(kind, column, row, terrainAt));
      });
      const assetUrls = new Set(terrainTiles.flatMap(patches => patches.map(patch => gameAssetUrl(patch.tile.url))));
      assetUrls.add(gameAssetUrl(overviewTerrainPatches("deep_water", "country", 0, 0, 15)[0]!.tile.url));
      if (groundRoadPlan.routes.length) for (const tile of Object.values(COUNTRY_ROAD_ATLAS_TILES)) assetUrls.add(gameAssetUrl(tile.url));
      const miniatureUrls = new Set<string>();
      for (const city of overview.cities) {
        for (const block of city.miniature.blocks) miniatureUrls.add(miniatureBuildingArt(block.family,1,10,block.stage).url);
        for (const marker of miniatureTransportMarkers(city.miniature)) miniatureUrls.add(miniatureBuildingArt(marker.family,1,8,marker.stage).url);
      }
      // Land and navigation are usable even when a building image fails or stalls.
      const textures = new Map(await Promise.all([...assetUrls].map(async (url) => [url, await loadAtlasImage(url)] as const)));
      let loadedMiniatures = 0;
      host.dataset.countryMiniaturesLoaded = "0";
      host.dataset.countryMiniaturesExpected = String(miniatureUrls.size);
      for (const url of miniatureUrls) void loadAtlasImage(url).then(image => {
        if (disposed) return;
        textures.set(url, image); miniatureTextureRevision++;
        host.dataset.countryMiniaturesLoaded = String(++loadedMiniatures);
        scheduleCamera();
      }).catch(() => {
        if (!disposed) setError("Часть зданий не загрузилась. Карта доступна.");
      });
      if (disposed) return;
      // Compose immutable atlas tiles on a small CPU canvas. At four pixels
      // per world unit every4-unit semantic cell remains16x16px. Its material
      // now has two material tiles per axis; neither geography nor texture size
      // grows. Camera frames sample this immutable source directly into a
      // viewport bitmap, avoiding a CSS downscale followed by a filtered upscale.
      const staticCanvas = document.createElement("canvas");
      staticCanvas.width = Math.round(columns * cellSize * rasterScale);
      staticCanvas.height = Math.round(rows * cellSize * rasterScale);
      const context = staticCanvas.getContext("2d")!;
      context.imageSmoothingEnabled = false;
      const viewportCanvas = document.createElement("canvas");
      viewportCanvas.className = "country-overview-raster";
      viewportCanvas.setAttribute("aria-hidden", "true");
      terrainSource = staticCanvas;
      rasterCanvas = viewportCanvas;
      const oceanTile = overviewTerrainPatches("deep_water", "country", 0, 0, 15)[0]!.tile;
      const oceanCanvas = document.createElement("canvas"); oceanCanvas.width = oceanCanvas.height = Math.round(cellSize * rasterScale / 2);
      const oceanContext = oceanCanvas.getContext("2d")!; oceanContext.imageSmoothingEnabled = false;
      const oceanSource = textures.get(gameAssetUrl(oceanTile.url));
      if (oceanSource) {
        oceanContext.drawImage(oceanSource, oceanTile.sourceX, oceanTile.sourceY, oceanTile.tileSize, oceanTile.tileSize, 0, 0, oceanCanvas.width, oceanCanvas.height);
        host.style.backgroundImage = `url(${oceanCanvas.toDataURL()})`;
      }
      let selectedCellCount = 0;
      let neighborCellCount = 0;
      let waterCellCount = 0;
      let unknownCellCount = 0;
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const index = row * columns + column;
          const kind = decodeCountryTerrain(terrainCodes[index] ?? "0");
          const territory = territoryCodes[index] ?? "0";
          const x = column * cellSize;
          const y = row * cellSize;
          // Deep ocean is one continuous background. Leaving these cells
          // transparent avoids a rectangular seam from atlas tile variants.
          for (const { x: dx, y: dy, size, tile } of kind === "deep_water" || kind === "unknown" ? [] : terrainTiles[index]!) {
            const source = textures.get(gameAssetUrl(tile.url))!;
            context.drawImage(source, tile.sourceX, tile.sourceY, tile.tileSize, tile.tileSize,
              (x + dx * cellSize) * rasterScale, (y + dy * cellSize) * rasterScale,
              size * cellSize * rasterScale, size * cellSize * rasterScale);
          }
          if (territory === "1") {
            selectedCellCount += 1;
            context.fillStyle = "#c6d98412";
            context.fillRect(x * rasterScale, y * rasterScale, cellSize * rasterScale, cellSize * rasterScale);
          } else if (territory === "2") {
            neighborCellCount += 1;
            context.fillStyle = "#31515a24";
            context.fillRect(x * rasterScale, y * rasterScale, cellSize * rasterScale, cellSize * rasterScale);
          }
          if (kind === "deep_water" || kind === "shallow_water") waterCellCount += 1;
          else if (kind === "unknown") unknownCellCount += 1;
        }
      }
      host.dataset.countryTerrainRender = "directional-16px-sheets";
      host.dataset.countryMaterialSubdivisions = "2";
      host.dataset.countryMaterialPatches = String(terrainTiles.length * 4);
      host.dataset.countryRasterPixels = String(staticCanvas.width * staticCanvas.height);
      host.dataset.countrySelectedCells = String(selectedCellCount);
      host.dataset.countryNeighborCells = String(neighborCellCount);
      host.dataset.countryWaterCells = String(waterCellCount);
      host.dataset.countryUnknownCells = String(unknownCellCount);

      const roadBakeStarted = performance.now();
      if (groundRoadPlan.routes.length) {
        const pattern = (tile: RoadAtlasTile): CanvasPattern => {
          const canvas = document.createElement("canvas"); canvas.width = tile.tileSize; canvas.height = tile.tileSize;
          const tileContext = canvas.getContext("2d")!; tileContext.imageSmoothingEnabled = false;
          tileContext.drawImage(textures.get(gameAssetUrl(tile.url))!, tile.sourceX, tile.sourceY, tile.tileSize, tile.tileSize,
            0, 0, tile.tileSize, tile.tileSize);
          const result = context.createPattern(canvas, "repeat");
          if (!result) throw new Error("Could not create shared country road material");
          return result;
        };
        drawCountryRoadRaster(context, groundRoadPlan, { asphalt: pattern(COUNTRY_ROAD_ATLAS_TILES.asphalt), pavement: pattern(COUNTRY_ROAD_ATLAS_TILES.pavement) });
      }
      host.dataset.countryGroundRoads = String(groundRoadPlan.routes.length);
      host.dataset.countryGroundRoadRevision = String(overview.groundRoads.revision);
      host.dataset.countryGroundRoadUnavailable = String(overview.groundRoads.unavailable.length);
      host.dataset.countryGroundRoadRejected = String(groundRoadPlan.rejectedRouteIds.length);
      host.dataset.countryGroundRoadCorridorCells = String(groundRoadPlan.corridorCellCount);
      host.dataset.countryGroundRoadRectangles = String(groundRoadPlan.rectCount);
      host.dataset.countryGroundRoadAtlasUrls = String(groundRoadPlan.routes.length ? 2 : 0);
      host.dataset.countryGroundRoadAsphaltPixels = String(COUNTRY_ROAD_ASPHALT_PIXELS);
      host.dataset.countryGroundRoadPavementPixels = String(COUNTRY_ROAD_PAVEMENT_PIXELS);
      host.dataset.countryGroundRoadBakeMs = (performance.now() - roadBakeStarted).toFixed(2);

      host.dataset.countryRailways = String(railways.length);
      const airportPoints = new Map<string, { x: number; y: number }>();
      for (const city of overview.cities) {
        const miniature = city.miniature;
        let renderedZoom = -1, renderedTextures = -1;
        const canvas = document.createElement("canvas");
        canvas.className = "country-city-glyph";
        canvas.dataset.cityId = city.id;
        canvas.setAttribute("aria-hidden", "true");
        const renderGlyph = () => {
          if (renderedZoom === camera.zoom && renderedTextures === miniatureTextureRevision) return;
          renderedTextures = miniatureTextureRevision;
          renderedZoom = camera.zoom;
          const unit = cityUnit(city);
          canvas.width = Math.ceil(miniature.columns * unit) + Math.ceil(24 * cityZoom());
          canvas.height = Math.ceil(miniature.rows * unit) + Math.ceil(24 * cityZoom());
          const glyph = canvas.getContext("2d")!;
          glyph.imageSmoothingEnabled = false;
          const draw = (family: string, x: number, y: number, baseWidth = 10, stage = 5) => {
            const { width, height, url } = miniatureBuildingArt(family, cityZoom(), baseWidth, stage);
            const image = textures.get(url);
            if (!image) return;
            glyph.drawImage(image, Math.round(canvas.width / 2 + (x - miniature.columns / 2) * unit - width / 2),
              Math.round(canvas.height / 2 + (y - miniature.rows / 2) * unit - height / 2), width, height);
          };
          for (const block of miniature.blocks) draw(block.family, block.x, block.y,10,block.stage);
          for (const marker of miniatureTransportMarkers(miniature)) draw(marker.family, marker.x, marker.y, 8,marker.stage);
          for (const airport of miniature.airports) {
            airportPoints.set(airport.taskId, { x: city.atlasCenter.x + (airport.x - miniature.columns / 2) * CITY_LOD_CELL_SIZE,
              y: city.atlasCenter.y + (airport.y - miniature.rows / 2) * CITY_LOD_CELL_SIZE });

          }
        };
        renderGlyph();
        cityGlyphs.push({ city, canvas, draw: renderGlyph });
        host.append(canvas);
      }
      if (disposed) return;
      host.prepend(viewportCanvas);
      host.dataset.countryCityRender = "one-house-per-block";

      // Optional traffic assets never hold the map's first frame.
      if (overview.seaConnections?.length) void (async()=>{
        const source=await loadAtlasImage(PROP_SPRITES["boat-horizontal-b"]!);
        if(disposed)return;
        for(const route of overview.seaConnections!.slice(0,3)){
          const view=document.createElement("img");view.src=source.src;view.alt="";
          view.className="country-atlas-ship";view.dataset.routeId=route.id;view.hidden=true;
          host.append(view);ships.push({route,view,schedule:transportSchedule("SEA",route.fromPortId,route.toPortId)});
        }
        const animate=()=>{
          if(shipTime===undefined || !document.hidden && !matchMedia("(prefers-reduced-motion: reduce)").matches)shipTime=readServerWorldTime()??Date.now();
          const now=shipTime,budget=host.dataset.worldQuality==="ECONOMY"?1:3;
          ships.forEach((ship,index)=>{
            const path=shipPaths.get(ship.route.id);
            if(!path||index>=budget){ship.view.hidden=true;return;}
            const state=seaVessel(path,ship.schedule,ship.route.fromPortId,now,ship.route.progressRange);
            ship.view.hidden=!state.visible;ship.view.dataset.phase=state.phase;ship.view.dataset.progress=String(state.progress);
            if(!state.point)return;
            const width=36*cityZoom(),height=12*cityZoom();
            ship.view.style.width=`${width}px`;ship.view.style.height=`${height}px`;
            ship.view.style.transform=`translate3d(${state.point.x-width/2}px,${state.point.y-height/2}px,0) rotate(${state.point.angle}rad)`;
          });
        };
        renderShips=animate;animate();stopShips=startVisibleAnimation(animate);
      })().catch(()=>{if(!disposed)host.dataset.countryShipAssets="unavailable";});
      void (async()=>{
        const sources=new Map<string,string>();
        await Promise.all(["locomotive","carriage"].flatMap(part=>["east","north"].map(async direction=>{
          const key=`${part}-${direction}`;
          const image=await loadAtlasImage(gameAssetUrl(`city-transport/${key}.png`));sources.set(key,image.src);
        })));
        if(disposed)return;
        for(const route of railways.slice(0,4)){
          const view=document.createElement("div");view.className="country-atlas-train";view.dataset.routeId=route.id;
          view.setAttribute("aria-hidden","true");view.hidden=true;
          const cars=Array.from({length:4},()=>{const image=document.createElement("img");image.alt="";view.append(image);return image;});
          host.append(view);trains.push({route,view,cars,schedule:transportSchedule("RAIL",route.fromStationId,route.toStationId)});
        }
        const animate=()=>{
          const now=readServerWorldTime()??Date.now(),budget=host.dataset.worldQuality==="ECONOMY"?2:4;
          trains.forEach((train,index)=>{
            const path=trainPaths.get(train.route.id);
            if(!path||index>=budget){train.view.hidden=true;return;}
            const state=railConvoy(path,train.schedule,train.route.fromStationId,now,7*cityZoom(),train.route.progressRange);
            train.view.hidden=!state.visible;train.view.dataset.phase=state.phase;train.view.dataset.progress=state.progress.toFixed(4);
            if(!state.visible)return;
            state.cars.forEach((car,i)=>{
              const vertical=car.heading==="north"||car.heading==="south",image=train.cars[i]!;
              const source=sources.get(`${i===0?"locomotive":"carriage"}-${vertical?"north":"east"}`)!;
              if(image.getAttribute("src")!==source)image.src=source;
              const width=(vertical?3:6)*cityZoom(),height=(vertical?6:3)*cityZoom();
              image.style.width=`${width}px`;image.style.height=`${height}px`;
              image.style.transform=`translate3d(${Math.round(car.x-width/2)}px,${Math.round(car.y-height/2)}px,0) rotate(${car.heading==="west"||car.heading==="south"?180:0}deg)`;
            });
          });
        };
        animate();stopTrains=startVisibleAnimation(animate);
      })().catch(()=>{if(!disposed)host.dataset.countryTrainAssets="unavailable";});

      const routeInputs = overview.connections.flatMap((connection, index) => {
        const primary = (cityId: string, airportId?: string) => {
          const airports=citiesById.get(cityId)?.miniature.airports ?? [];
          return airportId ? airports.find(airport=>airport.taskId===airportId) : [...airports].sort((a,b)=>a.taskId.localeCompare(b.taskId))[0];
        };
        const fromAirport=primary(connection.fromCityId,connection.fromAirportId);
        const toAirport=primary(connection.toCityId,connection.toAirportId);
        const from=fromAirport ? airportPoints.get(fromAirport.taskId) : connection.fromPoint;
        const to=toAirport ? airportPoints.get(toAirport.taskId) : connection.toPoint;
        const fromId=fromAirport?.taskId ?? connection.fromAirportId, toId=toAirport?.taskId ?? connection.toAirportId;
        return from && to && fromId && toId ? [{ from, to, index, schedule:transportSchedule("AIR",fromId,toId),fromAirportId:fromId,toAirportId:toId, startsAtAirport: true, fromCityId: connection.fromCityId, toCityId: connection.toCityId }] : [];
      }).slice(0,5);
      // Aircraft are decoration: their network latency must not hold the map.
      void (async () => {
        const headingImages = routeInputs.length ? await Promise.all((["north","east","south","west"] as const).map(async heading => {
          const image = await loadAtlasImage(microAmbientSprite("aircraft","regional",heading).url); return image.src;
        })) : [];
        const planeTextures = await Promise.all(routeInputs.map(() => loadAtlasImage(microAmbientSprite("aircraft","regional","east").url)));
        if (disposed) return;
        for (let index = 0; index < routeInputs.length; index += 1) {
          const route = routeInputs[index]!;
          const view = planeTextures[index]!;
          view.className = "country-atlas-aircraft";
          view.setAttribute("aria-hidden", "true");
          view.style.width = "8px";
          view.style.height = "8px";
          host.append(view);
          flights.push({
            view,
            schedule:route.schedule, fromAirportId:route.fromAirportId,toAirportId:route.toAirportId,
            route: buildAtlasFlightGeometry(route.from, route.to, `country:${countryId}:${index}`, 18),
            startsAtAirport: route.startsAtAirport,
            fromCityId: route.fromCityId, toCityId: route.toCityId, from: route.from, to: route.to,
          });
        }
        const animateFlights = () => {
          if (disposed) return;
          const now=readServerWorldTime() ?? Date.now();
          for (const flight of flights) {
            const state=transportProgress(flight.schedule,flight.fromAirportId,now);
            const progress=state.progress;
            flight.view.hidden = state.phase!=="MOVING";
            flight.view.dataset.routeId=flight.schedule.id;
            flight.view.dataset.progress=progress.toFixed(4);
            if (flight.view.hidden) continue;
            const sample = sampleAtlasFlight(flight.route, progress);
            const endpointScale = atlasAircraftEndpointScale(progress, flight.startsAtAirport, true);
            const endpointDelta = (id: string, airportId: string, point: { x: number; y: number }) => {
              const city = citiesById.get(id);
              const airport = city?.miniature.airports.find(airport=>airport.taskId===airportId);
              if (!city || !airport) return {x:0,y:0};
              const screen = screenPoint(city, airport.x, airport.y);
              return { x: screen.x - sceneX - point.x * sceneScale, y: screen.y - sceneY - point.y * sceneScale };
            };
            const fromDelta = endpointDelta(flight.fromCityId, flight.fromAirportId, flight.from), toDelta = endpointDelta(flight.toCityId, flight.toAirportId, flight.to);
            const screenX = sceneX + sample.x * sceneScale + fromDelta.x * (1 - progress) + toDelta.x * progress;
            const screenY = sceneY + sample.y * sceneScale + fromDelta.y * (1 - progress) + toDelta.y * progress;
            const heading = (Math.round((sample.angle + (state.direction === -1 ? Math.PI : 0)) / (Math.PI / 2)) + 5) % 4;
            if (flight.view.dataset.heading !== String(heading)) { flight.view.src=headingImages[heading]!; flight.view.dataset.heading=String(heading); }
            flight.view.style.opacity=String(endpointScale);
            flight.view.style.transform = `translate3d(${Math.round(screenX)-4}px, ${Math.round(screenY)-4}px, 0)`;
          }
        };
        if (flights.length > 0) {
          animateFlights();
          stopFlights = startVisibleAnimation(animateFlights);
        }
      })().catch(() => {
        if (!disposed) setError("Не удалось загрузить самолёты. Карта доступна.");
      });
      applyCamera();
      readyTimer = window.setTimeout(() => requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (disposed) return;
          host.dataset.countryFirstFrameMs = (performance.now() - mountedAtRef.current).toFixed(1);
          setRenderReady(true);
        });
      }), 0);
    })().catch((reason) => {
      if (!disposed) setError(reason instanceof Error ? reason.message : "Не удалось запустить карту страны");
    });

    const observer = new ResizeObserver(scheduleCamera);
    observer.observe(host);
    const onWheel = (event: WheelEvent) => {
      // The directory scrolls locally; wheel/pinch over controls must never
      // change the geographic camera or trigger a parent-level transition.
      if (event.target instanceof Element && event.target.closest("[data-country-control]")) return;
      event.preventDefault();
      const next = continuousAtlasZoom(targetCamera.zoom, event.deltaY, { min: MIN_ZOOM, max: MAX_ZOOM });
      const rect = host.getBoundingClientRect();
      const width = host.clientWidth;
      const height = host.clientHeight;
      const screenX = (event.clientX - rect.left) / Math.max(1, rect.width) * width;
      const screenY = (event.clientY - rect.top) / Math.max(1, rect.height) * height;
      const worldX = (screenX - sceneX) / Math.max(.001, sceneScale);
      const worldY = (screenY - sceneY) / Math.max(.001, sceneScale);
      const focus = { x: screenX / Math.max(1, width), y: screenY / Math.max(1, height) };
      const cityRect = (city: CountryOverviewCityDto) => ({
        minX: city.atlasCenter.x - (city.miniature.columns * cityUnit(city) / 2 + 8) / sceneScale,
        minY: city.atlasCenter.y - (city.miniature.rows * cityUnit(city) / 2 + 8) / sceneScale,
        maxX: city.atlasCenter.x + (city.miniature.columns * cityUnit(city) / 2 + 8) / sceneScale,
        maxY: city.atlasCenter.y + (city.miniature.rows * cityUnit(city) / 2 + 8) / sceneScale,
      });
      const city = event.deltaY < 0 && next === MAX_ZOOM
        ? atlasHitTarget({ x: worldX, y: worldY }, orderedCities, candidate => [cityRect(candidate)]) : undefined;
      const leave = event.deltaY > 0 && next === MIN_ZOOM;
      if (wheelNavigation.consume({ at: event.timeStamp, deltaY: event.deltaY }, leave || Boolean(city))) {
        if (leave) onZoomOutRef.current(focus);
        else if (city) {
          const bounds = cityRect(city);
          onCitySelectRef.current(city, focus, mapAtlasFocusPoint({ x: worldX, y: worldY }, { ...bounds, maxX: bounds.maxX - 1, maxY: bounds.maxY - 1 }, city.sourceBounds));
        }
        return;
      }
      const worldWidth = overview.bounds.maxX - overview.bounds.minX;
      const worldHeight = overview.bounds.maxY - overview.bounds.minY;
      const nextScale = Math.min(width / worldWidth, height / worldHeight) * next;
      targetCamera.zoom = next;
      targetCamera.centerX = worldX + (width / 2 - screenX) / nextScale;
      targetCamera.centerY = worldY + (height / 2 - screenY) / nextScale;
      // Match drag's center bounds; fitting the entire country must not reset a pan.
      targetCamera.centerX = Math.max(overview.bounds.minX, Math.min(overview.bounds.maxX, targetCamera.centerX));
      targetCamera.centerY = Math.max(overview.bounds.minY, Math.min(overview.bounds.maxY, targetCamera.centerY));
      scheduleZoom();
    };
    const disposeGestures = bindMapPointerGestures(host, (gesture) => {
      if (zoomFrame) cancelAnimationFrame(zoomFrame);
      zoomFrame = 0;
      const rect = host.getBoundingClientRect();
      const screenX = gesture.center.x - rect.left;
      const screenY = gesture.center.y - rect.top;
      const previousScreenX = screenX - gesture.panX;
      const previousScreenY = screenY - gesture.panY;
      const worldX = (previousScreenX - sceneX) / Math.max(.001, sceneScale);
      const worldY = (previousScreenY - sceneY) / Math.max(.001, sceneScale);
      const worldWidth = overview.bounds.maxX - overview.bounds.minX;
      const worldHeight = overview.bounds.maxY - overview.bounds.minY;
      camera.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, camera.zoom * gesture.scale));
      const scale = Math.min(host.clientWidth / worldWidth, host.clientHeight / worldHeight) * camera.zoom;
      camera.centerX = worldX + (host.clientWidth / 2 - screenX) / scale;
      camera.centerY = worldY + (host.clientHeight / 2 - screenY) / scale;
      targetCamera.zoom = camera.zoom;
      targetCamera.centerX = camera.centerX;
      targetCamera.centerY = camera.centerY;
      scheduleCamera();
    }, { shouldStart: (event) => !(event.target instanceof Element && event.target.closest(".country-overview-city, [data-country-control]")) });
    host.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      disposed = true;
      imageController.abort();
      scheduleLabelsRef.current = null;
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      if (zoomFrame) cancelAnimationFrame(zoomFrame);
      stopFlights?.();
      stopTrains?.();
      stopShips?.();
      for(const ship of ships)ship.view.remove();
      for(const train of trains)train.view.remove();
      if (readyTimer) clearTimeout(readyTimer);
      host.removeEventListener("wheel", onWheel);
      disposeGestures();
      for (const flight of flights) flight.view.remove();
      rasterCanvas?.remove();
      railwayCanvas.remove();
      for (const glyph of cityGlyphs) glyph.canvas.remove();
      host.style.backgroundImage = "";
      host.style.backgroundSize = "";
      host.style.backgroundPosition = "";
    };
  }, [countryId, initialFocusCityId, renderOverview, wheelNavigation, attempt]);

  if (error && !overview) return <div className="atlas-state" role="alert"><strong>Карта страны недоступна</strong><span>{error}</span><button type="button" onClick={retry}>Повторить загрузку карты</button></div>;
  if (!overview) return <div className="atlas-state" role="status"><i /><span>Загружаем города страны…</span></div>;

  const dense = overview.cities.length > COUNTRY_FULL_LABEL_LIMIT;
  const listedCities = directoryOpen ? overview.cities.filter(city => city.name.toLocaleLowerCase().includes(cityQuery.trim().toLocaleLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name, "ru", { numeric: true }) || a.id.localeCompare(b.id)) : [];
  const closeDirectory = () => { setDirectoryOpen(false); onCityHover(null); directoryToggleRef.current?.focus(); };

  return <div
    ref={hostRef}
    className="country-overview"
    data-country-id={countryId}
    data-country-overview-cities={overview.cities.length}
    data-country-renderer="raster-dom"
    data-country-label-mode={dense ? "dense" : "full"}
    data-country-grid-topology={overview.geography.topology}
    data-country-terrain-cells={overview.geography.terrainCodes.length}
    data-country-miniature-cells={overview.cities.reduce((total, city) => total + city.miniature.blocks.length, 0)}
    data-country-airports={overview.cities.reduce((count, city) => count + city.miniature.airports.length, 0)}
    data-country-flights={overview.connections.filter(connection => (connection.fromPoint || overview.cities.some(city => city.id === connection.fromCityId && city.miniature.airports.length > 0))
      && (connection.toPoint || overview.cities.some(city => city.id === connection.toCityId && city.miniature.airports.length > 0))).slice(0, 5).length}
    data-country-ready={renderReady ? "true" : "false"}
    role="group"
    aria-label={`Карта страны: ${overview.cities.length} городов`}
  >
    {dense && <div className="country-map-gesture-surface" aria-hidden="true" />}
    {dense && <>
      <button ref={directoryToggleRef} type="button" className="country-city-directory-toggle" data-country-control
        aria-expanded={directoryOpen} aria-controls={`country-cities-${countryId}`} aria-haspopup="dialog"
        onClick={() => { setCityQuery(""); setDirectoryOpen(open => !open); }}>Города · {overview.cities.length}</button>
      {directoryOpen && <div ref={directoryRef} id={`country-cities-${countryId}`} className="country-city-directory" data-country-control
        role="dialog" aria-label="Города страны" onKeyDown={event => {
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeDirectory(); }
        }}>
        <div className="country-city-directory-head"><strong>Города страны · {overview.cities.length}</strong>
          <button type="button" aria-label="Закрыть список городов" onClick={closeDirectory}>×</button></div>
        <label>Найти город<input ref={directorySearchRef} type="search" value={cityQuery} onChange={event => setCityQuery(event.target.value)} /></label>
        <div className="country-city-directory-results" aria-label="Список городов">
          {listedCities.map(city => <button key={city.id} type="button" data-directory-city-id={city.id}
            aria-current={city.id === activeCityId ? "true" : undefined}
            aria-label={`Открыть город ${city.name}, прогресс ${city.progress}%`}
            onFocus={() => onCityHover(city)} onBlur={() => onCityHover(null)} onPointerEnter={() => onCityHover(city)} onPointerLeave={() => onCityHover(null)}
            onClick={() => { setDirectoryOpen(false); onCityHover(null); onCitySelect(city); }}>
            <strong>{city.name}</strong><span>{city.districts.length} районов · {city.progress}%</span>
          </button>)}
          {listedCities.length === 0 && <p role="status">Город не найден</p>}
        </div>
      </div>}
    </>}
    <div ref={labelsRef} className="country-overview-labels">
      {overview.cities.map((city) => <div key={city.id} style={{ display: "contents" }}><span className="country-city-leader" data-leader-city={city.id} aria-hidden="true" /><button
        type="button"
        className="country-overview-city"
        data-city-id={city.id}
        data-active={city.id === activeCityId ? "true" : "false"}
        aria-label={`Открыть город ${city.name}, прогресс ${city.progress}%`}
        onPointerEnter={() => onCityHover(city)}
        onPointerLeave={() => onCityHover(null)}
        onClick={() => onCitySelect(city)}
      >
        <strong>{city.districts.some(d => d.status === "ACTIVE" && d.taskCount > 0 && d.progress < 100)
          && <img className="city-development-icon" src={PROP_SPRITES["district-development-active"]} alt="" title="Район развивается" />}{city.name}</strong>
        <span>{city.districts.length} районов · {city.progress}%</span>
      </button></div>)}
    </div>
    {!renderReady && !error && <div className="atlas-state country-overview-loader" role="status"><i /><span>Готовим карту страны…</span></div>}
    {error && <div className="country-overview-warning" data-country-control role="status">{error} <button type="button" onClick={retry}>Повторить загрузку карты</button></div>}
  </div>;
}
