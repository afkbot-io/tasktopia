import { useEffect, useRef, useState } from "react";
import type { RealtimeEvent } from "../../shared/contracts";
import { COUNTRY_OVERVIEW_SCHEMA_VERSION, decodeCountryTerrain, type CountryOverviewCityDto, type CountryOverviewDto } from "../../shared/country-overview-contract";
import { gameAssetUrl, getBuilding } from "../../shared/catalog";
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
type Flight = { view: HTMLImageElement; elapsed: number; duration: number; delay: number; route: AtlasFlightGeometry; startsAtAirport: boolean };

async function loadAtlasImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  await image.decode();
  return image;
}

export function CountryOverviewCanvas({ countryId, worldRevision, activeCityId, initialFocusCityId, events, onEventsProcessed, onCitySelect, onCityHover, onZoomOut, wheelNavigation }: {
  countryId: string;
  worldRevision: number;
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
  const [error, setError] = useState("");
  const [renderReady, setRenderReady] = useState(false);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [cityQuery, setCityQuery] = useState("");
  const hostRef = useRef<HTMLDivElement>(null);
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
  }, [activeCityId]);

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
    if (cached) setOverview(cached);
    setError("");
    void countrySceneCache.read(cacheKey, ()=>api<CountryOverviewDto>(`/api/countries/${countryId}/overview`, {
      headers: { accept: `application/vnd.tasktopia.country-overview+json; version=${COUNTRY_OVERVIEW_SCHEMA_VERSION}` },
    }))
      .then((next) => {
        if (controller.signal.aborted) return;
        if (next.schemaVersion !== COUNTRY_OVERVIEW_SCHEMA_VERSION || next.countryId !== countryId) throw new Error("Сервер вернул карту другой страны");
        setOverview(next);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Не удалось загрузить страну");
      });
    return () => controller.abort();
  }, [countryId, cacheKey]);

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
    const host = hostRef.current;
    const labels = labelsRef.current;
    if (!host || !labels || !overview) return;
    setRenderReady(false);
    let disposed = false;
    let frame = 0;
    let zoomFrame = 0;
    let flightFrame = 0;
    let lastZoomFrame = 0;
    let readyTimer = 0;
    let maxCameraFrameMs = 0;
    let rasterCanvas: HTMLCanvasElement | null = null;
    const entryCity = overview.cities.find((city) => city.id === initialFocusCityId);
    const camera: Camera = {
      zoom: entryCity ? 1.1 : .72,
      centerX: entryCity?.atlasCenter.x ?? (overview.bounds.minX + overview.bounds.maxX) / 2,
      centerY: entryCity?.atlasCenter.y ?? (overview.bounds.minY + overview.bounds.maxY) / 2,
    };
    const targetCamera: Camera = { ...camera };
    const flights: Flight[] = [];
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
      const halfVisibleWidth = width / scale / 2;
      const halfVisibleHeight = height / scale / 2;
      camera.centerX = halfVisibleWidth * 2 >= worldWidth
        ? (overview.bounds.minX + overview.bounds.maxX) / 2
        : Math.max(overview.bounds.minX + halfVisibleWidth, Math.min(overview.bounds.maxX - halfVisibleWidth, camera.centerX));
      camera.centerY = halfVisibleHeight * 2 >= worldHeight
        ? (overview.bounds.minY + overview.bounds.maxY) / 2
        : Math.max(overview.bounds.minY + halfVisibleHeight, Math.min(overview.bounds.maxY - halfVisibleHeight, camera.centerY));
      sceneScale = scale;
      sceneX = width / 2 - camera.centerX * scale;
      sceneY = height / 2 - camera.centerY * scale;
      if (rasterCanvas) rasterCanvas.style.transform = `translate3d(${sceneX}px, ${sceneY}px, 0) scale(${scale})`;
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
        offset: Math.max(28, (city.miniature.rows * CITY_LOD_CELL_SIZE / 2 + 3) * scale),
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
    scheduleLabelsRef.current = scheduleCamera;
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
      if (groundRoadPlan.routes.length) for (const tile of Object.values(COUNTRY_ROAD_ATLAS_TILES)) assetUrls.add(gameAssetUrl(tile.url));
      for (const city of overview.cities) for (const block of city.miniature.blocks) assetUrls.add(getBuilding(block.family).stages[4]!);
      if (overview.cities.some(city => city.miniature.airports.length > 0)) assetUrls.add(getBuilding("compact-airport-v1").stages[4]!);
      const textures = new Map(await Promise.all([...assetUrls].map(async (url) => [url, await loadAtlasImage(url)] as const)));
      if (disposed) return;
      // Compose immutable atlas tiles on a small CPU canvas. At four pixels
      // per world unit every4-unit semantic cell remains16x16px. Its material
      // now has four finer tiles per axis; neither geography nor texture size
      // grows. Camera motion still moves just this one composited texture.
      const staticCanvas = document.createElement("canvas");
      staticCanvas.width = Math.round(columns * cellSize * rasterScale);
      staticCanvas.height = Math.round(rows * cellSize * rasterScale);
      const context = staticCanvas.getContext("2d", { alpha: false })!;
      context.imageSmoothingEnabled = false;
      staticCanvas.className = "country-overview-raster";
      staticCanvas.setAttribute("aria-hidden", "true");
      staticCanvas.style.width = `${columns * cellSize}px`;
      staticCanvas.style.height = `${rows * cellSize}px`;
      rasterCanvas = staticCanvas;
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
          for (const { x: dx, y: dy, size, tile } of terrainTiles[index]!) {
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
      host.dataset.countryMaterialSubdivisions = "4";
      host.dataset.countryMaterialPatches = String(terrainTiles.length * 16);
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

      const airportPoints = new Map<string, { x: number; y: number }>();
      for (const city of overview.cities) {
        const miniature = city.miniature;
        const left = city.atlasCenter.x - miniature.columns * CITY_LOD_CELL_SIZE / 2;
        const top = city.atlasCenter.y - miniature.rows * CITY_LOD_CELL_SIZE / 2;
        for (const block of miniature.blocks) {
          const entry = getBuilding(block.family);
          const source = textures.get(entry.stages[4]!)!;
          const width = 1.45 * rasterScale;
          const height = width * entry.spriteSize.height / entry.spriteSize.width;
          context.drawImage(source, Math.round((left + block.x * CITY_LOD_CELL_SIZE) * rasterScale - width / 2),
            Math.round((top + block.y * CITY_LOD_CELL_SIZE) * rasterScale - height / 2), Math.round(width), Math.round(height));
        }
        for (const airport of miniature.airports) {
          const airportPoint = { x: left + airport.x * CITY_LOD_CELL_SIZE, y: top + airport.y * CITY_LOD_CELL_SIZE };
          airportPoints.set(city.id, airportPoint);
          const entry = getBuilding("compact-airport-v1");
          const width = 1.6 * rasterScale;
          const height = width * entry.spriteSize.height / entry.spriteSize.width;
          context.drawImage(textures.get(entry.stages[4]!)!, Math.round(airportPoint.x * rasterScale - width / 2),
            Math.round(airportPoint.y * rasterScale - height / 2), Math.round(width), Math.round(height));
        }
      }
      if (disposed) return;
      host.prepend(staticCanvas);
      host.dataset.countryCityRender = "one-house-per-block";

      const routeInputs = overview.connections.slice(0, 5).flatMap((connection, index) => {
        const from = airportPoints.get(connection.fromCityId);
        const to = airportPoints.get(connection.toCityId);
        return from && to ? [{ from, to, index, startsAtAirport: true }] : [];
      });
      const planeTextures = await Promise.all(routeInputs.map(() => loadAtlasImage(microAmbientSprite("aircraft","regional","east").url)));
      if (disposed) return;
      for (let index = 0; index < routeInputs.length; index += 1) {
        const route = routeInputs[index]!;
        const view = planeTextures[index]!;
        view.className = "country-atlas-aircraft";
        view.setAttribute("aria-hidden", "true");
        view.style.width = "1.6px";
        view.style.height = "1.6px";
        host.append(view);
        flights.push({
          view,
          elapsed: 0,
          duration: 9_000 + index * 1_700,
          delay: index * 1_250,
          route: buildAtlasFlightGeometry(route.from, route.to, `country:${countryId}:${index}`, 18),
          startsAtAirport: route.startsAtAirport,
        });
      }
      let previousFlightFrame = performance.now();
      const animateFlights = (timestamp: number) => {
        if (disposed) return;
        const deltaMs = Math.min(64, timestamp - previousFlightFrame);
        previousFlightFrame = timestamp;
        for (const flight of flights) {
          flight.elapsed = (flight.elapsed + deltaMs) % (flight.duration + flight.delay);
          const progress = Math.max(0, flight.elapsed - flight.delay) / flight.duration;
          flight.view.hidden = !(progress > 0 && progress <= 1);
          if (flight.view.hidden) continue;
          const sample = sampleAtlasFlight(flight.route, progress);
          const endpointScale = atlasAircraftEndpointScale(progress, flight.startsAtAirport, true);
          const screenX = sceneX + sample.x * sceneScale;
          const screenY = sceneY + sample.y * sceneScale;
          flight.view.style.transform = `translate3d(${screenX}px, ${screenY}px, 0) translate(-50%, -50%) rotate(${sample.angle}rad) scale(${sceneScale * endpointScale})`;
        }
        flightFrame = requestAnimationFrame(animateFlights);
      };
      if (flights.length > 0) flightFrame = requestAnimationFrame(animateFlights);
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
        minX: city.atlasCenter.x - city.miniature.columns * CITY_LOD_CELL_SIZE / 2,
        minY: city.atlasCenter.y - city.miniature.rows * CITY_LOD_CELL_SIZE / 2,
        maxX: city.atlasCenter.x + city.miniature.columns * CITY_LOD_CELL_SIZE / 2,
        maxY: city.atlasCenter.y + city.miniature.rows * CITY_LOD_CELL_SIZE / 2,
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
      const halfVisibleWidth = width / nextScale / 2;
      const halfVisibleHeight = height / nextScale / 2;
      targetCamera.centerX = halfVisibleWidth * 2 >= worldWidth
        ? (overview.bounds.minX + overview.bounds.maxX) / 2
        : Math.max(overview.bounds.minX + halfVisibleWidth, Math.min(overview.bounds.maxX - halfVisibleWidth, targetCamera.centerX));
      targetCamera.centerY = halfVisibleHeight * 2 >= worldHeight
        ? (overview.bounds.minY + overview.bounds.maxY) / 2
        : Math.max(overview.bounds.minY + halfVisibleHeight, Math.min(overview.bounds.maxY - halfVisibleHeight, targetCamera.centerY));
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
      scheduleLabelsRef.current = null;
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      if (zoomFrame) cancelAnimationFrame(zoomFrame);
      if (flightFrame) cancelAnimationFrame(flightFrame);
      if (readyTimer) clearTimeout(readyTimer);
      host.removeEventListener("wheel", onWheel);
      disposeGestures();
      for (const flight of flights) flight.view.remove();
      rasterCanvas?.remove();
    };
  }, [countryId, initialFocusCityId, overview, wheelNavigation]);

  if (error && !overview) return <div className="atlas-state" role="alert"><strong>Карта страны недоступна</strong><span>{error}</span></div>;
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
    data-country-flights={overview.connections.slice(0, 5).filter(connection => overview.cities.some(city => city.id === connection.fromCityId && city.miniature.airports.length > 0)
      && overview.cities.some(city => city.id === connection.toCityId && city.miniature.airports.length > 0)).length}
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
        <strong>{city.name}</strong>
        <span>{city.districts.length} районов · {city.progress}%</span>
      </button></div>)}
    </div>
    {!renderReady && <div className="atlas-state country-overview-loader" role="status"><i /><span>Готовим карту страны…</span></div>}
    {error && <div className="country-overview-warning" role="status">{error}</div>}
  </div>;
}
