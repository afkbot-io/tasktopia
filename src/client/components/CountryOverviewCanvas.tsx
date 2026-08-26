import { Application, Assets, Container, Graphics, Sprite } from "pixi.js";
import "pixi.js/unsafe-eval";
import { useEffect, useRef, useState } from "react";
import type { RealtimeEvent } from "../../shared/contracts";
import { decodeCountryTerrain, type CountryOverviewCityDto, type CountryOverviewDto, type CountryOverviewTerrainKind } from "../../shared/country-overview-contract";
import { countryAtlasEventBatchImpact } from "../../shared/country-atlas-events";
import { gameAssetUrl } from "../../shared/catalog";
import { ATLAS_AIRPORT_POLYGON } from "../../shared/atlas-airport";
import { api } from "../api";

const MIN_ZOOM = 1;
const MAX_ZOOM = 2.6;

type Camera = { zoom: number; centerX: number; centerY: number };
type Flight = { view: Sprite; baseScaleX: number; baseScaleY: number; elapsed: number; duration: number; delay: number; from: { x: number; y: number }; control: { x: number; y: number }; to: { x: number; y: number } };

function colorNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value.replace(/^#/, ""), 16);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function drawAirport(graphics: Graphics, x: number, y: number): void {
  const glyphScale = .36;
  graphics.rect(x - 1.35, y - 1.35, 2.7, 2.7).fill(0x102427).stroke({ color: 0xe5cf72, width: .28 });
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
    void api<CountryOverviewDto>(`/api/countries/${countryId}/overview`, { signal: controller.signal })
      .then((next) => {
        if (next.schemaVersion !== 3 || next.countryId !== countryId) throw new Error("Сервер вернул карту другой страны");
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
    if (countryAtlasEventBatchImpact(pending) === "NONE") {
      processedEventIdRef.current = latestId;
      onEventsProcessed(latestId);
      return;
    }
    const controller = new AbortController();
    void api<CountryOverviewDto>(`/api/countries/${countryId}/overview`, { signal: controller.signal, cache: "reload" })
      .then((next) => {
        if (next.schemaVersion !== 3 || next.countryId !== countryId) throw new Error("Сервер вернул карту другой страны");
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
    let dragging: { x: number; y: number; centerX: number; centerY: number } | null = null;
    const entryCity = overview.cities.find((city) => city.id === initialFocusCityId);
    const camera: Camera = {
      zoom: entryCity ? 1.65 : 1,
      centerX: entryCity?.atlasCenter.x ?? (overview.bounds.minX + overview.bounds.maxX) / 2,
      centerY: entryCity?.atlasCenter.y ?? (overview.bounds.minY + overview.bounds.maxY) / 2,
    };
    const app = new Application();
    const scene = new Container();
    const flights: Flight[] = [];

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
      const orderedCities = [...overview.cities].sort((left, right) => left.atlasCenter.y - right.atlasCenter.y || left.atlasCenter.x - right.atlasCenter.x);
      for (const city of orderedCities) {
        const label = labels.querySelector<HTMLElement>(`[data-city-id="${city.id}"]`);
        if (!label) continue;
        const labelOffset = Math.max(28, (city.miniature.rows / 2 + 4) * scale);
        const anchorX = scene.position.x + city.atlasCenter.x * scale;
        const anchorY = scene.position.y + city.atlasCenter.y * scale;
        const labelWidth = Math.max(116, label.offsetWidth);
        const labelHeight = Math.max(34, label.offsetHeight);
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
      app.render();
    };
    const scheduleCamera = () => {
      if (!frame) frame = requestAnimationFrame(applyCamera);
    };

    void (async () => {
      await app.init({ resizeTo: host, backgroundColor: 0x205f82, antialias: false, autoDensity: true, resolution: Math.min(devicePixelRatio, 2), preference: "webgl" });
      if (disposed) { app.destroy({ removeView: true }, { children: true }); return; }
      app.canvas.className = "country-overview-canvas";
      app.canvas.setAttribute("aria-hidden", "true");
      host.prepend(app.canvas);
      app.stage.addChild(scene);

      const terrain = new Graphics();
      const { columns, rows, cellSize, terrainCodes } = overview.geography;
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const index = row * columns + column;
          const kind = decodeCountryTerrain(terrainCodes[index] ?? "0");
          const x = column * cellSize;
          const y = row * cellSize;
          terrain.rect(x, y, cellSize, cellSize).fill(terrainColor(kind, overview.terrainSeed, column, row));
          const detail = (overview.terrainSeed ^ Math.imul(column + 11, 73856093) ^ Math.imul(row + 19, 19349663)) >>> 0;
          if (kind === "forest" && detail % 3 !== 0) terrain.rect(x + 1, y + 1, 2, 2).fill(0x214d34);
          else if (kind === "mountain") terrain.poly([x, y + 4, x + 2, y, x + 4, y + 4]).fill(0x475456).poly([x + 2, y, x + 3, y + 2, x + 1, y + 2]).fill(0xc2c8bd);
          else if (kind === "stone" && detail % 2 === 0) terrain.rect(x + 1, y + 1, 2, 1).fill(0xa0a59a);
          else if (kind === "hill") terrain.moveTo(x, y + 3).lineTo(x + 2, y + 1).lineTo(x + 4, y + 3).stroke({ color: 0x56743f, width: .5 });
          else if (kind === "river") terrain.rect(x + (detail % 2 ? 1 : 2), y, 1, 4).fill(0x49a2b9);
        }
      }
      scene.addChild(terrain);

      const cityById = new Map(overview.cities.map((city) => [city.id, city]));
      const cities = new Graphics();
      for (const city of overview.cities) {
        const { columns: miniatureColumns, rows: miniatureRows, districtCodes, airportCell } = city.miniature;
        const left = Math.round(city.atlasCenter.x - miniatureColumns / 2);
        const top = Math.round(city.atlasCenter.y - miniatureRows / 2);
        for (let index = 0; index < districtCodes.length; index += 1) {
          const districtCode = Number.parseInt(districtCodes[index] ?? "0", 16);
          if (!districtCode) continue;
          const x = left + index % miniatureColumns;
          const y = top + Math.floor(index / miniatureColumns);
          const district = city.districts[(districtCode - 1) % Math.max(1, city.districts.length)];
          const base = colorNumber(district?.color, 0x80905b);
          cities.rect(x, y, 1, 1).fill(base);
          const detail = (overview.terrainSeed ^ Math.imul(index + 3, 2_654_435_761) ^ city.id.length) >>> 0;
          const roofFrequency = Math.max(2, 7 - Math.min(5, district?.taskCount ?? 0));
          if (detail % roofFrequency === 0) cities.rect(x + .15, y + .1, .65, .5).fill(city.id === activeCityId ? 0xf0cf56 : 0xd5c08a);
          else if (detail % 3 === 0) cities.rect(x + .2, y + .2, .6, .6).fill(0x52666a);
        }
        cities.rect(left - .5, top - .5, miniatureColumns + 1, miniatureRows + 1).stroke({ color: city.id === activeCityId ? 0xf0cf56 : 0x102427, width: .55, alpha: .9 });
        drawAirport(cities, left + airportCell.x + .5, top + airportCell.y + .5);
      }
      scene.addChild(cities);

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
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, camera.zoom * Math.exp(-event.deltaY * .0015)));
      if (next === MIN_ZOOM && camera.zoom === MIN_ZOOM && event.deltaY > 0) { onZoomOut(); return; }
      camera.zoom = next;
      scheduleCamera();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".country-overview-city")) return;
      dragging = { x: event.clientX, y: event.clientY, centerX: camera.centerX, centerY: camera.centerY };
      host.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging || !app.renderer) return;
      const worldWidth = overview.bounds.maxX - overview.bounds.minX;
      const worldHeight = overview.bounds.maxY - overview.bounds.minY;
      const scale = Math.min((app.renderer.width / app.renderer.resolution) / worldWidth, (app.renderer.height / app.renderer.resolution) / worldHeight) * camera.zoom;
      camera.centerX = dragging.centerX - (event.clientX - dragging.x) / scale;
      camera.centerY = dragging.centerY - (event.clientY - dragging.y) / scale;
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
    className="country-atlas country-overview"
    data-country-id={countryId}
    data-country-atlas-cities={overview.cities.length}
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
