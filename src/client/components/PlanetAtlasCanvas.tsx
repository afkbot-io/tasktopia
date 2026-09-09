import { buildPlanetSurfaceTransport } from "../../shared/planet-surface-transport";
import { affineProject } from "../../shared/planet-atlas";
import { pixelPlanetRows } from "../map-visual-consistency";
import { type CSSProperties, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlanetAtlasDto } from "../../shared/planet-atlas-contract";
import { gameAssetUrl, getBuilding, ATLAS_CLOUD_SPRITES, PROP_SPRITES } from "../../shared/catalog";
import { overviewBuildingArt } from "../../shared/overview-building-art";
import { atlasTerrainConnectionMask, type AtlasTerrainKind } from "../../shared/atlas-scene";
import { overviewTerrainPatches } from "../../shared/overview-terrain-presentation";
import {
  layoutPlanetCountryLabels,
  projectPlanetAtlas,
  projectProjectedPlanetMap,
  zoomPlanetCameraAtFocus,
  type PlanetMapCamera,
  type PlanetMapCell,
  type PlanetMapCountry,
} from "../../shared/planet-atlas";
import { atlasHitTarget, atlasPointInsideEllipse, atlasTargetCoverage, atlasViewBoxPoint, continuousAtlasZoom, type AtlasWheelNavigation } from "../atlas-zoom-navigation";
import { peekPlanetAtlas, watchPlanetAtlas } from "../planet-atlas-cache";
import { smoothCameraScale } from "../world-camera";
import { bindMapPointerGestures } from "../map-pointer-gesture";
import { loadMapImage } from "../map-image";
import { visiblePlanetCountries } from "../planet-visible-countries";
import { AtlasAircraft } from "./AtlasAircraft";
import { AtlasOverviewCard, planetOverviewCardModel } from "./AtlasOverviewCard";

const MIN_MAP_ZOOM = .82;
const MAX_MAP_ZOOM = 8.5;
const COUNTRY_ENTRY_COVERAGE = .56;
// Fine material is immutable under camera motion. Only its outer macro-cell
// transform changes; React never rebuilds these four sheet windows per frame.
const AtlasTerrainMaterial = memo(function AtlasTerrainMaterial({ kind, column, row, mask }: {
  kind: AtlasTerrainKind; column: number; row: number; mask: number;
}) {
  return overviewTerrainPatches(kind, "planet", column, row, mask).map(({ x, y, size, tile }) =>
    <svg key={`${x}:${y}`} x={x} y={y} width={size} height={size}
      viewBox={`${tile.sourceX} ${tile.sourceY} ${tile.tileSize} ${tile.tileSize}`} preserveAspectRatio="none">
      <image href={gameAssetUrl(tile.url)} width={tile.sheetWidth} height={tile.sheetHeight} className="atlas-pixel" />
    </svg>);
});
function AtlasTerrainImage({ cell, mask }: { cell: PlanetMapCell; mask: number }) {
  return <svg x={cell.x} y={cell.y} width={cell.width} height={cell.height} viewBox="0 0 1 1" preserveAspectRatio="none" className="atlas-pixel planet-terrain-sprite" aria-hidden="true">
    <AtlasTerrainMaterial kind={cell.terrain} column={cell.q} row={cell.r} mask={mask} />
  </svg>;
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
  return <AtlasOverviewCard compact
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

export function PlanetAtlasCanvas({ userId, activeCountryId, initialFocusCountryId, refreshToken, onCountrySelect, wheelNavigation }: {
  userId: string;
  activeCountryId: string;
  initialFocusCountryId?: string;
  refreshToken: number;
  onCountrySelect: (countryId: string, focus?: { x: number; y: number }) => Promise<void> | void;
  wheelNavigation: AtlasWheelNavigation;
}) {
  const [atlas, setAtlas] = useState<PlanetAtlasDto | null>(() => peekPlanetAtlas(userId, refreshToken) ?? null);
  const [camera, setCamera] = useState<PlanetMapCamera>({ panX: 0, panY: 0, zoom: 1 });
  const cameraRef = useRef<PlanetMapCamera>(camera);
  const targetCameraRef = useRef<PlanetMapCamera>(camera);
  const cameraFrameRef = useRef(0);
  const cameraFrameAtRef = useRef(0);
  const [error, setError] = useState("");
  const [readyRevision, setReadyRevision] = useState<string | null>(null);
  const [assetError, setAssetError] = useState("");
  const [assetAttempt, setAssetAttempt] = useState(0);
  const [selectingCountryId, setSelectingCountryId] = useState<string | null>(null);
  const suppressClick = useRef(false);
  const selectionPending = useRef(false);
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
    return watchPlanetAtlas(userId, refreshToken, next => {
      // A 304-equivalent body keeps the same projected map and decoded assets.
      setAtlas(current => current?.revision === next.revision ? current : next);
      setError("");
    }, reason => setError(reason instanceof Error ? reason.message : "Не удалось открыть планету"));
  }, [refreshToken, userId]);

  const projectedAtlas = useMemo(() => atlas ? projectPlanetAtlas(atlas) : null, [atlas]);
  const map = useMemo(() => projectedAtlas ? projectProjectedPlanetMap(projectedAtlas, camera) : null, [projectedAtlas, camera]);
  const surfaceTransport = useMemo(() => projectedAtlas ? buildPlanetSurfaceTransport(projectedAtlas) : null, [projectedAtlas]);
  const transportPaths = useMemo(() => {
    const path = (points: Array<{x:number;y:number}>) => points.map((point,index) => {
      const p=affineProject(point,projectedAtlas!,camera);return `${index?"L":"M"}${p.x},${p.y}`;
    }).join(" ");
    return {rails:surfaceTransport?.rails.map(route=>({id:route.id,path:path(route.points)}))??[],ships:surfaceTransport?.ships.map(route=>({id:route.id,path:path([...route.points,...route.points.slice(0,-1).reverse()])}))??[]};
  },[surfaceTransport,projectedAtlas,camera]);
  const visibleCountries = useMemo(() => map ? visiblePlanetCountries(map.countries, map.surface, map) : [], [map]);
  const labels = useMemo(() => map ? layoutPlanetCountryLabels(visibleCountries, map.width, map.height) : [], [map, visibleCountries]);
  const countriesById = useMemo(() => new Map(map?.countries.map((country) => [country.id, country]) ?? []), [map]);
  const terrainByCoordinate = useMemo(() => {
    const lookup = new Map<string, PlanetMapCell>();
    for (const cell of map?.coastCells ?? []) lookup.set(`${cell.q}:${cell.r}`, cell);
    for (const country of map?.countries ?? []) for (const cell of country.cells) lookup.set(`${cell.q}:${cell.r}`, cell);
    return lookup;
  }, [map]);
  const terrainMask = useCallback((cell: PlanetMapCell) => atlasTerrainConnectionMask(
    cell.terrain,
    cell.q,
    cell.r,
    (column, row) => terrainByCoordinate.get(`${column}:${row}`)?.terrain,
  ), [terrainByCoordinate]);

  const atlasRevision = atlas?.revision;
  useEffect(() => {
    const view = atlasView.current;
    if (!view || !atlasRevision) return;
    const controller = new AbortController();
    setAssetError("");
    const urls = [...new Set([...view.querySelectorAll("image")]
      .filter(node => !node.closest(".planet-clouds, .planet-ships, .atlas-aircraft-flight"))
      .map(node => node.getAttribute("href")).filter((url): url is string => Boolean(url)))];
    void Promise.all(urls.map(url => loadMapImage(url, controller.signal, { crossOrigin: null })))
      .then(() => requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!controller.signal.aborted) setReadyRevision(atlasRevision);
    }))).catch(error => {
      if (!controller.signal.aborted) {
        setAssetError(error instanceof Error ? error.message : "Не удалось загрузить графику карты");
        controller.abort();
      }
    });
    return () => { controller.abort(); };
  }, [atlasRevision, assetAttempt]);

  useEffect(() => {
    initialFocusApplied.current = false;
  }, [initialFocusCountryId]);

  useEffect(() => {
    if (!projectedAtlas || !initialFocusCountryId || initialFocusApplied.current) return;
    const country = projectedAtlas.countries.find((candidate) => candidate.id === initialFocusCountryId);
    if (!country) return;
    initialFocusApplied.current = true;
    const nextCamera = {
      zoom: 1,
      panX: 0,
      panY: 0,
    };
    cameraRef.current = nextCamera;
    targetCameraRef.current = nextCamera;
    setCamera(nextCamera);
  }, [initialFocusCountryId, projectedAtlas]);

  const selectCountry = useCallback(async (countryId: string, focus?: { x: number; y: number }) => {
    if (selectionPending.current) return;
    selectionPending.current = true;
    setSelectingCountryId(countryId);
    try { await onCountrySelect(countryId, focus); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось открыть страну"); }
    finally { selectionPending.current = false; setSelectingCountryId(null); }
  }, [onCountrySelect]);

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
      const screenFocus = atlasViewBoxPoint({ x: event.clientX, y: event.clientY }, { minX: bounds.left, minY: bounds.top, maxX: bounds.right, maxY: bounds.bottom }, map);
      const nextCamera = projectedAtlas ? zoomPlanetCameraAtFocus(projectedAtlas, baseCamera, nextZoom, screenFocus) : { ...baseCamera, zoom: nextZoom };
      const nextMap = projectedAtlas ? projectProjectedPlanetMap(projectedAtlas, nextCamera) : map;
      const point = screenFocus;
      const country = atlasPointInsideEllipse(point, nextMap.surface)
        ? atlasHitTarget(point, nextMap.countries, candidate => candidate.cells.map(cell => ({ minX: cell.x, minY: cell.y, maxX: cell.x + cell.width, maxY: cell.y + cell.height }))) : undefined;
      const coverage = country ? atlasTargetCoverage(countryScreenBounds(country), { minX: 0, minY: 0, maxX: nextMap.width, maxY: nextMap.height }) : 0;
      targetCameraRef.current = nextCamera;
      scheduleCameraMotion();
      if (wheelNavigation.consume({ at: event.timeStamp, deltaY: event.deltaY }, direction === "IN" && coverage >= COUNTRY_ENTRY_COVERAGE && Boolean(country)) && country) void selectCountry(country.id, focus);
    };
    view.addEventListener("wheel", handleWheel, { passive: false });
    return () => view.removeEventListener("wheel", handleWheel);
  }, [map, projectedAtlas, scheduleCameraMotion, selectCountry, wheelNavigation]);

  useEffect(() => {
    const view = atlasView.current;
    if (!view || !projectedAtlas) return;
    return bindMapPointerGestures(view, (gesture) => {
      updateCameraImmediately((current) => {
        const rect = view.getBoundingClientRect();
        const currentMap = projectProjectedPlanetMap(projectedAtlas, current);
        const focus = atlasViewBoxPoint(gesture.center, { minX: rect.left, minY: rect.top, maxX: rect.right, maxY: rect.bottom }, currentMap);
        const zoom = Math.max(MIN_MAP_ZOOM, Math.min(MAX_MAP_ZOOM, current.zoom * gesture.scale));
        const zoomed = gesture.scale === 1
          ? current
          : zoomPlanetCameraAtFocus(projectedAtlas, current, zoom, focus);
        return {
          ...zoomed,
          panX: Math.max(-1.25, Math.min(1.25, zoomed.panX - gesture.panX * .0045 / zoomed.zoom)),
          panY: Math.max(-1, Math.min(1, zoomed.panY - gesture.panY * .0045 / zoomed.zoom)),
        };
      });
    }, {
      onNavigationStart: () => { suppressClick.current = true; },
      onEnd: (moved) => { suppressClick.current = moved; },
      shouldStart: (event) => !(event.target instanceof Element && event.target.closest(".planet-country-label, button, a, input, select, textarea")),
    });
  }, [projectedAtlas, updateCameraImmediately]);

  if (!map && error) return <div className="atlas-state" role="alert"><strong>Планета недоступна</strong><span>{error}</span></div>;
  if (!map) return <div className="atlas-state" role="status"><i /><span>Собираем материки…</span></div>;
  const clipId = `planet-map-${atlas?.revision.replaceAll(/[^a-zA-Z0-9_-]/g, "-") ?? "atlas"}`;
  const activeRoutes = [
    ...map.routes.filter((route) => route.fromAirportId === null).slice(0, 7),
    ...map.routes.filter((route) => route.fromAirportId !== null).slice(0, 5),
  ];

  return <div className="planet-atlas" data-planet-ready={readyRevision === atlasRevision && !assetError} data-planet-countries={atlas?.countries.length ?? map.countries.length} data-visible-countries={visibleCountries.length} data-planet-routes={map.routes.length} data-planet-railways={transportPaths.rails.length} data-planet-ships={transportPaths.ships.length} data-globe-zoom={camera.zoom.toFixed(2)} data-planet-renderer="square-pixel-map" data-planet-material-subdivisions="2">
    <svg ref={atlasView} viewBox={`0 0 ${map.width} ${map.height}`} role="group" aria-label={`Планета: ${atlas?.countries.length ?? map.countries.length} стран`} preserveAspectRatio="xMidYMid meet" tabIndex={0} onKeyDown={(event) => {
      const movement = event.shiftKey ? .22 : .09;
      if (event.key === "ArrowLeft") updateCameraImmediately((value) => ({ ...value, panX: Math.max(-1.25, value.panX - movement) }));
      else if (event.key === "ArrowRight") updateCameraImmediately((value) => ({ ...value, panX: Math.min(1.25, value.panX + movement) }));
      else if (event.key === "ArrowUp") updateCameraImmediately((value) => ({ ...value, panY: Math.max(-1, value.panY - movement) }));
      else if (event.key === "ArrowDown") updateCameraImmediately((value) => ({ ...value, panY: Math.min(1, value.panY + movement) }));
      else return;
      event.preventDefault();
    }}>
      <defs>
        <clipPath id={clipId}>{pixelPlanetRows(map.surface).map(row => <rect key={row.y} {...row} />)}</clipPath>
        <pattern id="planet-ocean-pixels" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform={`translate(${map.surface.minX} ${map.surface.minY}) scale(${camera.zoom})`}><image href={gameAssetUrl("atlas/terrain-v4/planet/ocean.png")} width="8" height="8" className="atlas-pixel" /></pattern>
      </defs>
      <rect className="planet-space" width={map.width} height={map.height} />
      <g className="planet-stars" aria-hidden="true">{map.stars.map((star) => <rect key={star.id} data-star-group={star.group} x={Math.round(map.width * star.xPercent / 100 / 2) * 2} y={Math.round(map.height * star.yPercent / 100 / 2) * 2} width={2} height={star.group === "constellation" ? 4 : 2} opacity={star.opacity} style={{ "--star-delay": `${star.delaySeconds}s` } as CSSProperties} />)}</g>
      <g clipPath={`url(#${clipId})`}>
        <rect className="planet-map-ocean" x={map.surface.minX} y={map.surface.minY} width={map.surface.maxX - map.surface.minX} height={map.surface.maxY - map.surface.minY} fill="url(#planet-ocean-pixels)" />
        <g className="planet-coast" aria-hidden="true">{map.coastCells.map((cell) => <AtlasTerrainImage key={cell.id} cell={cell} mask={terrainMask(cell)} />)}</g>
        <g className="planet-countries">{map.countries.map((country) => <g key={country.id} className="planet-country" data-country-id={country.id} data-active={country.id === activeCountryId ? "true" : "false"} data-selecting={country.id === selectingCountryId ? "true" : "false"} role="button" tabIndex={0} aria-label={`Открыть страну ${country.name}`} onClick={() => {
          if (suppressClick.current) { suppressClick.current = false; return; }
          void selectCountry(country.id);
        }} onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault(); void selectCountry(country.id);
        }}>{country.cells.map((cell) => <g key={cell.id}><AtlasTerrainImage cell={cell} mask={terrainMask(cell)} /><path d={pixelSquarePath(cell)} fill={country.color} className="planet-country-tint" /></g>)}
          <g className="planet-district-houses" aria-hidden="true">{country.districtIcons.map(icon => {
            const art = overviewBuildingArt(icon.id);
            return <image key={icon.id} data-district-id={icon.id} data-city-id={icon.cityId} data-building-family={art.key}
              href={art.url} x={icon.center.x - art.width / 2} y={icon.center.y - art.height / 2}
              width={art.width} height={art.height} className="atlas-pixel" />;
          })}</g>
          <g className="planet-airport-markers" aria-hidden="true">{country.airports.map(airport=><image key={airport.id} data-airport-task-id={airport.id} href={getBuilding("compact-airport-v1").stages[4]} x={airport.center.x-4} y={airport.center.y-3} width={8} height={6} className="atlas-pixel" />)}</g>
        </g>)}</g>
        <g className="planet-railways" aria-hidden="true">{transportPaths.rails.map(route=><g key={route.id}>
          <path d={route.path} fill="none" stroke="#293c39" strokeWidth="2" />
          <path d={route.path} fill="none" stroke="#b5b69a" strokeWidth=".8" />
          <path d={route.path} fill="none" stroke="#293c39" strokeWidth="3" strokeDasharray=".7 3" />
        </g>)}</g>
        <g className="planet-ships" aria-hidden="true">{transportPaths.ships.map((route,index)=><g key={route.id}>
          <animateMotion path={route.path} dur={`${45+index*7}s`} begin={`${-12-index*5}s`} repeatCount="indefinite" rotate="auto" />
          <image href={PROP_SPRITES["boat-horizontal-b"]} x="-3" y="-1" width="6" height="2" className="atlas-pixel" />
        </g>)}</g>
        <g className="planet-routes" aria-hidden="true">{activeRoutes.map((route) => <g key={route.id}><path d={route.path} className="planet-route-line" /><AtlasAircraft path={route.path} durationSeconds={route.durationSeconds} delaySeconds={route.delaySeconds} kind={route.planeKind} size="planet" rotateWithPath visualScale={route.altitudeScale} startsAtAirport={route.fromAirportId !== null} endsAtAirport /></g>)}</g>
        <g className="planet-clouds" aria-hidden="true">{map.clouds.map((cloud, index) => <g key={cloud.id} transform={`translate(${cloud.x} ${cloud.y}) scale(${cloud.scale})`} style={{ "--cloud-duration": `${cloud.durationSeconds}s`, "--cloud-delay": `${cloud.delaySeconds}s`, "--cloud-drift-x": `${index % 2 === 0 ? 62 : -54}px`, "--cloud-drift-y": `${index % 3 === 0 ? -8 : 7}px` } as CSSProperties}><image href={ATLAS_CLOUD_SPRITES[index % ATLAS_CLOUD_SPRITES.length]} x="-32" y="-16" width="64" height="32" className="atlas-pixel" /></g>)}</g>
      </g>
      <g className="planet-fog-pixels" aria-hidden="true">{map.edgeFog.map((fog) => <rect key={fog.id} x={fog.point.x - fog.size / 2} y={fog.point.y - fog.size / 2} width={fog.size} height={fog.size} opacity={fog.opacity} />)}</g>
      <g className="planet-country-labels">{labels.map((label) => {
        const country = countriesById.get(label.countryId);
        if (!country) return null;
        return <CountryLabel key={country.id} country={country} {...label} active={country.id === activeCountryId} selecting={country.id === selectingCountryId} onSelect={() => { void selectCountry(country.id); }} />;
      })}</g>
    </svg>
    {(readyRevision !== atlasRevision || assetError) && <div className="planet-texture-loading atlas-state" role={assetError ? "alert" : "status"}>
      <span>{assetError || "Готовим ландшафт планеты…"}</span>
      {assetError && <button type="button" onClick={() => setAssetAttempt(value => value + 1)}>Повторить</button>}
    </div>}
    {error && <div className="planet-refresh-warning" role="status">Показана сохранённая планета</div>}
  </div>;
}
