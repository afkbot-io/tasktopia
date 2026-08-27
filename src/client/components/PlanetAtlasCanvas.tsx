import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PLANET_ATLAS_SCHEMA_VERSION, type PlanetAtlasDto } from "../../shared/planet-atlas-contract";
import { gameAssetUrl, TERRAIN_SPRITES } from "../../shared/catalog";
import { ATLAS_AIRPORT_SVG_PATH } from "../../shared/atlas-airport";
import {
  layoutPlanetCountryLabels,
  projectPlanetAtlas,
  projectProjectedPlanetMap,
  zoomPlanetCameraAtFocus,
  type PlanetMapCamera,
  type PlanetMapCell,
  type PlanetMapCountry,
  type PlanetTerrainKind,
} from "../../shared/planet-atlas";
import { api } from "../api";
import { advanceAtlasEntryHysteresis, atlasTargetCoverage, continuousAtlasZoom, initialAtlasEntryHysteresis } from "../atlas-zoom-navigation";
import { planetAtlasCacheKey } from "../planet-atlas-cache";
import { smoothCameraScale } from "../world-camera";
import { AtlasAircraft } from "./AtlasAircraft";
import { AtlasOverviewCard, planetOverviewCardModel } from "./AtlasOverviewCard";

const MIN_MAP_ZOOM = .82;
const MAX_MAP_ZOOM = 8.5;
const COUNTRY_ENTRY_COVERAGE = .56;
const COUNTRY_ENTRY_REARM_ZOOM = 1.08;
const TERRAIN_FAMILY: Record<PlanetTerrainKind, keyof typeof TERRAIN_SPRITES> = {
  grass: "GRASS",
  meadow: "MEADOW",
  forest: "FOREST",
  hill: "HILL",
  mountain: "MOUNTAIN",
  coast: "SAND",
  river: "SHALLOW_WATER",
  stone: "STONE",
};

function terrainAsset(cell: PlanetMapCell): string {
  const sprites = TERRAIN_SPRITES[TERRAIN_FAMILY[cell.terrain]] ?? TERRAIN_SPRITES.GRASS!;
  return sprites[Math.abs(cell.q * 31 + cell.r * 17) % sprites.length] ?? sprites[0]!;
}

function countryScreenBounds(country: PlanetMapCountry) {
  return {
    minX: Math.min(...country.cells.map((cell) => cell.x)),
    minY: Math.min(...country.cells.map((cell) => cell.y)),
    maxX: Math.max(...country.cells.map((cell) => cell.x + cell.width)),
    maxY: Math.max(...country.cells.map((cell) => cell.y + cell.height)),
  };
}

function pixelSquarePath(cell: PlanetMapCell): string {
  return `M${cell.x},${cell.y}H${cell.x + cell.width}V${cell.y + cell.height}H${cell.x}Z`;
}

function readCachedPlanet(userId: string): PlanetAtlasDto | null {
  try {
    const value = window.sessionStorage.getItem(planetAtlasCacheKey(userId));
    if (!value) return null;
    const parsed = JSON.parse(value) as PlanetAtlasDto;
    return parsed.schemaVersion === PLANET_ATLAS_SCHEMA_VERSION ? parsed : null;
  } catch { return null; }
}

function writeCachedPlanet(userId: string, atlas: PlanetAtlasDto): void {
  try { window.sessionStorage.setItem(planetAtlasCacheKey(userId), JSON.stringify(atlas)); } catch { /* Optional first-paint cache. */ }
}

function CountryLabel({ country, x, y, width, height, active, selecting, onSelect }: {
  country: PlanetMapCountry;
  x: number;
  y: number;
  width: number;
  height: number;
  active: boolean;
  selecting: boolean;
  onSelect: () => void;
}) {
  return <AtlasOverviewCard
    className="planet-country-label"
    transform={`translate(${x} ${y})`}
    data-country-id={country.id}
    data-active={active ? "true" : "false"}
    data-selecting={selecting ? "true" : "false"}
    model={planetOverviewCardModel(country)}
    width={width}
    height={height}
    ariaLabel={`Открыть страну ${country.name}, ${country.cityCount} городов, ${country.unfinishedBuildingCount} зданий в работе, прогресс ${country.progress}%`}
    onSelect={onSelect}
  />;
}

export function PlanetAtlasCanvas({ userId, activeCountryId, initialFocusCountryId, refreshToken, onCountrySelect }: {
  userId: string;
  activeCountryId: string;
  initialFocusCountryId?: string;
  refreshToken: number;
  onCountrySelect: (countryId: string, focus?: { x: number; y: number }) => Promise<void> | void;
}) {
  const [atlas, setAtlas] = useState<PlanetAtlasDto | null>(() => readCachedPlanet(userId));
  const [camera, setCamera] = useState<PlanetMapCamera>({ panX: 0, panY: 0, zoom: 1 });
  const cameraRef = useRef<PlanetMapCamera>(camera);
  const targetCameraRef = useRef<PlanetMapCamera>(camera);
  const cameraFrameRef = useRef(0);
  const cameraFrameAtRef = useRef(0);
  const [error, setError] = useState("");
  const [selectingCountryId, setSelectingCountryId] = useState<string | null>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number; panX: number; panY: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const entryHysteresis = useRef(initialAtlasEntryHysteresis());
  const atlasView = useRef<SVGSVGElement>(null);
  const initialFocusApplied = useRef(false);

  const scheduleCameraMotion = useCallback(() => {
    if (cameraFrameRef.current) return;
    const animate = (timestamp: number) => {
      const deltaMs = cameraFrameAtRef.current ? timestamp - cameraFrameAtRef.current : 16;
      cameraFrameAtRef.current = timestamp;
      const current = cameraRef.current;
      const target = targetCameraRef.current;
      const next = {
        zoom: smoothCameraScale(current.zoom, target.zoom, deltaMs),
        panX: smoothCameraScale(current.panX, target.panX, deltaMs),
        panY: smoothCameraScale(current.panY, target.panY, deltaMs),
      };
      cameraRef.current = next;
      setCamera(next);
      if (next.zoom !== target.zoom || next.panX !== target.panX || next.panY !== target.panY) {
        cameraFrameRef.current = requestAnimationFrame(animate);
      } else {
        cameraFrameRef.current = 0;
        cameraFrameAtRef.current = 0;
      }
    };
    cameraFrameRef.current = requestAnimationFrame(animate);
  }, []);
  const updateCameraImmediately = useCallback((updater: (current: PlanetMapCamera) => PlanetMapCamera) => {
    if (cameraFrameRef.current) cancelAnimationFrame(cameraFrameRef.current);
    cameraFrameRef.current = 0;
    cameraFrameAtRef.current = 0;
    setCamera((current) => {
      const next = updater(current);
      cameraRef.current = next;
      targetCameraRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => () => {
    if (cameraFrameRef.current) cancelAnimationFrame(cameraFrameRef.current);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setAtlas(readCachedPlanet(userId));
    void api<PlanetAtlasDto>("/api/planet-atlas", { signal: controller.signal, cache: "no-cache" })
      .then((next) => {
        if (next.schemaVersion !== PLANET_ATLAS_SCHEMA_VERSION) throw new Error("Версия планеты устарела. Обновите страницу");
        setAtlas(next); writeCachedPlanet(userId, next); setError("");
      })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Не удалось открыть планету"); });
    return () => controller.abort();
  }, [refreshToken, userId]);

  const projectedAtlas = useMemo(() => atlas ? projectPlanetAtlas(atlas) : null, [atlas]);
  const map = useMemo(() => projectedAtlas ? projectProjectedPlanetMap(projectedAtlas, camera) : null, [projectedAtlas, camera]);
  const labels = useMemo(() => map ? layoutPlanetCountryLabels(map.countries, map.width, map.height) : [], [map]);
  const countriesById = useMemo(() => new Map(map?.countries.map((country) => [country.id, country]) ?? []), [map]);

  useEffect(() => {
    initialFocusApplied.current = false;
  }, [initialFocusCountryId]);

  useEffect(() => {
    if (!projectedAtlas || !initialFocusCountryId || initialFocusApplied.current) return;
    const country = projectedAtlas.countries.find((candidate) => candidate.id === initialFocusCountryId);
    if (!country) return;
    initialFocusApplied.current = true;
    entryHysteresis.current = { armed: false };
    const nextCamera = {
      zoom: 2.15,
      panX: Math.max(-1.25, Math.min(1.25, (country.center.x - projectedAtlas.width / 2) / (projectedAtlas.width * .32))),
      panY: Math.max(-1, Math.min(1, (country.center.y - projectedAtlas.height / 2) / (projectedAtlas.height * .32))),
    };
    cameraRef.current = nextCamera;
    targetCameraRef.current = nextCamera;
    setCamera(nextCamera);
  }, [initialFocusCountryId, projectedAtlas]);

  const selectCountry = useCallback(async (countryId: string, focus?: { x: number; y: number }) => {
    if (selectingCountryId) return;
    setSelectingCountryId(countryId);
    try { await onCountrySelect(countryId, focus); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось открыть страну"); }
    finally { setSelectingCountryId(null); }
  }, [onCountrySelect, selectingCountryId]);

  useEffect(() => {
    const view = atlasView.current;
    if (!view || !map) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const direction = event.deltaY < 0 ? "IN" : "OUT";
      const baseCamera = targetCameraRef.current;
      const nextZoom = continuousAtlasZoom(baseCamera.zoom, event.deltaY, { min: MIN_MAP_ZOOM, max: MAX_MAP_ZOOM });
      const bounds = view.getBoundingClientRect();
      const focus = { x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width))), y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / Math.max(1, bounds.height))) };
      const screenFocus = { x: focus.x * map.width, y: focus.y * map.height };
      const nextCamera = projectedAtlas ? zoomPlanetCameraAtFocus(projectedAtlas, baseCamera, nextZoom, screenFocus) : { ...baseCamera, zoom: nextZoom };
      const nextMap = projectedAtlas ? projectProjectedPlanetMap(projectedAtlas, nextCamera) : map;
      const point = { x: focus.x * nextMap.width, y: focus.y * nextMap.height };
      const country = [...nextMap.countries].sort((left, right) => Math.hypot(left.center.x - point.x, left.center.y - point.y) - Math.hypot(right.center.x - point.x, right.center.y - point.y))[0];
      const coverage = country ? atlasTargetCoverage(countryScreenBounds(country), { minX: 0, minY: 0, maxX: nextMap.width, maxY: nextMap.height }) : 0;
      const entry = advanceAtlasEntryHysteresis(entryHysteresis.current, { direction, zoom: nextZoom, rearmZoom: COUNTRY_ENTRY_REARM_ZOOM, coverage, enterCoverage: COUNTRY_ENTRY_COVERAGE });
      entryHysteresis.current = entry.state;
      targetCameraRef.current = nextCamera;
      scheduleCameraMotion();
      if (entry.triggered && country) void selectCountry(country.id, focus);
    };
    view.addEventListener("wheel", handleWheel, { passive: false });
    return () => view.removeEventListener("wheel", handleWheel);
  }, [map, projectedAtlas, scheduleCameraMotion, selectCountry]);

  if (!map && error) return <div className="atlas-state" role="alert"><strong>Планета недоступна</strong><span>{error}</span></div>;
  if (!map) return <div className="atlas-state" role="status"><i /><span>Собираем материки…</span></div>;
  const clipId = `planet-map-${atlas?.revision.replaceAll(/[^a-zA-Z0-9_-]/g, "-") ?? "atlas"}`;
  const activeRoutes = [
    ...map.routes.filter((route) => route.fromAirportId === null).slice(0, 7),
    ...map.routes.filter((route) => route.fromAirportId !== null).slice(0, 5),
  ];

  return <div className="planet-atlas" data-planet-countries={atlas?.countries.length ?? map.countries.length} data-visible-countries={map.countries.length} data-planet-routes={map.routes.length} data-globe-zoom={camera.zoom.toFixed(2)} data-planet-renderer="square-pixel-map">
    <svg ref={atlasView} viewBox={`0 0 ${map.width} ${map.height}`} role="group" aria-label={`Планета: ${atlas?.countries.length ?? map.countries.length} стран`} preserveAspectRatio="xMidYMid meet" tabIndex={0} onKeyDown={(event) => {
      const movement = event.shiftKey ? .22 : .09;
      if (event.key === "ArrowLeft") updateCameraImmediately((value) => ({ ...value, panX: Math.max(-1.25, value.panX - movement) }));
      else if (event.key === "ArrowRight") updateCameraImmediately((value) => ({ ...value, panX: Math.min(1.25, value.panX + movement) }));
      else if (event.key === "ArrowUp") updateCameraImmediately((value) => ({ ...value, panY: Math.max(-1, value.panY - movement) }));
      else if (event.key === "ArrowDown") updateCameraImmediately((value) => ({ ...value, panY: Math.min(1, value.panY + movement) }));
      else return;
      event.preventDefault();
    }} onPointerDown={(event) => {
      drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX: camera.panX, panY: camera.panY, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    }} onPointerMove={(event) => {
      const active = drag.current;
      if (!active || active.pointerId !== event.pointerId) return;
      const deltaX = event.clientX - active.x;
      const deltaY = event.clientY - active.y;
      active.moved ||= Math.abs(deltaX) + Math.abs(deltaY) > 5;
      updateCameraImmediately((value) => ({ ...value, panX: Math.max(-1.25, Math.min(1.25, active.panX - deltaX * .0045 / value.zoom)), panY: Math.max(-1, Math.min(1, active.panY - deltaY * .0045 / value.zoom)) }));
    }} onPointerUp={(event) => {
      suppressClick.current = Boolean(drag.current?.moved); drag.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }} onPointerCancel={(event) => {
      drag.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }}>
      <defs>
        <clipPath id={clipId}><ellipse cx={(map.surface.minX + map.surface.maxX) / 2} cy={(map.surface.minY + map.surface.maxY) / 2} rx={(map.surface.maxX - map.surface.minX) / 2} ry={(map.surface.maxY - map.surface.minY) / 2} /></clipPath>
        <pattern id="planet-ocean-pixels" width="8" height="8" patternUnits="userSpaceOnUse"><image href={gameAssetUrl("terrain/deep_water-2.png")} width="8" height="8" className="atlas-pixel" /></pattern>
      </defs>
      <rect className="planet-space" width={map.width} height={map.height} />
      <g className="planet-stars" aria-hidden="true">{map.stars.map((star) => <rect key={star.id} data-star-group={star.group} x={`${star.xPercent}%`} y={`${star.yPercent}%`} width={star.size} height={star.size} opacity={star.opacity} style={{ "--star-delay": `${star.delaySeconds}s` } as CSSProperties} />)}</g>
      <g clipPath={`url(#${clipId})`}>
        <rect className="planet-map-ocean" x={map.surface.minX} y={map.surface.minY} width={map.surface.maxX - map.surface.minX} height={map.surface.maxY - map.surface.minY} fill="url(#planet-ocean-pixels)" />
        <g className="planet-coast" aria-hidden="true">{map.coastCells.map((cell) => <image key={cell.id} href={gameAssetUrl(terrainAsset(cell))} x={cell.x} y={cell.y} width={cell.width} height={cell.height} className="atlas-pixel planet-terrain-sprite" />)}</g>
        <g className="planet-countries">{map.countries.map((country) => <g key={country.id} className="planet-country" data-country-id={country.id} data-active={country.id === activeCountryId ? "true" : "false"} data-selecting={country.id === selectingCountryId ? "true" : "false"} role="button" tabIndex={0} aria-label={`Открыть страну ${country.name}`} onClick={() => {
          if (suppressClick.current) { suppressClick.current = false; return; }
          void selectCountry(country.id);
        }} onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault(); void selectCountry(country.id);
        }}>{country.cells.map((cell) => <g key={cell.id}><image href={gameAssetUrl(terrainAsset(cell))} x={cell.x} y={cell.y} width={cell.width} height={cell.height} className="atlas-pixel planet-terrain-sprite" /><path d={pixelSquarePath(cell)} fill={country.color} className="planet-country-tint" /></g>)}
          <g className="planet-airport-markers" aria-hidden="true">{country.airports.map((airport) => <g key={airport.id} transform={`translate(${airport.center.x} ${airport.center.y})`}><rect x="-5" y="-5" width="10" height="10" /><path d={ATLAS_AIRPORT_SVG_PATH} /></g>)}</g>
        </g>)}</g>
        <g className="planet-routes" aria-hidden="true">{activeRoutes.map((route) => <g key={route.id}><path d={route.path} className="planet-route-line" /><AtlasAircraft path={route.path} durationSeconds={route.durationSeconds} delaySeconds={route.delaySeconds} kind={route.planeKind} size="planet" rotateWithPath visualScale={route.altitudeScale} startsAtAirport={route.fromAirportId !== null} endsAtAirport /></g>)}</g>
        <g className="planet-clouds" aria-hidden="true">{map.clouds.map((cloud, index) => <g key={cloud.id} transform={`translate(${cloud.x} ${cloud.y}) scale(${cloud.scale})`} style={{ "--cloud-duration": `${cloud.durationSeconds}s`, "--cloud-delay": `${cloud.delaySeconds}s`, "--cloud-drift-x": `${index % 2 === 0 ? 62 : -54}px`, "--cloud-drift-y": `${index % 3 === 0 ? -8 : 7}px` } as CSSProperties}><image href={gameAssetUrl(`atlas/clouds-v2/cloud-topdown-${index % 8 + 1}.png`)} x="-32" y="-16" width="64" height="32" className="atlas-pixel" /></g>)}</g>
      </g>
      <g className="planet-fog-pixels" aria-hidden="true">{map.edgeFog.map((fog) => <rect key={fog.id} x={fog.point.x - fog.size / 2} y={fog.point.y - fog.size / 2} width={fog.size} height={fog.size} opacity={fog.opacity} />)}</g>
      <g className="planet-country-labels">{labels.map((label) => {
        const country = countriesById.get(label.countryId);
        if (!country) return null;
        return <CountryLabel key={country.id} country={country} {...label} active={country.id === activeCountryId} selecting={country.id === selectingCountryId} onSelect={() => { void selectCountry(country.id); }} />;
      })}</g>
    </svg>
    {error && <div className="planet-refresh-warning" role="status">Показана сохранённая планета</div>}
  </div>;
}
