import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { PLANET_ATLAS_SCHEMA_VERSION, type PlanetAtlasDto } from "../../shared/planet-atlas-contract";
import { gameAssetUrl } from "../../shared/catalog";
import {
  layoutPlanetCountryLabels,
  projectPlanetAtlas,
  projectProjectedPlanetGlobe,
  type PlanetGlobeCamera,
  type PlanetGlobeCountry,
} from "../../shared/planet-atlas";
import { api } from "../api";
import {
  advanceAtlasEntryHysteresis,
  atlasTargetCoverage,
  continuousAtlasZoom,
  initialAtlasEntryHysteresis,
} from "../atlas-zoom-navigation";
import { planetAtlasCacheKey } from "../planet-atlas-cache";
import { AtlasAircraft } from "./AtlasAircraft";
import { AtlasOverviewCard, planetOverviewCardModel } from "./AtlasOverviewCard";

const MIN_GLOBE_ZOOM = .82;
const MAX_GLOBE_ZOOM = 5.5;
const COUNTRY_ENTRY_COVERAGE = .72;
const COUNTRY_ENTRY_REARM_ZOOM = 1.08;

function countryScreenBounds(country: PlanetGlobeCountry) {
  const points = country.cells.flatMap((cell) => {
    const matches = [...cell.path.matchAll(/(-?\d+),(-?\d+)/g)];
    return matches.map((match) => ({ x: Number(match[1]), y: Number(match[2]) }));
  });
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

function countryAirportAnchors(country: PlanetGlobeCountry) {
  const ordered = [...country.cells].sort((left, right) => right.depth - left.depth || left.q - right.q || left.r - right.r);
  const count = country.cityCount;
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, index) => ordered[Math.floor(index * ordered.length / count)]).filter(Boolean);
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
  country: PlanetGlobeCountry;
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
  const [camera, setCamera] = useState<PlanetGlobeCamera>({ longitude: 0, latitude: -.08, zoom: 1 });
  const [error, setError] = useState("");
  const [selectingCountryId, setSelectingCountryId] = useState<string | null>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number; longitude: number; latitude: number; moved: boolean } | null>(null);
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
  const globe = useMemo(() => projectedAtlas ? projectProjectedPlanetGlobe(projectedAtlas, camera) : null, [projectedAtlas, camera]);
  const labels = useMemo(() => globe ? layoutPlanetCountryLabels(globe.countries, globe.width, globe.height) : [], [globe]);
  const countriesById = useMemo(() => new Map(globe?.countries.map((country) => [country.id, country]) ?? []), [globe]);

  const selectCountry = async (countryId: string, focus?: { x: number; y: number }) => {
    if (selectingCountryId) return;
    setSelectingCountryId(countryId);
    try {
      await onCountrySelect(countryId, focus);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось открыть страну");
    } finally { setSelectingCountryId(null); }
  };

  if (!globe && error) return <div className="atlas-state" role="alert"><strong>Планета недоступна</strong><span>{error}</span></div>;
  if (!globe) return <div className="atlas-state" role="status"><i /><span>Собираем материки…</span></div>;
  const clipId = `planet-globe-${atlas?.revision.replaceAll(/[^a-zA-Z0-9_-]/g, "-") ?? "atlas"}`;
  const edgeRoutes = globe.countries.flatMap((country) => Array.from({ length: Math.min(3, Math.max(1, country.cityCount)) }, (_, index) => {
    const start = index % 3 === 0 ? { x: -40, y: country.center.y - 80 }
      : index % 3 === 1 ? { x: globe.width + 40, y: country.center.y + 60 }
        : { x: country.center.x - 90, y: -40 };
    return {
      id: `planet-edge-route-${country.id}-${index}`,
      path: `M${start.x} ${start.y} Q${(start.x + country.center.x) / 2} ${(start.y + country.center.y) / 2 - 70} ${country.center.x} ${country.center.y}`,
      durationSeconds: 15 + index * 3,
      delaySeconds: -(index * 5 + country.cityCount),
      planeKind: country.cityCount + index,
      facing: start.x <= country.center.x ? "right" as const : "left" as const,
    };
  })).slice(0, 6);
  const activeRoutes = [...edgeRoutes, ...globe.routes].slice(0, 10);

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
      const nextZoom = continuousAtlasZoom(camera.zoom, event.deltaY, { min: MIN_GLOBE_ZOOM, max: MAX_GLOBE_ZOOM });
      const nextGlobe = projectedAtlas
        ? projectProjectedPlanetGlobe(projectedAtlas, { ...camera, zoom: nextZoom })
        : globe;
      const bounds = event.currentTarget.getBoundingClientRect();
      const focus = {
        x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width))),
        y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / Math.max(1, bounds.height))),
      };
      const point = { x: focus.x * nextGlobe.width, y: focus.y * nextGlobe.height };
      const country = [...nextGlobe.countries].sort((left, right) =>
        Math.hypot(left.center.x - point.x, left.center.y - point.y)
        - Math.hypot(right.center.x - point.x, right.center.y - point.y))[0];
      const coverage = country
        ? atlasTargetCoverage(countryScreenBounds(country), { minX: 0, minY: 0, maxX: nextGlobe.width, maxY: nextGlobe.height })
        : 0;
      const entry = advanceAtlasEntryHysteresis(entryHysteresis.current, {
        direction,
        zoom: nextZoom,
        rearmZoom: COUNTRY_ENTRY_REARM_ZOOM,
        coverage,
        enterCoverage: COUNTRY_ENTRY_COVERAGE,
      });
      entryHysteresis.current = entry.state;
      setCamera((value) => ({ ...value, zoom: nextZoom }));
      if (entry.triggered && country) void selectCountry(country.id, focus);
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
        <pattern id="planet-ocean-pixels" width="8" height="8" patternUnits="userSpaceOnUse"><image href={gameAssetUrl("terrain/deep_water-2.png")} width="8" height="8" className="atlas-pixel" /></pattern>
        <radialGradient id="planet-atmosphere" cx="40%" cy="32%" r="68%"><stop offset=".62" stopColor="#65c4d1" stopOpacity="0" /><stop offset=".88" stopColor="#9ee2e5" stopOpacity=".18" /><stop offset="1" stopColor="#d9f0e4" stopOpacity=".5" /></radialGradient>
      </defs>
      <rect className="planet-space" width={globe.width} height={globe.height} />
      <ellipse className="planet-globe-shadow" cx={globe.center.x + 18} cy={globe.center.y + globe.clipRadius + 28} rx={globe.clipRadius * .88} ry="28" />
      <circle className="planet-globe-ocean" cx={globe.center.x} cy={globe.center.y} r={globe.clipRadius} fill="url(#planet-ocean-pixels)" />
      <g clipPath={`url(#${clipId})`}>
        <g className="planet-coast" aria-hidden="true">{globe.coastCells.map((cell) => <path key={`${cell.q}:${cell.r}`} d={cell.path} />)}</g>
        <g className="planet-countries">{globe.countries.map((country) => <g key={country.id} className="planet-country" data-country-id={country.id} data-active={country.id === activeCountryId ? "true" : "false"} data-selecting={country.id === selectingCountryId ? "true" : "false"} role="button" tabIndex={0} aria-label={`Открыть страну ${country.name}`} onClick={() => {
          if (suppressClick.current) { suppressClick.current = false; return; }
          void selectCountry(country.id);
        }} onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          void selectCountry(country.id);
        }}>{country.cells.map((cell) => <path key={`${cell.q}:${cell.r}`} d={cell.path} fill={country.color} />)}
          <g className="planet-airport-markers" aria-hidden="true">{countryAirportAnchors(country).map((cell, index) => <g key={index} transform={`translate(${cell!.center.x} ${cell!.center.y})`}><rect x="-5" y="-5" width="10" height="10" /><path d="M-3 0h2l2-3h1L1 0h3v1H1l1 3H1l-2-3h-2Z" /></g>)}</g>
        </g>)}</g>
        <g className="planet-routes" aria-hidden="true">{activeRoutes.map((route) => <g key={route.id}><path d={route.path} className="planet-route-line" /><AtlasAircraft path={route.path} durationSeconds={route.durationSeconds} delaySeconds={route.delaySeconds} kind={route.planeKind} facing={route.facing} size="planet" /></g>)}</g>
        <g className="planet-clouds" aria-hidden="true">{globe.clouds.map((cloud, index) => <g key={cloud.id} transform={`translate(${cloud.x} ${cloud.y}) scale(${cloud.scale})`} style={{ "--cloud-duration": `${cloud.durationSeconds}s`, "--cloud-delay": `${cloud.delaySeconds}s`, "--cloud-drift-x": `${index % 3 === 0 ? -86 : 74 + index * 3}px`, "--cloud-drift-y": `${index % 2 === 0 ? -12 : 16}px` } as CSSProperties}><image href={gameAssetUrl(`atlas/clouds/cloud-planet-${index % 8 + 1}.png`)} x="-48" y="-24" width="96" height="48" className="atlas-pixel" /></g>)}</g>
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
