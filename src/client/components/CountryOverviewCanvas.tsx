import { Application, Container, Graphics } from "pixi.js";
import "pixi.js/unsafe-eval";
import { useEffect, useRef, useState } from "react";
import type { RealtimeEvent } from "../../shared/contracts";
import { decodeCountryTerrain, type CountryOverviewCityDto, type CountryOverviewDto, type CountryOverviewTerrainKind } from "../../shared/country-overview-contract";
import { countryAtlasEventBatchImpact } from "../../shared/country-atlas-events";
import { api } from "../api";

const MIN_ZOOM = 1;
const MAX_ZOOM = 2.6;

type Camera = { zoom: number; centerX: number; centerY: number };

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

export function CountryOverviewCanvas({ countryId, activeCityId, events, onEventsProcessed, onCitySelect, onCityHover, onZoomOut }: {
  countryId: string;
  activeCityId?: string;
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
        if (next.schemaVersion !== 2 || next.countryId !== countryId) throw new Error("Сервер вернул карту другой страны");
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
        if (next.schemaVersion !== 2 || next.countryId !== countryId) throw new Error("Сервер вернул карту другой страны");
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
    const camera: Camera = {
      zoom: 1,
      centerX: (overview.bounds.minX + overview.bounds.maxX) / 2,
      centerY: (overview.bounds.minY + overview.bounds.maxY) / 2,
    };
    const app = new Application();
    const scene = new Container();

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
      for (const city of overview.cities) {
        const label = labels.querySelector<HTMLElement>(`[data-city-id="${city.id}"]`);
        if (!label) continue;
        label.style.transform = `translate3d(${scene.position.x + city.atlasCenter.x * scale}px, ${scene.position.y + city.atlasCenter.y * scale}px, 0) translate(-50%, -50%)`;
      }
      host.dataset.countryZoom = camera.zoom.toFixed(2);
      app.render();
    };
    const scheduleCamera = () => {
      if (!frame) frame = requestAnimationFrame(applyCamera);
    };

    void (async () => {
      await app.init({ resizeTo: host, backgroundColor: 0x557148, antialias: false, autoDensity: true, resolution: Math.min(devicePixelRatio, 2), preference: "webgl" });
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

      const cloudEdge = new Graphics();
      for (let index = 0; index < columns; index += 2) {
        const width = 5 + (index * 13 + overview.terrainSeed) % 7;
        cloudEdge.ellipse(index * cellSize, 0, width, 3).fill({ color: 0xf1f4ea, alpha: .54 });
        cloudEdge.ellipse(index * cellSize, rows * cellSize, width, 3).fill({ color: 0xf7f8ef, alpha: .62 });
      }
      for (let index = 0; index < rows; index += 2) {
        const height = 4 + (index * 17 + overview.terrainSeed) % 6;
        cloudEdge.ellipse(0, index * cellSize, 3, height).fill({ color: 0xf1f4ea, alpha: .5 });
        cloudEdge.ellipse(columns * cellSize, index * cellSize, 3, height).fill({ color: 0xf7f8ef, alpha: .58 });
      }
      scene.addChild(cloudEdge);

      const connections = new Graphics();
      const cityById = new Map(overview.cities.map((city) => [city.id, city]));
      for (const connection of overview.connections) {
        const from = cityById.get(connection.fromCityId)?.atlasCenter;
        const to = cityById.get(connection.toCityId)?.atlasCenter;
        if (!from || !to) continue;
        connections.moveTo(from.x, from.y).lineTo(to.x, to.y).stroke({ color: 0x32464b, width: 1.7, alpha: .9 });
        connections.moveTo(from.x, from.y).lineTo(to.x, to.y).stroke({ color: 0xb69b57, width: .35, alpha: .8 });
      }
      scene.addChild(connections);

      const cities = new Graphics();
      for (const city of overview.cities) {
        const size = 6 + Math.min(4, city.districts.length * .4);
        const left = Math.round(city.atlasCenter.x - size / 2);
        const top = Math.round(city.atlasCenter.y - size / 2);
        cities.rect(left + 1, top + 1, size, size).fill({ color: 0x142629, alpha: .35 });
        cities.rect(left, top + size / 2 - .5, size, 1).fill(0x3b4d52);
        cities.rect(left + size / 2 - .5, top, 1, size).fill(0x3b4d52);
        const roof = city.id === activeCityId ? 0xf0cf56 : 0xd1b979;
        cities.rect(left + 1, top + 1, 2, 2).fill(roof);
        cities.rect(left + size - 3, top + 1, 2, 2).fill(roof);
        cities.rect(left + 1, top + size - 3, 2, 2).fill(roof);
        cities.rect(left + size - 3, top + size - 3, 2, 2).fill(city.progress >= 50 ? 0x315f43 : roof);
        cities.rect(left, top, size, size).stroke({ color: 0x102427, width: .6 });
      }
      scene.addChild(cities);
      app.stop();
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
  }, [activeCityId, onZoomOut, overview]);

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
