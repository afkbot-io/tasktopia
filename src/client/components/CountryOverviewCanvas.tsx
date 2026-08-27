import { useEffect, useRef, useState } from "react";
import type { RealtimeEvent } from "../../shared/contracts";
import { decodeCountryTerrain, type CountryOverviewCityDto, type CountryOverviewDto } from "../../shared/country-overview-contract";
import { countryOverviewEventBatchImpact } from "../../shared/country-overview-events";
import { gameAssetUrl, TILE_SPRITES } from "../../shared/catalog";
import { ATLAS_AIRPORT_POLYGON } from "../../shared/atlas-airport";
import { atlasAircraftEndpointScale, atlasTerrainAsset, buildAtlasFlightGeometry, sampleAtlasFlight, type AtlasFlightGeometry } from "../../shared/atlas-scene";
import { api } from "../api";
import { smoothCameraScale } from "../world-camera";

const MIN_ZOOM = .55;
const MAX_ZOOM = 2.6;
// A 16x16 source block replaces four former 8x8 blocks. Doubling its world
// size preserves the city's geographic footprint while cutting draw count 4x.
const CITY_LOD_CELL_SIZE = .72;

type Camera = { zoom: number; centerX: number; centerY: number };
type Flight = { view: HTMLImageElement; elapsed: number; duration: number; delay: number; route: AtlasFlightGeometry; startsAtAirport: boolean };

function drawAirport(context: CanvasRenderingContext2D, x: number, y: number, scale: number): void {
  const glyphScale = .24;
  context.fillStyle = "#102427";
  context.strokeStyle = "#e5cf72";
  context.lineWidth = Math.max(1, .2 * scale);
  context.fillRect((x - .95) * scale, (y - .95) * scale, 1.9 * scale, 1.9 * scale);
  context.strokeRect((x - .95) * scale, (y - .95) * scale, 1.9 * scale, 1.9 * scale);
  context.beginPath();
  for (let index = 0; index < ATLAS_AIRPORT_POLYGON.length; index += 2) {
    const pointX = (x + ATLAS_AIRPORT_POLYGON[index]! * glyphScale) * scale;
    const pointY = (y - .18 + ATLAS_AIRPORT_POLYGON[index + 1]! * glyphScale) * scale;
    if (index === 0) context.moveTo(pointX, pointY); else context.lineTo(pointX, pointY);
  }
  context.closePath();
  context.fillStyle = "#f2eee0";
  context.fill();
}

async function loadAtlasImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  await image.decode();
  return image;
}

export function CountryOverviewCanvas({ countryId, activeCityId, initialFocusCityId, events, onEventsProcessed, onCitySelect, onCityHover, onZoomOut }: {
  countryId: string;
  activeCityId?: string;
  initialFocusCityId?: string;
  events: RealtimeEvent[];
  onEventsProcessed: (eventId: number) => void;
  onCitySelect: (city: CountryOverviewCityDto, focus?: { x: number; y: number }, sourcePoint?: { x: number; y: number }) => void;
  onCityHover: (city: CountryOverviewCityDto | null) => void;
  onZoomOut: () => void;
}) {
  const [overview, setOverview] = useState<CountryOverviewDto | null>(null);
  const [error, setError] = useState("");
  const [renderReady, setRenderReady] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const processedEventIdRef = useRef(0);
  const mountedAtRef = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    mountedAtRef.current = performance.now();
    setOverview(null);
    setRenderReady(false);
    setError("");
    void api<CountryOverviewDto>(`/api/countries/${countryId}/overview`, {
      signal: controller.signal,
      headers: { accept: "application/vnd.tasktopia.country-overview+json; version=4" },
    })
      .then((next) => {
        if (next.schemaVersion !== 4 || next.countryId !== countryId) throw new Error("Сервер вернул карту другой страны");
        setOverview(next);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Не удалось загрузить страну");
      });
    return () => controller.abort();
  }, [countryId]);

  useEffect(() => {
    if (!overview) return;
    const pending = events
      .filter((event) => event.countryId === countryId && event.id > processedEventIdRef.current)
      .sort((left, right) => left.id - right.id);
    if (pending.length === 0) return;
    const latestId = pending.at(-1)!.id;
    if (countryOverviewEventBatchImpact(pending) === "NONE") {
      processedEventIdRef.current = latestId;
      onEventsProcessed(latestId);
      return;
    }
    const controller = new AbortController();
    void api<CountryOverviewDto>(`/api/countries/${countryId}/overview`, {
      signal: controller.signal,
      cache: "reload",
      headers: { accept: "application/vnd.tasktopia.country-overview+json; version=4" },
    })
      .then((next) => {
        if (next.schemaVersion !== 4 || next.countryId !== countryId) throw new Error("Сервер вернул карту другой страны");
        setOverview(next);
        processedEventIdRef.current = latestId;
        onEventsProcessed(latestId);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Не удалось обновить страну");
      });
    return () => controller.abort();
  }, [countryId, events, onEventsProcessed, overview]);

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
    let dragging: { x: number; y: number; centerX: number; centerY: number } | null = null;
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
    let labelMetrics: Array<{ city: CountryOverviewCityDto; label: HTMLElement; width: number; height: number }> | null = null;

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
      const placedLabels: Array<{ minX: number; minY: number; maxX: number; maxY: number }> = [];
      // Read label geometry once and perform only compositor-friendly transform
      // writes during camera frames. Interleaving offset reads and style writes
      // forced a full document layout for every city on every wheel event.
      labelMetrics ??= orderedCities.flatMap((city) => {
        const label = labels.querySelector<HTMLElement>(`[data-city-id="${city.id}"]`);
        return label ? [{ city, label, width: Math.max(116, label.offsetWidth), height: Math.max(34, label.offsetHeight) }] : [];
      });
      for (const { city, label, width: labelWidth, height: labelHeight } of labelMetrics) {
        const labelOffset = Math.max(28, (city.miniature.rows * CITY_LOD_CELL_SIZE / 2 + 3) * scale);
        const anchorX = sceneX + city.atlasCenter.x * scale;
        const anchorY = sceneY + city.atlasCenter.y * scale;
        const candidates = [
          { x: anchorX, y: anchorY - labelOffset },
          { x: anchorX + labelWidth * .72, y: anchorY - labelHeight * .7 },
          { x: anchorX - labelWidth * .72, y: anchorY - labelHeight * .7 },
          { x: anchorX, y: anchorY + labelOffset },
        ].map((candidate) => ({
          x: Math.max(labelWidth / 2 + 4, Math.min(width - labelWidth / 2 - 4, candidate.x)),
          y: Math.max(labelHeight / 2 + 4, Math.min(height - labelHeight / 2 - 4, candidate.y)),
        }));
        const chosen = candidates.find((candidate) => {
          const bounds = { minX: candidate.x - labelWidth / 2 - 4, minY: candidate.y - labelHeight / 2 - 4, maxX: candidate.x + labelWidth / 2 + 4, maxY: candidate.y + labelHeight / 2 + 4 };
          return bounds.minX >= 4 && bounds.maxX <= width - 4 && bounds.minY >= 4 && bounds.maxY <= height - 4
            && !placedLabels.some((placed) => bounds.minX < placed.maxX && bounds.maxX > placed.minX && bounds.minY < placed.maxY && bounds.maxY > placed.minY);
        }) ?? candidates[0]!;
        placedLabels.push({ minX: chosen.x - labelWidth / 2 - 4, minY: chosen.y - labelHeight / 2 - 4, maxX: chosen.x + labelWidth / 2 + 4, maxY: chosen.y + labelHeight / 2 + 4 });
        label.style.transform = `translate3d(${chosen.x}px, ${chosen.y}px, 0) translate(-50%, -50%)`;
      }
      host.dataset.countryZoom = camera.zoom.toFixed(2);
      maxCameraFrameMs = Math.max(maxCameraFrameMs, performance.now() - startedAt);
      host.dataset.countryCameraFrameMaxMs = maxCameraFrameMs.toFixed(1);
    };
    const scheduleCamera = () => {
      if (!frame) frame = requestAnimationFrame(applyCamera);
    };
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
      const terrainAssets = Array.from({ length: terrainCodes.length }, (_, index) => atlasTerrainAsset(
        decodeCountryTerrain(terrainCodes[index] ?? "0"),
        index % columns,
        Math.floor(index / columns),
      ));
      const assetUrls = new Set(terrainAssets.map(gameAssetUrl));
      assetUrls.add(TILE_SPRITES.pavement!);
      const textures = new Map(await Promise.all([...assetUrls].map(async (url) => [url, await loadAtlasImage(url)] as const)));
      // Compose immutable atlas tiles on a small CPU canvas. At four pixels
      // per world unit every 4-unit terrain cell is exactly 16x16 pixels; the
      // WebGL scene then moves one texture instead of hundreds of textured
      // primitives, avoiding driver stalls during continuous zoom.
      const rasterScale = 4;
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
          const source = textures.get(gameAssetUrl(terrainAssets[index]!))!;
          context.drawImage(source, x * rasterScale, y * rasterScale, cellSize * rasterScale, cellSize * rasterScale);
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
      host.dataset.countryTerrainRender = "shared-pixel-tiles";
      host.dataset.countrySelectedCells = String(selectedCellCount);
      host.dataset.countryNeighborCells = String(neighborCellCount);
      host.dataset.countryWaterCells = String(waterCellCount);
      host.dataset.countryUnknownCells = String(unknownCellCount);

      const airportPoints = new Map<string, { x: number; y: number }>();
      for (const city of overview.cities) {
        const { columns: miniatureColumns, rows: miniatureRows, districtCodes, airportCell } = city.miniature;
        const left = city.atlasCenter.x - miniatureColumns * CITY_LOD_CELL_SIZE / 2;
        const top = city.atlasCenter.y - miniatureRows * CITY_LOD_CELL_SIZE / 2;
        for (let index = 0; index < districtCodes.length; index += 1) {
          const districtCode = Number.parseInt(districtCodes[index] ?? "0", 16);
          if (!districtCode) continue;
          const x = left + index % miniatureColumns * CITY_LOD_CELL_SIZE;
          const y = top + Math.floor(index / miniatureColumns) * CITY_LOD_CELL_SIZE;
          const pavement = textures.get(TILE_SPRITES.pavement!)!;
          context.drawImage(pavement, x * rasterScale, y * rasterScale, CITY_LOD_CELL_SIZE * rasterScale, CITY_LOD_CELL_SIZE * rasterScale);
        }
        const airportPoint = {
          x: left + (airportCell.x + .5) * CITY_LOD_CELL_SIZE,
          y: top + (airportCell.y + .5) * CITY_LOD_CELL_SIZE,
        };
        airportPoints.set(city.id, airportPoint);
        drawAirport(context, airportPoint.x, airportPoint.y, rasterScale);
      }
      host.prepend(staticCanvas);
      host.dataset.countryCityRender = "filled-16x16-atlas-tiles";

      const routeInputs = overview.connections.slice(0, 5).flatMap((connection, index) => {
        const from = airportPoints.get(connection.fromCityId);
        const to = airportPoints.get(connection.toCityId);
        return from && to ? [{ from, to, index, startsAtAirport: true }] : [];
      });
      if (routeInputs.length === 0 && overview.cities[0]) routeInputs.push({
        from: { x: -8, y: Math.max(8, overview.cities[0].atlasCenter.y - 12) },
        to: airportPoints.get(overview.cities[0].id) ?? overview.cities[0].atlasCenter,
        index: 0,
        startsAtAirport: false,
      });
      const planeTextures = await Promise.all(routeInputs.map((route) => loadAtlasImage(gameAssetUrl(`atlas/aircraft-v4/airplane-topdown-${route.index % 8 + 1}.png`))));
      for (let index = 0; index < routeInputs.length; index += 1) {
        const route = routeInputs[index]!;
        const view = planeTextures[index]!;
        view.className = "country-atlas-aircraft";
        view.setAttribute("aria-hidden", "true");
        view.style.width = "2.6px";
        view.style.height = "1.75px";
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
          flight.view.style.transform = `translate3d(${screenX}px, ${screenY}px, 0) translate(-50%, -50%) rotate(${sample.angle + Math.PI / 2}rad) scale(${sceneScale * endpointScale})`;
        }
        flightFrame = requestAnimationFrame(animateFlights);
      };
      flightFrame = requestAnimationFrame(animateFlights);
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
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, targetCamera.zoom * Math.exp(-event.deltaY * .0015)));
      if (next === MIN_ZOOM && targetCamera.zoom === MIN_ZOOM && camera.zoom <= MIN_ZOOM + .001 && event.deltaY > 0) { onZoomOut(); return; }
      const rect = host.getBoundingClientRect();
      const width = host.clientWidth;
      const height = host.clientHeight;
      const screenX = (event.clientX - rect.left) / Math.max(1, rect.width) * width;
      const screenY = (event.clientY - rect.top) / Math.max(1, rect.height) * height;
      const worldX = (screenX - sceneX) / Math.max(.001, sceneScale);
      const worldY = (screenY - sceneY) / Math.max(.001, sceneScale);
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
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".country-overview-city")) return;
      dragging = { x: event.clientX, y: event.clientY, centerX: camera.centerX, centerY: camera.centerY };
      targetCamera.zoom = camera.zoom;
      targetCamera.centerX = camera.centerX;
      targetCamera.centerY = camera.centerY;
      if (zoomFrame) cancelAnimationFrame(zoomFrame);
      zoomFrame = 0;
      host.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      const worldWidth = overview.bounds.maxX - overview.bounds.minX;
      const worldHeight = overview.bounds.maxY - overview.bounds.minY;
      const scale = Math.min(host.clientWidth / worldWidth, host.clientHeight / worldHeight) * camera.zoom;
      camera.centerX = dragging.centerX - (event.clientX - dragging.x) / scale;
      camera.centerY = dragging.centerY - (event.clientY - dragging.y) / scale;
      targetCamera.centerX = camera.centerX;
      targetCamera.centerY = camera.centerY;
      scheduleCamera();
    };
    const endDrag = () => { dragging = null; };
    // The atlas occupies a fixed, non-scrollable viewport. Keeping wheel
    // passive avoids Chrome's compositor wait while zoom remains RAF-driven.
    host.addEventListener("wheel", onWheel, { passive: true });
    host.addEventListener("pointerdown", onPointerDown);
    host.addEventListener("pointermove", onPointerMove);
    host.addEventListener("pointerup", endDrag);
    host.addEventListener("pointercancel", endDrag);
    return () => {
      disposed = true;
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      if (zoomFrame) cancelAnimationFrame(zoomFrame);
      if (flightFrame) cancelAnimationFrame(flightFrame);
      if (readyTimer) clearTimeout(readyTimer);
      host.removeEventListener("wheel", onWheel);
      host.removeEventListener("pointerdown", onPointerDown);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerup", endDrag);
      host.removeEventListener("pointercancel", endDrag);
      for (const flight of flights) flight.view.remove();
      rasterCanvas?.remove();
    };
  }, [countryId, initialFocusCityId, onZoomOut, overview]);

  if (error && !overview) return <div className="atlas-state" role="alert"><strong>Карта страны недоступна</strong><span>{error}</span></div>;
  if (!overview) return <div className="atlas-state" role="status"><i /><span>Загружаем города страны…</span></div>;

  return <div
    ref={hostRef}
    className="country-overview"
    data-country-id={countryId}
    data-country-overview-cities={overview.cities.length}
    data-country-renderer="raster-dom"
    data-country-grid-topology={overview.geography.topology}
    data-country-terrain-cells={overview.geography.terrainCodes.length}
    data-country-miniature-cells={overview.cities.reduce((total, city) => total + city.miniature.districtCodes.length, 0)}
    data-country-airports={overview.cities.length}
    data-country-flights={Math.max(1, Math.min(5, overview.connections.length))}
    data-country-ready={renderReady ? "true" : "false"}
    role="group"
    aria-label={`Карта страны: ${overview.cities.length} городов`}
  >
    <div ref={labelsRef} className="country-overview-labels">
      {overview.cities.map((city) => <button
        key={city.id}
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
      </button>)}
    </div>
    {!renderReady && <div className="atlas-state country-overview-loader" role="status"><i /><span>Готовим карту страны…</span></div>}
    {error && <div className="country-overview-warning" role="status">{error}</div>}
  </div>;
}
