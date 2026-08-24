import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { PLANET_ATLAS_SCHEMA_VERSION, type PlanetAtlasDto } from "../../shared/planet-atlas-contract";
import {
  layoutPlanetCountryLabels,
  projectPlanetAtlas,
  projectProjectedPlanetGlobe,
  type PlanetGlobeCamera,
  type PlanetGlobeCountry,
} from "../../shared/planet-atlas";
import { api } from "../api";
import { advanceAtlasZoomBoundary, initialAtlasZoomBoundary } from "../atlas-zoom-navigation";
import { planetAtlasCacheKey } from "../planet-atlas-cache";
import { AtlasAircraft } from "./AtlasAircraft";

const MIN_GLOBE_ZOOM = .82;
const MAX_GLOBE_ZOOM = 1.45;

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
  country: PlanetGlobeCountry;
  x: number;
  y: number;
  width: number;
  height: number;
  active: boolean;
  selecting: boolean;
  onSelect: () => void;
}) {
  const displayName = country.name.length > 18 ? `${country.name.slice(0, 17)}…` : country.name;
  return <g className="planet-country-label" transform={`translate(${x} ${y})`} data-country-id={country.id} data-active={active ? "true" : "false"} data-selecting={selecting ? "true" : "false"} role="button" tabIndex={0} aria-label={`Открыть страну ${country.name}, ${country.cityCount} городов, прогресс ${country.progress}%`} onPointerDown={(event) => event.stopPropagation()} onClick={onSelect} onKeyDown={(event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelect();
  }}>
    <rect className="planet-country-label-hit" width={width} height={height} />
    <rect className="planet-country-progress-track" x="10" y={height - 7} width={width - 20} height="3" />
    <rect className="planet-country-progress-value" x="10" y={height - 7} width={(width - 20) * country.progress / 100} height="3" />
    <text x={width / 2} y="15" textAnchor="middle">{displayName}</text>
    <text className="planet-country-meta" x={width / 2} y="25" textAnchor="middle">{country.cityCount} ГОРОДОВ</text>
  </g>;
}

export function PlanetAtlasCanvas({ userId, activeCountryId, refreshToken, onCountrySelect }: {
  userId: string;
  activeCountryId: string;
  refreshToken: number;
  onCountrySelect: (countryId: string) => Promise<void> | void;
}) {
  const [atlas, setAtlas] = useState<PlanetAtlasDto | null>(() => readCachedPlanet(userId));
  const [camera, setCamera] = useState<PlanetGlobeCamera>({ longitude: 0, latitude: -.08, zoom: 1 });
  const [error, setError] = useState("");
  const [selectingCountryId, setSelectingCountryId] = useState<string | null>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number; longitude: number; latitude: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const zoomBoundary = useRef(initialAtlasZoomBoundary());

  useEffect(() => {
    const controller = new AbortController();
    setAtlas(readCachedPlanet(userId));
    void api<PlanetAtlasDto>("/api/planet-atlas", { signal: controller.signal, cache: "no-cache" })
      .then((next) => { setAtlas(next); writeCachedPlanet(userId, next); setError(""); })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Не удалось открыть планету"); });
    return () => controller.abort();
  }, [refreshToken, userId]);

  const projectedAtlas = useMemo(() => atlas ? projectPlanetAtlas(atlas) : null, [atlas]);
  const globe = useMemo(() => projectedAtlas ? projectProjectedPlanetGlobe(projectedAtlas, camera) : null, [projectedAtlas, camera]);
  const labels = useMemo(() => globe ? layoutPlanetCountryLabels(globe.countries, globe.width, globe.height) : [], [globe]);
  const countriesById = useMemo(() => new Map(globe?.countries.map((country) => [country.id, country]) ?? []), [globe]);

  const selectCountry = async (countryId: string) => {
    if (selectingCountryId) return;
    setSelectingCountryId(countryId);
    try {
      await onCountrySelect(countryId);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось открыть страну");
    } finally { setSelectingCountryId(null); }
  };

  if (!globe && error) return <div className="atlas-state" role="alert"><strong>Планета недоступна</strong><span>{error}</span></div>;
  if (!globe) return <div className="atlas-state" role="status"><i /><span>Собираем материки…</span></div>;
  const clipId = `planet-globe-${atlas?.revision.replaceAll(/[^a-zA-Z0-9_-]/g, "-") ?? "atlas"}`;

  return <div className="planet-atlas" data-planet-countries={atlas?.countries.length ?? globe.countries.length} data-visible-countries={globe.countries.length} data-planet-routes={globe.routes.length} data-globe-zoom={camera.zoom.toFixed(2)}>
    <svg viewBox={`0 0 ${globe.width} ${globe.height}`} role="group" aria-label={`Планета: ${atlas?.countries.length ?? globe.countries.length} стран`} preserveAspectRatio="xMidYMid meet" tabIndex={0} onKeyDown={(event) => {
      const movement = event.shiftKey ? .22 : .09;
      if (event.key === "ArrowLeft") setCamera((value) => ({ ...value, longitude: value.longitude - movement }));
      else if (event.key === "ArrowRight") setCamera((value) => ({ ...value, longitude: value.longitude + movement }));
      else if (event.key === "ArrowUp") setCamera((value) => ({ ...value, latitude: Math.max(-1.05, value.latitude - movement) }));
      else if (event.key === "ArrowDown") setCamera((value) => ({ ...value, latitude: Math.min(1.05, value.latitude + movement) }));
      else return;
      event.preventDefault();
    }} onWheel={(event) => {
      event.preventDefault();
      const direction = event.deltaY < 0 ? "IN" : "OUT";
      const atBoundary = direction === "IN" && camera.zoom >= MAX_GLOBE_ZOOM - .001;
      const next = advanceAtlasZoomBoundary(zoomBoundary.current, { at: performance.now(), atBoundary, direction });
      zoomBoundary.current = next.state;
      if (next.triggered) {
        const bounds = event.currentTarget.getBoundingClientRect();
        const point = { x: (event.clientX - bounds.left) / Math.max(1, bounds.width) * globe.width, y: (event.clientY - bounds.top) / Math.max(1, bounds.height) * globe.height };
        const country = [...globe.countries].sort((left, right) => Math.hypot(left.center.x - point.x, left.center.y - point.y) - Math.hypot(right.center.x - point.x, right.center.y - point.y))[0];
        if (country) void selectCountry(country.id);
        return;
      }
      setCamera((value) => ({ ...value, zoom: Math.max(MIN_GLOBE_ZOOM, Math.min(MAX_GLOBE_ZOOM, value.zoom + (direction === "IN" ? .1 : -.1))) }));
    }} onPointerDown={(event) => {
      drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, longitude: camera.longitude, latitude: camera.latitude, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    }} onPointerMove={(event) => {
      const active = drag.current;
      if (!active || active.pointerId !== event.pointerId) return;
      const deltaX = event.clientX - active.x;
      const deltaY = event.clientY - active.y;
      active.moved ||= Math.abs(deltaX) + Math.abs(deltaY) > 5;
      setCamera((value) => ({ ...value, longitude: active.longitude - deltaX * .006 / value.zoom, latitude: Math.max(-1.05, Math.min(1.05, active.latitude + deltaY * .0045 / value.zoom)) }));
    }} onPointerUp={(event) => {
      suppressClick.current = Boolean(drag.current?.moved);
      drag.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }} onPointerCancel={(event) => {
      drag.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }}>
      <defs>
        <clipPath id={clipId}><circle cx={globe.center.x} cy={globe.center.y} r={globe.clipRadius} /></clipPath>
        <radialGradient id="planet-ocean-depth" cx="36%" cy="28%" r="72%"><stop offset="0" stopColor="#3d91a8" /><stop offset=".58" stopColor="#17617d" /><stop offset="1" stopColor="#092f47" /></radialGradient>
        <radialGradient id="planet-atmosphere" cx="40%" cy="32%" r="68%"><stop offset=".62" stopColor="#65c4d1" stopOpacity="0" /><stop offset=".88" stopColor="#9ee2e5" stopOpacity=".18" /><stop offset="1" stopColor="#d9f0e4" stopOpacity=".5" /></radialGradient>
      </defs>
      <rect className="planet-space" width={globe.width} height={globe.height} />
      <ellipse className="planet-globe-shadow" cx={globe.center.x + 18} cy={globe.center.y + globe.clipRadius + 28} rx={globe.clipRadius * .88} ry="28" />
      <circle className="planet-globe-ocean" cx={globe.center.x} cy={globe.center.y} r={globe.clipRadius} fill="url(#planet-ocean-depth)" />
      <g clipPath={`url(#${clipId})`}>
        <g className="planet-coast" aria-hidden="true">{globe.coastCells.map((cell) => <path key={`${cell.q}:${cell.r}`} d={cell.path} />)}</g>
        <g className="planet-countries">{globe.countries.map((country) => <g key={country.id} className="planet-country" data-country-id={country.id} data-active={country.id === activeCountryId ? "true" : "false"} data-selecting={country.id === selectingCountryId ? "true" : "false"} role="button" tabIndex={0} aria-label={`Открыть страну ${country.name}`} onClick={() => {
          if (suppressClick.current) { suppressClick.current = false; return; }
          void selectCountry(country.id);
        }} onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          void selectCountry(country.id);
        }}>{country.cells.map((cell) => <path key={`${cell.q}:${cell.r}`} d={cell.path} fill={country.color} stroke={country.accent} />)}</g>)}</g>
        <g className="planet-routes" aria-hidden="true">{globe.routes.map((route) => <g key={route.id}><path d={route.path} className="planet-route-line" /><AtlasAircraft path={route.path} durationSeconds={route.durationSeconds} delaySeconds={route.delaySeconds} kind={route.planeKind} facing={route.facing} size="planet" /></g>)}</g>
        <g className="planet-clouds" aria-hidden="true">{globe.clouds.map((cloud) => <g key={cloud.id} transform={`translate(${cloud.x} ${cloud.y}) scale(${cloud.scale})`} style={{ "--cloud-duration": `${cloud.durationSeconds}s`, "--cloud-delay": `${cloud.delaySeconds}s` } as CSSProperties}><path d="M0 8h7V4h6V1h9v3h7v4h9v6H0Z" /><path className="planet-cloud-shade" d="M7 14h24v3H7Z" /></g>)}</g>
        <circle className="planet-globe-atmosphere" cx={globe.center.x} cy={globe.center.y} r={globe.clipRadius} fill="url(#planet-atmosphere)" />
      </g>
      <circle className="planet-globe-shade" cx={globe.center.x} cy={globe.center.y} r={globe.clipRadius} />
      <g className="planet-country-labels">{labels.map((label) => {
        const country = countriesById.get(label.countryId);
        if (!country) return null;
        return <CountryLabel key={country.id} country={country} {...label} active={country.id === activeCountryId} selecting={country.id === selectingCountryId} onSelect={() => { void selectCountry(country.id); }} />;
      })}</g>
    </svg>
    <div className="planet-globe-hint" aria-hidden="true">Перетащите планету · приблизьте страну</div>
    {error && <div className="planet-refresh-warning" role="status">Показана сохранённая планета</div>}
  </div>;
}
