import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { PLANET_ATLAS_SCHEMA_VERSION, type PlanetAtlasDto } from "../../shared/planet-atlas-contract";
import { gameAssetUrl } from "../../shared/catalog";
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
import { AtlasAircraft } from "./AtlasAircraft";
import { AtlasOverviewCard, planetOverviewCardModel } from "./AtlasOverviewCard";

const MIN_MAP_ZOOM = .82;
const MAX_MAP_ZOOM = 8.5;
const COUNTRY_ENTRY_COVERAGE = .56;
const COUNTRY_ENTRY_REARM_ZOOM = 1.08;
const TERRAIN_ASSET: Record<PlanetTerrainKind, string> = {
  grass: "atlas/terrain-v3/planet-grass.png",
  meadow: "atlas/terrain-v3/planet-meadow.png",
  forest: "atlas/terrain-v3/planet-forest.png",
  hill: "atlas/terrain-v3/planet-hill.png",
  mountain: "atlas/terrain-v3/planet-mountain.png",
  coast: "terrain/sand-1.png",
  river: "atlas/terrain-v3/planet-river.png",
  stone: "atlas/terrain-v3/planet-stone.png",
};

function countryScreenBounds(country: PlanetMapCountry) {
  return {
    minX: Math.min(...country.cells.map((cell) => cell.x)),
    minY: Math.min(...country.cells.map((cell) => cell.y)),
    maxX: Math.max(...country.cells.map((cell) => cell.x + cell.size)),
    maxY: Math.max(...country.cells.map((cell) => cell.y + cell.size)),
  };
}

function pixelSquarePath(cell: PlanetMapCell): string {
  return `M${cell.x},${cell.y}H${cell.x + cell.size}V${cell.y + cell.size}H${cell.x}Z`;
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

export function PlanetAtlasCanvas({ userId, activeCountryId, refreshToken, onCountrySelect }: {
  userId: string;
  activeCountryId: string;
  refreshToken: number;
  onCountrySelect: (countryId: string, focus?: { x: number; y: number }) => Promise<void> | void;
}) {
  const [atlas, setAtlas] = useState<PlanetAtlasDto | null>(() => readCachedPlanet(userId));
  const [camera, setCamera] = useState<PlanetMapCamera>({ panX: 0, panY: 0, zoom: 1 });
  const [error, setError] = useState("");
  const [selectingCountryId, setSelectingCountryId] = useState<string | null>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number; panX: number; panY: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const entryHysteresis = useRef(initialAtlasEntryHysteresis());

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

  const selectCountry = async (countryId: string, focus?: { x: number; y: number }) => {
    if (selectingCountryId) return;
    setSelectingCountryId(countryId);
    try { await onCountrySelect(countryId, focus); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось открыть страну"); }
    finally { setSelectingCountryId(null); }
  };

  if (!map && error) return <div className="atlas-state" role="alert"><strong>Планета недоступна</strong><span>{error}</span></div>;
  if (!map) return <div className="atlas-state" role="status"><i /><span>Собираем материки…</span></div>;
  const clipId = `planet-map-${atlas?.revision.replaceAll(/[^a-zA-Z0-9_-]/g, "-") ?? "atlas"}`;
  const activeRoutes = [
    ...map.routes.filter((route) => route.fromAirportId === null).slice(0, 7),
    ...map.routes.filter((route) => route.fromAirportId !== null).slice(0, 5),
  ];

  return <div className="planet-atlas" data-planet-countries={atlas?.countries.length ?? map.countries.length} data-visible-countries={map.countries.length} data-planet-routes={map.routes.length} data-globe-zoom={camera.zoom.toFixed(2)} data-planet-renderer="square-pixel-map">
    <svg viewBox={`0 0 ${map.width} ${map.height}`} role="group" aria-label={`Планета: ${atlas?.countries.length ?? map.countries.length} стран`} preserveAspectRatio="xMidYMid meet" tabIndex={0} onKeyDown={(event) => {
      const movement = event.shiftKey ? .22 : .09;
      if (event.key === "ArrowLeft") setCamera((value) => ({ ...value, panX: Math.max(-1.25, value.panX - movement) }));
      else if (event.key === "ArrowRight") setCamera((value) => ({ ...value, panX: Math.min(1.25, value.panX + movement) }));
      else if (event.key === "ArrowUp") setCamera((value) => ({ ...value, panY: Math.max(-1, value.panY - movement) }));
      else if (event.key === "ArrowDown") setCamera((value) => ({ ...value, panY: Math.min(1, value.panY + movement) }));
      else return;
      event.preventDefault();
    }} onWheel={(event) => {
      event.preventDefault();
      const direction = event.deltaY < 0 ? "IN" : "OUT";
      const nextZoom = continuousAtlasZoom(camera.zoom, event.deltaY, { min: MIN_MAP_ZOOM, max: MAX_MAP_ZOOM });
      const bounds = event.currentTarget.getBoundingClientRect();
      const focus = { x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width))), y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / Math.max(1, bounds.height))) };
      const screenFocus = { x: focus.x * map.width, y: focus.y * map.height };
      const nextCamera = projectedAtlas ? zoomPlanetCameraAtFocus(projectedAtlas, camera, nextZoom, screenFocus) : { ...camera, zoom: nextZoom };
      const nextMap = projectedAtlas ? projectProjectedPlanetMap(projectedAtlas, nextCamera) : map;
      const point = { x: focus.x * nextMap.width, y: focus.y * nextMap.height };
      const country = [...nextMap.countries].sort((left, right) => Math.hypot(left.center.x - point.x, left.center.y - point.y) - Math.hypot(right.center.x - point.x, right.center.y - point.y))[0];
      const coverage = country ? atlasTargetCoverage(countryScreenBounds(country), { minX: 0, minY: 0, maxX: nextMap.width, maxY: nextMap.height }) : 0;
      const entry = advanceAtlasEntryHysteresis(entryHysteresis.current, { direction, zoom: nextZoom, rearmZoom: COUNTRY_ENTRY_REARM_ZOOM, coverage, enterCoverage: COUNTRY_ENTRY_COVERAGE });
      entryHysteresis.current = entry.state;
      setCamera(nextCamera);
      if (entry.triggered && country) void selectCountry(country.id, focus);
    }} onPointerDown={(event) => {
      drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX: camera.panX, panY: camera.panY, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    }} onPointerMove={(event) => {
      const active = drag.current;
      if (!active || active.pointerId !== event.pointerId) return;
      const deltaX = event.clientX - active.x;
      const deltaY = event.clientY - active.y;
      active.moved ||= Math.abs(deltaX) + Math.abs(deltaY) > 5;
      setCamera((value) => ({ ...value, panX: Math.max(-1.25, Math.min(1.25, active.panX - deltaX * .0045 / value.zoom)), panY: Math.max(-1, Math.min(1, active.panY - deltaY * .0045 / value.zoom)) }));
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
        <g className="planet-coast" aria-hidden="true">{map.coastCells.map((cell) => <image key={cell.id} href={gameAssetUrl(TERRAIN_ASSET[cell.terrain])} x={cell.x} y={cell.y} width={cell.size} height={cell.size} className="atlas-pixel planet-terrain-sprite" />)}</g>
        <g className="planet-countries">{map.countries.map((country) => <g key={country.id} className="planet-country" data-country-id={country.id} data-active={country.id === activeCountryId ? "true" : "false"} data-selecting={country.id === selectingCountryId ? "true" : "false"} role="button" tabIndex={0} aria-label={`Открыть страну ${country.name}`} onClick={() => {
          if (suppressClick.current) { suppressClick.current = false; return; }
          void selectCountry(country.id);
        }} onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault(); void selectCountry(country.id);
        }}>{country.cells.map((cell) => <g key={cell.id}><image href={gameAssetUrl(TERRAIN_ASSET[cell.terrain])} x={cell.x} y={cell.y} width={cell.size} height={cell.size} className="atlas-pixel planet-terrain-sprite" /><path d={pixelSquarePath(cell)} fill={country.color} className="planet-country-tint" /></g>)}
          <g className="planet-airport-markers" aria-hidden="true">{country.airports.map((airport) => <g key={airport.id} transform={`translate(${airport.center.x} ${airport.center.y})`}><rect x="-5" y="-5" width="10" height="10" /><path d="M-2 0h1l1-2h1L.5 0H2v1H.5L1 3H0l-1-2h-1Z" /></g>)}</g>
        </g>)}</g>
        <g className="planet-routes" aria-hidden="true">{activeRoutes.map((route) => <g key={route.id}><path d={route.path} className="planet-route-line" /><AtlasAircraft path={route.path} durationSeconds={route.durationSeconds} delaySeconds={route.delaySeconds} kind={route.planeKind} size="planet" rotateWithPath visualScale={route.altitudeScale} /></g>)}</g>
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
