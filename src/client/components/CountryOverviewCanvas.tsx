import { Application, Assets, Container, Graphics, Sprite } from "pixi.js";
import "pixi.js/unsafe-eval";
import { useEffect, useRef, useState } from "react";
import type { RealtimeEvent } from "../../shared/contracts";
import { decodeCountryTerrain, type CountryOverviewCityDto, type CountryOverviewDto, type CountryOverviewTerrainKind } from "../../shared/country-overview-contract";
import { countryOverviewEventBatchImpact } from "../../shared/country-overview-events";
import { gameAssetUrl } from "../../shared/catalog";
import { ATLAS_AIRPORT_POLYGON } from "../../shared/atlas-airport";
import { api } from "../api";
import { smoothCameraScale } from "../world-camera";

const MIN_ZOOM = 1;
const MAX_ZOOM = 2.6;
const CITY_LOD_CELL_SIZE = .36;

type Camera = { zoom: number; centerX: number; centerY: number };
type Flight = { view: Sprite; baseScaleX: number; baseScaleY: number; elapsed: number; duration: number; delay: number; from: { x: number; y: number }; control: { x: number; y: number }; to: { x: number; y: number } };

function colorNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value.replace(/^#/, ""), 16);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function drawAirport(graphics: Graphics, x: number, y: number): void {
  const glyphScale = .24;
  graphics.rect(x - .95, y - .95, 1.9, 1.9).fill(0x102427).stroke({ color: 0xe5cf72, width: .2 });
  graphics.poly(ATLAS_AIRPORT_POLYGON.map((coordinate, index) => coordinate * glyphScale + (index % 2 === 0 ? x : y - .18))).fill(0xf2eee0);
}

function terrainColor(kind: CountryOverviewTerrainKind, seed: number, x: number, y: number): number {
  const value = (seed ^ Math.imul(x + 17, 73_856_093) ^ Math.imul(y + 31, 19_349_663)) >>> 0;
  switch (kind) {
    case "deep_water": return value % 3 === 0 ? 0x1f678c : 0x205f82;
    case "shallow_water": return value % 3 === 0 ? 0x2f8da8 : 0x2a829f;
    case "coast": return value % 3 === 0 ? 0xcfb879 : 0xc4aa6c;
    case "forest": return value % 3 === 0 ? 0x2b5f3c : 0x315f43;
    case "hill": return value % 3 === 0 ? 0x6d8a4d : 0x789852;
    case "mountain": return value % 3 === 0 ? 0x667574 : 0x75817c;
    case "stone": return value % 3 === 0 ? 0x858b82 : 0x747e79;
    case "river": return value % 3 === 0 ? 0x2b7192 : 0x317f9e;
    case "meadow": return value % 3 === 0 ? 0x83a457 : 0x789852;
    case "unknown": return value % 3 === 0 ? 0x17353c : 0x142e35;
    default: return value % 3 === 0 ? 0x789852 : 0x71904d;
  }
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
    let lastZoomFrame = 0;
    let dragging: { x: number; y: number; centerX: number; centerY: number } | null = null;
    const entryCity = overview.cities.find((city) => city.id === initialFocusCityId);
    const camera: Camera = {
      zoom: entryCity ? 1.65 : 1,
      centerX: entryCity?.atlasCenter.x ?? (overview.bounds.minX + overview.bounds.maxX) / 2,
      centerY: entryCity?.atlasCenter.y ?? (overview.bounds.minY + overview.bounds.maxY) / 2,
    };
    const targetCamera: Camera = { ...camera };
    const app = new Application();
    const scene = new Container();
    const flights: Flight[] = [];
    const orderedCities = [...overview.cities].sort((left, right) => left.atlasCenter.y - right.atlasCenter.y || left.atlasCenter.x - right.atlasCenter.x);
    let labelMetrics: Array<{ city: CountryOverviewCityDto; label: HTMLElement; width: number; height: number }> | null = null;

    const applyCamera = () => {
      frame = 0;
      if (disposed || !app.renderer) return;
      const width = app.renderer.width / app.renderer.resolution;
      const height = app.renderer.height / app.renderer.resolution;
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
      scene.scale.set(scale);
      scene.position.set(width / 2 - camera.centerX * scale, height / 2 - camera.centerY * scale);
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
        const anchorX = scene.position.x + city.atlasCenter.x * scale;
        const anchorY = scene.position.y + city.atlasCenter.y * scale;
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
      await app.init({ resizeTo: host, backgroundColor: 0x205f82, antialias: false, autoDensity: true, resolution: Math.min(devicePixelRatio, 2), preference: "webgl" });
      if (disposed) { app.destroy({ removeView: true }, { children: true }); return; }
      app.canvas.className = "country-overview-canvas";
      app.canvas.setAttribute("aria-hidden", "true");
      host.prepend(app.canvas);
      app.stage.addChild(scene);

      const terrain = new Graphics();
      terrain.roundPixels = true;
      const { columns, rows, cellSize, terrainCodes, territoryCodes } = overview.geography;
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
          terrain.rect(x, y, cellSize, cellSize).fill(terrainColor(kind, overview.terrainSeed, column, row));
          if (territory === "1") {
            selectedCellCount += 1;
            terrain.rect(x, y, cellSize, cellSize).fill({ color: 0xc6d984, alpha: .07 });
          } else if (territory === "2") {
            neighborCellCount += 1;
            terrain.rect(x, y, cellSize, cellSize).fill({ color: 0x31515a, alpha: .14 });
          }
          if (kind === "deep_water" || kind === "shallow_water") waterCellCount += 1;
          else if (kind === "unknown") unknownCellCount += 1;
          const detail = (overview.terrainSeed ^ Math.imul(column + 11, 73856093) ^ Math.imul(row + 19, 19349663)) >>> 0;
          if (kind === "forest" && detail % 3 !== 0) terrain.rect(x + 1, y + 1, 2, 2).fill(0x214d34);
          else if (kind === "mountain") terrain.poly([x, y + 4, x + 2, y, x + 4, y + 4]).fill(0x475456).poly([x + 2, y, x + 3, y + 2, x + 1, y + 2]).fill(0xc2c8bd);
          else if (kind === "stone" && detail % 2 === 0) terrain.rect(x + 1, y + 1, 2, 1).fill(0xa0a59a);
          else if (kind === "hill") terrain.moveTo(x, y + 3).lineTo(x + 2, y + 1).lineTo(x + 4, y + 3).stroke({ color: 0x56743f, width: .5 });
          else if (kind === "river") terrain.rect(x + (detail % 2 ? 1 : 2), y, 1, 4).fill(0x49a2b9);
        }
      }
      scene.addChild(terrain);
      host.dataset.countryTerrainRender = "graphics";
      host.dataset.countrySelectedCells = String(selectedCellCount);
      host.dataset.countryNeighborCells = String(neighborCellCount);
      host.dataset.countryWaterCells = String(waterCellCount);
      host.dataset.countryUnknownCells = String(unknownCellCount);

      const cityById = new Map(overview.cities.map((city) => [city.id, city]));
      const cities = new Graphics();
      cities.roundPixels = true;
      for (const city of overview.cities) {
        const { columns: miniatureColumns, rows: miniatureRows, districtCodes, coverageCodes, shapeCodes, terrainCodes: cityTerrainCodes, airportCell } = city.miniature;
        const left = city.atlasCenter.x - miniatureColumns * CITY_LOD_CELL_SIZE / 2;
        const top = city.atlasCenter.y - miniatureRows * CITY_LOD_CELL_SIZE / 2;
        for (let index = 0; index < districtCodes.length; index += 1) {
          const districtCode = Number.parseInt(districtCodes[index] ?? "0", 16);
          const coverage = Number.parseInt(coverageCodes[index] ?? "0", 16);
          const shape = Number.parseInt(shapeCodes[index] ?? "0", 16);
          if (!districtCode || !coverage) continue;
          const x = left + index % miniatureColumns * CITY_LOD_CELL_SIZE;
          const y = top + Math.floor(index / miniatureColumns) * CITY_LOD_CELL_SIZE;
          const district = city.districts[(districtCode - 1) % Math.max(1, city.districts.length)];
          const base = terrainColor(decodeCountryTerrain(cityTerrainCodes[index] ?? "0"), overview.terrainSeed, index % miniatureColumns, Math.floor(index / miniatureColumns));
          for (let quadrant = 0; quadrant < 4; quadrant += 1) if (shape & 1 << quadrant) {
            cities.rect(
              x + quadrant % 2 * CITY_LOD_CELL_SIZE / 2,
              y + Math.floor(quadrant / 2) * CITY_LOD_CELL_SIZE / 2,
              CITY_LOD_CELL_SIZE / 2,
              CITY_LOD_CELL_SIZE / 2,
            ).fill(base);
          }
          if (city.id === activeCityId) cities.rect(x, y, CITY_LOD_CELL_SIZE, CITY_LOD_CELL_SIZE)
            .stroke({ color: 0xf0cf56, width: .06, alpha: .7 });
          const detail = (overview.terrainSeed ^ Math.imul(index + 3, 2_654_435_761) ^ city.id.length) >>> 0;
          const roofFrequency = Math.max(2, 7 - Math.min(5, district?.taskCount ?? 0));
          if (coverage >= 8 && detail % roofFrequency === 0) cities.rect(
            x + CITY_LOD_CELL_SIZE * .2, y + CITY_LOD_CELL_SIZE * .15,
            CITY_LOD_CELL_SIZE * .6, CITY_LOD_CELL_SIZE * .45,
          ).fill(city.id === activeCityId ? 0xf0cf56 : colorNumber(district?.color, 0xd5c08a));
          else if (coverage >= 5 && detail % 3 === 0) cities.rect(
            x + CITY_LOD_CELL_SIZE * .25, y + CITY_LOD_CELL_SIZE * .25,
            CITY_LOD_CELL_SIZE * .5, CITY_LOD_CELL_SIZE * .5,
          ).fill(0x52666a);
        }
        drawAirport(
          cities,
          left + (airportCell.x + .5) * CITY_LOD_CELL_SIZE,
          top + (airportCell.y + .5) * CITY_LOD_CELL_SIZE,
        );
      }
      scene.addChild(cities);
      host.dataset.countryCityRender = "semantic-graphics";

      const routeInputs = overview.connections.slice(0, 5).flatMap((connection, index) => {
        const from = cityById.get(connection.fromCityId)?.atlasCenter;
        const to = cityById.get(connection.toCityId)?.atlasCenter;
        return from && to ? [{ from, to, index }] : [];
      });
      if (routeInputs.length === 0 && overview.cities[0]) routeInputs.push({
        from: { x: -8, y: Math.max(8, overview.cities[0].atlasCenter.y - 12) },
        to: overview.cities[0].atlasCenter,
        index: 0,
      });
      const planeTextures = await Promise.all(routeInputs.map((route) => Assets.load(gameAssetUrl(`atlas/aircraft-v4/airplane-topdown-${route.index % 8 + 1}.png`))));
      const aircraftLayer = new Container();
      for (let index = 0; index < routeInputs.length; index += 1) {
        const route = routeInputs[index]!;
        const texture = planeTextures[index]!;
        texture.source.scaleMode = "nearest";
        const view = new Sprite(texture);
        view.anchor.set(.5);
        view.width = 2.6;
        view.height = 1.75;
        const baseScaleX = view.scale.x;
        const baseScaleY = view.scale.y;
        aircraftLayer.addChild(view);
        const dx = route.to.x - route.from.x;
        const dy = route.to.y - route.from.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const bend = (index % 2 === 0 ? 1 : -1) * Math.min(18, 5 + distance * .18);
        flights.push({
          view,
          baseScaleX,
          baseScaleY,
          elapsed: 0,
          duration: 9_000 + index * 1_700,
          delay: index * 1_250,
          from: route.from,
          control: { x: (route.from.x + route.to.x) / 2 - dy / distance * bend, y: (route.from.y + route.to.y) / 2 + dx / distance * bend },
          to: route.to,
        });
      }
      scene.addChild(aircraftLayer);
      app.ticker.add((ticker) => {
        if (disposed) return;
        for (const flight of flights) {
          flight.elapsed = (flight.elapsed + ticker.deltaMS) % (flight.duration + flight.delay);
          const progress = Math.max(0, flight.elapsed - flight.delay) / flight.duration;
          flight.view.visible = progress > 0 && progress <= 1;
          if (!flight.view.visible) continue;
          const inverse = 1 - progress;
          flight.view.position.set(
            inverse * inverse * flight.from.x + 2 * inverse * progress * flight.control.x + progress * progress * flight.to.x,
            inverse * inverse * flight.from.y + 2 * inverse * progress * flight.control.y + progress * progress * flight.to.y,
          );
          const tangentX = 2 * inverse * (flight.control.x - flight.from.x) + 2 * progress * (flight.to.x - flight.control.x);
          const tangentY = 2 * inverse * (flight.control.y - flight.from.y) + 2 * progress * (flight.to.y - flight.control.y);
          flight.view.rotation = Math.atan2(tangentY, tangentX) + Math.PI / 2;
          const endpointScale = Math.min(1, Math.max(.2, Math.min(progress, 1 - progress) / .12));
          flight.view.scale.set(flight.baseScaleX * endpointScale, flight.baseScaleY * endpointScale);
        }
      });
      applyCamera();
      requestAnimationFrame(() => {
        if (disposed) return;
        host.dataset.countryFirstFrameMs = (performance.now() - mountedAtRef.current).toFixed(1);
        setRenderReady(true);
      });
    })().catch((reason) => {
      if (!disposed) setError(reason instanceof Error ? reason.message : "Не удалось запустить GPU-карту страны");
    });

    const observer = new ResizeObserver(scheduleCamera);
    observer.observe(host);
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, targetCamera.zoom * Math.exp(-event.deltaY * .0015)));
      if (next === MIN_ZOOM && targetCamera.zoom === MIN_ZOOM && camera.zoom <= MIN_ZOOM + .001 && event.deltaY > 0) { onZoomOut(); return; }
      if (!app.renderer) return;
      const rect = host.getBoundingClientRect();
      const width = app.renderer.width / app.renderer.resolution;
      const height = app.renderer.height / app.renderer.resolution;
      const screenX = (event.clientX - rect.left) / Math.max(1, rect.width) * width;
      const screenY = (event.clientY - rect.top) / Math.max(1, rect.height) * height;
      const worldX = (screenX - scene.position.x) / Math.max(.001, scene.scale.x);
      const worldY = (screenY - scene.position.y) / Math.max(.001, scene.scale.y);
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
      if (!dragging || !app.renderer) return;
      const worldWidth = overview.bounds.maxX - overview.bounds.minX;
      const worldHeight = overview.bounds.maxY - overview.bounds.minY;
      const scale = Math.min((app.renderer.width / app.renderer.resolution) / worldWidth, (app.renderer.height / app.renderer.resolution) / worldHeight) * camera.zoom;
      camera.centerX = dragging.centerX - (event.clientX - dragging.x) / scale;
      camera.centerY = dragging.centerY - (event.clientY - dragging.y) / scale;
      targetCamera.centerX = camera.centerX;
      targetCamera.centerY = camera.centerY;
      scheduleCamera();
    };
    const endDrag = () => { dragging = null; };
    host.addEventListener("wheel", onWheel, { passive: false });
    host.addEventListener("pointerdown", onPointerDown);
    host.addEventListener("pointermove", onPointerMove);
    host.addEventListener("pointerup", endDrag);
    host.addEventListener("pointercancel", endDrag);
    return () => {
      disposed = true;
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      if (zoomFrame) cancelAnimationFrame(zoomFrame);
      host.removeEventListener("wheel", onWheel);
      host.removeEventListener("pointerdown", onPointerDown);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerup", endDrag);
      host.removeEventListener("pointercancel", endDrag);
      try { app.destroy({ removeView: true }, { children: true }); } catch { /* Partial WebGL startup. */ }
    };
  }, [activeCityId, initialFocusCityId, onZoomOut, overview]);

  if (error && !overview) return <div className="atlas-state" role="alert"><strong>Карта страны недоступна</strong><span>{error}</span></div>;
  if (!overview) return <div className="atlas-state" role="status"><i /><span>Загружаем города страны…</span></div>;

  return <div
    ref={hostRef}
    className="country-overview"
    data-country-id={countryId}
    data-country-overview-cities={overview.cities.length}
    data-country-renderer="pixi"
    data-country-grid-topology={overview.geography.topology}
    data-country-terrain-cells={overview.geography.terrainCodes.length}
    data-country-miniature-cells={overview.cities.reduce((total, city) => total + city.miniature.districtCodes.length, 0)}
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
