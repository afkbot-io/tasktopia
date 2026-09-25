import { rasterizePlanetTerrain, type PlanetTerrainRaster } from "../planet-terrain-raster";
import { AtlasShips } from "./AtlasShips";
import { ScheduledAtlasTrains } from "./ScheduledAtlasTrains";
import { useAtlasQuality } from "../use-atlas-quality";
import { readWorldPreferences, subscribeWorldPreferences } from "../world-preferences";
import { PlanetCloud } from "./PlanetCloud";
import { planetLabelDetail, planetMiniatureScales } from "../planet-presentation";
import { PlanetCityMiniature } from "./PlanetCityMiniature";
import { planetCityTargets, planetCityAtPoint, layoutPlanetCityLabels, type PlanetCityTarget } from "../planet-city-targets";
import { atlasShipPath } from "../../shared/atlas-ship-path";
import { buildPlanetSurfaceTransport } from "../../shared/planet-surface-transport";
import { affineProject } from "../../shared/planet-atlas";
import { pixelPlanetRows } from "../map-visual-consistency";
import { type CSSProperties, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlanetAtlasDto } from "../../shared/planet-atlas-contract";
import { gameAssetUrl } from "../../shared/catalog";
import { atlasTerrainConnectionMask } from "../../shared/atlas-scene";
import {
  projectPlanetAtlas,
  layoutPlanetCountryLabels,
  projectProjectedPlanetMap,
  planetMapTransform,
  zoomPlanetCameraAtFocus,
  type PlanetMapCamera,
  type ProjectedPlanetCountry,
  type PlanetMapCell,
  type PlanetTerrainCell,
} from "../../shared/planet-atlas";
import { atlasPointInsideEllipse, atlasViewBoxPoint, continuousAtlasZoom, type AtlasWheelNavigation } from "../atlas-zoom-navigation";
import { peekPlanetAtlas, watchPlanetAtlas } from "../planet-atlas-cache";
import { smoothCameraScale } from "../world-camera";
import { bindMapPointerGestures } from "../map-pointer-gesture";
import { loadMapImage } from "../map-image";
import { visiblePlanetCountries } from "../planet-visible-countries";
import { ScheduledAtlasFlights } from "./ScheduledAtlasFlights";


const MIN_MAP_ZOOM = .82;
const MAX_MAP_ZOOM = 8.5;
const CITY_ENTRY_ZOOM = 5.8;
export type PlanetViewState = { camera: PlanetMapCamera; sector: number };
// Native textures are composed once per atlas revision. Camera motion changes
// only the parent's matrix, with no nested spritesheet viewports to repaint.
const AtlasTerrainLayer = memo(function AtlasTerrainLayer({ cells, rasters, color }: {
  cells: PlanetMapCell[]; rasters: PlanetTerrainRaster[]; color?: string;
}) {
  return <>
    <g className={color ? "planet-country-terrain" : undefined}>{rasters.map(raster =>
      <svg key={raster.id} className="atlas-pixel planet-terrain-sprite" data-terrain-raster="true"
        x={raster.x} y={raster.y} width={raster.width} height={raster.height} viewBox={`0 0 ${raster.width} ${raster.height}`}>
        <image href={raster.href} width={raster.width} height={raster.height} className="atlas-pixel" />
      </svg>)}</g>
    {color && <path d={cells.map(pixelSquarePath).join(" ")} fill={color} className="planet-country-tint" />}
  </>;
});

// Geographic symbol geometry is immutable. Zoom moves one group rather than
// rebuilding every wall/roof path on every animation frame.
const PlanetMiniatures = memo(function PlanetMiniatures({ country, scales }: {
  country: ProjectedPlanetCountry; scales: Map<string, number>;
}) {
  return <g className="planet-district-houses" aria-hidden="true">{country.districtIcons.map(icon =>
    <PlanetCityMiniature key={icon.id} id={icon.id} family={icon.family} stage={icon.stage}
      x={icon.point.x} y={icon.point.y} zoom={scales.get(icon.id) ?? 0} />)}</g>;
});

function pixelSquarePath(cell: PlanetMapCell): string {
  return `M${cell.x},${cell.y}H${cell.x + cell.width}V${cell.y + cell.height}H${cell.x}Z`;
}

export function PlanetAtlasCanvas({ userId, activeCountryId, initialFocusCountryId, refreshToken, onCitySelect, onCityIntent, initialView, onViewChange, wheelNavigation }: {
  userId: string;
  activeCountryId: string;
  initialFocusCountryId?: string;
  refreshToken: number;
  onCitySelect: (countryId: string, cityId: string, focus?: { x: number; y: number }, cityName?: string) => Promise<void> | void;
  onCityIntent?: (countryId: string, cityId: string, revision: number) => void;
  initialView?: PlanetViewState;
  onViewChange?: (view: PlanetViewState) => void;
  wheelNavigation: AtlasWheelNavigation;
}) {
  const [atlas, setAtlas] = useState<PlanetAtlasDto | null>(() => peekPlanetAtlas(userId, refreshToken) ?? null);
  const [selectedSector, setSelectedSector] = useState<number | null>(initialView?.sector ?? null);
  const [camera, setCamera] = useState<PlanetMapCamera>(initialView?.camera ?? { panX: 0, panY: 0, zoom: 1 });
  const cameraRef = useRef<PlanetMapCamera>(camera);
  const targetCameraRef = useRef<PlanetMapCamera>(camera);
  const cameraFrameRef = useRef(0);
  const cameraFrameAtRef = useRef(0);
  const [error, setError] = useState("");
  const [readyRevision, setReadyRevision] = useState<string | null>(null);
  const [assetError, setAssetError] = useState("");
  const [terrainRasters, setTerrainRasters] = useState<{ revision: string; layers: Map<string, PlanetTerrainRaster[]> } | null>(null);
  const [assetAttempt, setAssetAttempt] = useState(0);
  const [selectingCityId, setSelectingCityId] = useState<string | null>(null);
  const intentTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancelCityIntent = useCallback(() => { clearTimeout(intentTimer.current); }, []);
  const scheduleCityIntent = useCallback((countryId:string,cityId:string,revision:number) => {
    clearTimeout(intentTimer.current);
    intentTimer.current=setTimeout(()=>onCityIntent?.(countryId,cityId,revision),350);
  },[onCityIntent]);
  useEffect(()=>cancelCityIntent,[cancelCityIntent]);
  const suppressClick = useRef(false);
  const selectionSequence = useRef(0);
  const atlasView = useRef<SVGSVGElement>(null);
  const [labelScale, setLabelScale] = useState(1);
  const [visibleViewport, setVisibleViewport] = useState({ minX: 0, minY: 0, width: 1000, height: 700 });
  useEffect(() => {
    const view = atlasView.current;
    if (!view) return;
    const resize = () => {
      const bounds = view.getBoundingClientRect();
      const fit = Math.min(bounds.width / 1000, bounds.height / 700);
      if (fit > 0) {
        setLabelScale(Math.max(1, 1 / fit));
        const width = bounds.width / fit, height = bounds.height / fit;
        setVisibleViewport({ minX: (1000 - width) / 2, minY: (700 - height) / 2, width, height });
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(view); resize();
    return () => observer.disconnect();
  }, [atlas?.revision]);

  useEffect(() => {
    const view = atlasView.current;
    if (!view) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const reconcile = () => {
      const paused = document.hidden || motion.matches || readWorldPreferences().reduceMotion;
      if (view.parentElement) view.parentElement.dataset.paused = String(paused);
      if (paused) view.pauseAnimations();
      else view.unpauseAnimations();
    };
    reconcile();
    document.addEventListener("visibilitychange", reconcile);
    motion.addEventListener("change", reconcile);
    const unsubscribe = subscribeWorldPreferences(reconcile);
    return () => {
      document.removeEventListener("visibilitychange", reconcile);
      motion.removeEventListener("change", reconcile);
      unsubscribe();
    };
  }, [atlas?.revision]);


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

  const sectors = useMemo(() => [...new Set(Object.values(atlas?.geography?.countries ?? {}).map(country => country.sector ?? 0))].sort((a,b)=>a-b), [atlas]);
  const preferredSector = atlas?.geography?.countries[initialFocusCountryId ?? activeCountryId]?.sector ?? 0;
  const sector = selectedSector !== null && sectors.includes(selectedSector) ? selectedSector : sectors.includes(preferredSector) ? preferredSector : sectors[0] ?? 0;
  const projectedAtlas = useMemo(() => atlas ? projectPlanetAtlas(atlas, sector) : null, [atlas, sector]);
  const miniatureScales = useMemo(() => projectedAtlas ? planetMiniatureScales(projectedAtlas) : new Map<string, number>(), [projectedAtlas]);
  const terrainGeometry = useMemo(() => {
    if (!projectedAtlas) return null;
    const unit = projectedAtlas.hexRadius * 2;
    const cellGeometry = (cell: PlanetTerrainCell): PlanetMapCell => ({ ...cell,
      x: cell.q * unit, y: cell.r * unit, width: unit, height: unit, size: unit,
      center: { x: (cell.q + .5) * unit, y: (cell.r + .5) * unit } });
    return { coast: projectedAtlas.coastCells.map(cellGeometry),
      countries: new Map(projectedAtlas.countries.map(country => [country.id, country.cells.map(cellGeometry)])) };
  }, [projectedAtlas]);
  const terrainCamera = projectedAtlas ? planetMapTransform(projectedAtlas, camera) : null;
  const terrainTransform = terrainCamera ? `translate(${terrainCamera.x} ${terrainCamera.y}) scale(${terrainCamera.scale})` : undefined;
  const map = useMemo(() => projectedAtlas ? projectProjectedPlanetMap(projectedAtlas, camera) : null, [projectedAtlas, camera]);
  const surfaceTransport = useMemo(() => projectedAtlas ? buildPlanetSurfaceTransport(projectedAtlas) : null, [projectedAtlas]);
  const transportPaths = useMemo(() => {
    const path = (points: Array<{x:number;y:number}>) => points.map((point,index) => {
      const p=affineProject(point,projectedAtlas!,camera);return `${index?"L":"M"}${p.x},${p.y}`;
    }).join(" ");
    return {rails:surfaceTransport?.rails.map(route=>({...route,points:route.points.map(point=>affineProject(point,projectedAtlas!,camera)),path:path(route.points)}))??[],ships:surfaceTransport?.ships.map(route=>({...route,path:atlasShipPath(route.points.map(point => affineProject(point, projectedAtlas!, camera)))}))??[]};
  },[surfaceTransport,projectedAtlas,camera]);
  const visibleCountries = useMemo(() => map ? visiblePlanetCountries(map.countries, map.surface, visibleViewport) : [], [map, visibleViewport]);
  const cityTargets = useMemo(() => projectedAtlas ? planetCityTargets(visibleCountries, projectedAtlas, camera) : [], [visibleCountries, projectedAtlas, camera]);
  const labelDetail = planetLabelDetail(camera.zoom);
  const labels = useMemo(() => map && labelDetail === "CITIES" ? layoutPlanetCityLabels(cityTargets, visibleViewport.width, visibleViewport.height, labelScale, { x: visibleViewport.minX, y: visibleViewport.minY }) : [], [map, cityTargets, labelDetail, labelScale, visibleViewport]);
  const countryLabels = useMemo(() => map && labelDetail === "COUNTRIES" ? layoutPlanetCountryLabels(visibleCountries, visibleViewport.width, visibleViewport.height, labelScale, { x: visibleViewport.minX, y: visibleViewport.minY }) : [], [map, visibleCountries, labelDetail, labelScale, visibleViewport]);
  useEffect(() => { onViewChange?.({camera,sector}); }, [camera,sector,onViewChange]);
  const terrainByCoordinate = useMemo(() => {
    const lookup = new Map<string, PlanetTerrainCell>();
    for (const cell of projectedAtlas?.coastCells ?? []) lookup.set(`${cell.q}:${cell.r}`, cell);
    for (const country of projectedAtlas?.countries ?? []) for (const cell of country.cells) lookup.set(`${cell.q}:${cell.r}`, cell);
    return lookup;
  }, [projectedAtlas]);
  const terrainMask = useCallback((cell: PlanetMapCell) => atlasTerrainConnectionMask(
    cell.terrain,
    cell.q,
    cell.r,
    (column, row) => terrainByCoordinate.get(`${column}:${row}`)?.terrain,
  ), [terrainByCoordinate]);

  const atlasRevision = atlas ? `${atlas.revision}:sector:${sector}` : undefined;
  useAtlasQuality(atlasView, Boolean(atlasRevision && readyRevision === atlasRevision && !assetError));
  useEffect(() => {
    const view = atlasView.current;
    if (!view || !atlasRevision) return;
    const controller = new AbortController();
    setAssetError("");
    if (!terrainGeometry) return () => controller.abort();
    const layers = new Map(terrainGeometry.countries);
    layers.set("coast", terrainGeometry.coast);
    void Promise.all([
      rasterizePlanetTerrain(layers, terrainMask, controller.signal),
      loadMapImage(gameAssetUrl("atlas/terrain-v4/planet/ocean.png"), controller.signal, { crossOrigin: null }),
    ]).then(([rasters]) => {
      if (controller.signal.aborted) return;
      setTerrainRasters({ revision: atlasRevision, layers: rasters });
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!controller.signal.aborted) setReadyRevision(atlasRevision);
      }));
    }).catch(error => {
      if (!controller.signal.aborted) {
        setAssetError(error instanceof Error ? error.message : "Не удалось загрузить графику карты");
        controller.abort();
      }
    });
    return () => { controller.abort(); };
  }, [atlasRevision, assetAttempt, terrainGeometry, terrainMask]);

  const selectCity = useCallback(async (city: PlanetCityTarget, focus?: { x: number; y: number }) => {
    const selection=++selectionSequence.current;
    setSelectingCityId(city.id);
    try { await onCitySelect(city.countryId, city.id, focus, city.name); if(selection===selectionSequence.current)setError(""); }
    catch (reason) { if(selection===selectionSequence.current)setError(reason instanceof Error ? reason.message : "Не удалось открыть город"); }
    finally { if(selection===selectionSequence.current)setSelectingCityId(null); }
  }, [onCitySelect]);

  const focusOrSelectCity = (city: PlanetCityTarget) => {
    if (suppressClick.current) { suppressClick.current=false; return; }
    if (labelDetail === "CITIES") { void selectCity(city); return; }
    if (!projectedAtlas || !map) return;
    const next=zoomPlanetCameraAtFocus(projectedAtlas,camera,3,city.center);
    targetCameraRef.current=next;
    scheduleCameraMotion();
  };

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
      const city = projectedAtlas && atlasPointInsideEllipse(point, nextMap.surface)
        ? planetCityAtPoint(point,planetCityTargets(nextMap.countries,projectedAtlas,nextCamera)) : undefined;
      if(city && nextZoom>=2){ const country=nextMap.countries.find(c=>c.id===city.countryId);if(country)scheduleCityIntent(city.countryId,city.id,country.worldVersion); } else cancelCityIntent();
      targetCameraRef.current = nextCamera;
      scheduleCameraMotion();
      if (wheelNavigation.consume({ at: event.timeStamp, deltaY: event.deltaY }, direction === "IN" && nextZoom >= CITY_ENTRY_ZOOM && Boolean(city)) && city) void selectCity(city, focus);
    };
    view.addEventListener("wheel", handleWheel, { passive: false });
    return () => view.removeEventListener("wheel", handleWheel);
  }, [map, projectedAtlas, scheduleCameraMotion, selectCity, scheduleCityIntent, cancelCityIntent, wheelNavigation]);

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
      shouldStart: (event) => !(event.target instanceof Element && event.target.closest(".planet-city-label, button, a, input, select, textarea")),
    });
  }, [projectedAtlas, updateCameraImmediately]);

  if (!map && error) return <div className="atlas-state" role="alert"><strong>Планета недоступна</strong><span>{error}</span></div>;
  if (!map) return <div className="atlas-state" role="status"><i /><span>Собираем материки…</span></div>;
  const clipId = `planet-map-${atlas?.revision.replaceAll(/[^a-zA-Z0-9_-]/g, "-") ?? "atlas"}`;
  const seenFlights = new Set<string>();
  const activeRoutes = map.routes.filter(route => {
    if (!route.fromAirportId || route.fromAirportId === route.toAirportId) return false;
    const key = JSON.stringify([route.fromAirportId,route.toAirportId].sort());
    if (seenFlights.has(key)) return false;
    seenFlights.add(key);
    return true;
  }).slice(0,5);

  return <div className="planet-atlas" data-planet-ready={readyRevision === atlasRevision && !assetError} data-planet-countries={atlas?.countries.length ?? map.countries.length} data-visible-countries={visibleCountries.length} data-planet-routes={map.routes.length} data-planet-railways={transportPaths.rails.length} data-planet-ships={transportPaths.ships.length} data-globe-zoom={camera.zoom.toFixed(2)} data-label-detail={labelDetail} data-planet-renderer="square-pixel-map" data-planet-material-subdivisions="2">
    {sectors.length > 1 && <label className="planet-sector-select">Область планеты
      <select aria-label="Область планеты" value={sector} onChange={event => {
        setSelectedSector(Number(event.target.value));
        updateCameraImmediately(() => ({ panX:0,panY:0,zoom:1 }));
      }}>{sectors.map(value => <option key={value} value={value}>Область {value + 1}</option>)}</select>
    </label>}
    <svg ref={atlasView} viewBox={`0 0 ${map.width} ${map.height}`} role="group" aria-label={`Планета: ${atlas?.countries.reduce((sum,c)=>sum+c.cities.length,0) ?? 0} городов`} preserveAspectRatio="xMidYMid meet" tabIndex={0} onClick={event => {
      // Pointer capture retargets a tap to the SVG. Resolve it in the same city
      // hit geometry as wheel navigation; dragging must never open a city.
      if (event.target !== event.currentTarget || suppressClick.current) return;
      const bounds=event.currentTarget.getBoundingClientRect();
      const point=atlasViewBoxPoint({x:event.clientX,y:event.clientY},{minX:bounds.left,minY:bounds.top,maxX:bounds.right,maxY:bounds.bottom},map);
      const city=planetCityAtPoint(point,cityTargets);
      if(city) focusOrSelectCity(city);
    }} onKeyDown={(event) => {
      const movement = event.shiftKey ? .22 : .09;
      if (event.key === "ArrowLeft") updateCameraImmediately((value) => ({ ...value, panX: Math.max(-1.25, value.panX - movement) }));
      else if (event.key === "ArrowRight") updateCameraImmediately((value) => ({ ...value, panX: Math.min(1.25, value.panX + movement) }));
      else if (event.key === "ArrowUp") updateCameraImmediately((value) => ({ ...value, panY: Math.max(-1, value.panY - movement) }));
      else if (event.key === "ArrowDown") updateCameraImmediately((value) => ({ ...value, panY: Math.min(1, value.panY + movement) }));
      else return;
      event.preventDefault();
    }}>
      <defs>
        <clipPath id={clipId}>{pixelPlanetRows(map.surface).filter(row => row.y + row.height >= visibleViewport.minY && row.y <= visibleViewport.minY + visibleViewport.height).map(row => <rect key={row.y} {...row} />)}</clipPath>
        <radialGradient id="planet-atmosphere"><stop offset="88%" stopColor="#92cab5" stopOpacity="0" /><stop offset="97%" stopColor="#92cab5" stopOpacity=".12" /><stop offset="100%" stopColor="#517c7a" stopOpacity=".24" /></radialGradient>
        <pattern id="planet-ocean-pixels" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform={`translate(${map.surface.minX} ${map.surface.minY}) scale(${camera.zoom})`}><image href={gameAssetUrl("atlas/terrain-v4/planet/ocean.png")} width="8" height="8" className="atlas-pixel" /></pattern>
      </defs>
      <rect className="planet-space" width={map.width} height={map.height} />
      <g className="planet-stars" aria-hidden="true">{map.stars.map((star) => <rect key={star.id} data-star-group={star.group} x={Math.round(map.width * star.xPercent / 100 / 2) * 2} y={Math.round(map.height * star.yPercent / 100 / 2) * 2} width={2} height={star.group === "constellation" ? 4 : 2} opacity={star.opacity} style={{ "--star-delay": `${star.delaySeconds}s` } as CSSProperties} />)}</g>
      <g clipPath={`url(#${clipId})`}>
        <rect className="planet-map-ocean" x={map.surface.minX} y={map.surface.minY} width={map.surface.maxX - map.surface.minX} height={map.surface.maxY - map.surface.minY} fill="url(#planet-ocean-pixels)" />
        <g className="planet-water-shimmer" aria-hidden="true" pointerEvents="none">{Array.from({length:36},(_,index)=>{
          const x=map.surface.minX+((index*137+29)%997)/997*(map.surface.maxX-map.surface.minX);
          const y=map.surface.minY+((index*211+71)%991)/991*(map.surface.maxY-map.surface.minY);
          return <path key={index} d={`M${x} ${y}h${3+index%4}m2 0h2`} stroke="#c3dfbc" strokeWidth="1" style={{animationDelay:`-${index*.73}s`}} />;
        })}</g>
        <g className="planet-coast" aria-hidden="true" transform={terrainTransform}>{terrainGeometry && terrainRasters && terrainRasters.revision === atlasRevision && <AtlasTerrainLayer cells={terrainGeometry.coast} rasters={terrainRasters.layers.get("coast")!} />}</g>
        <g className="planet-countries">{projectedAtlas?.countries.map(country => <g key={country.id} className="planet-country" data-country-id={country.id}
          style={{ display: visibleCountries.some(visible => visible.id === country.id) ? undefined : "none" }} transform={terrainTransform}>
          {terrainGeometry && terrainRasters && terrainRasters.revision === atlasRevision && <AtlasTerrainLayer cells={terrainGeometry.countries.get(country.id)!} rasters={terrainRasters.layers.get(country.id)!} color={country.color} />}
          <PlanetMiniatures country={country} scales={miniatureScales} />
        </g>)}</g>
        <g className="planet-city-targets">{cityTargets.map(city => <g key={city.id} role="button" tabIndex={city.center.x>=visibleViewport.minX&&city.center.x<=visibleViewport.minX+visibleViewport.width&&city.center.y>=visibleViewport.minY&&city.center.y<=visibleViewport.minY+visibleViewport.height?0:-1}
          aria-hidden={city.center.x<visibleViewport.minX||city.center.x>visibleViewport.minX+visibleViewport.width||city.center.y<visibleViewport.minY||city.center.y>visibleViewport.minY+visibleViewport.height}
          data-city-id={city.id} data-country-id={city.countryId} data-selecting={selectingCityId===city.id} aria-label={`Открыть город ${city.name}`}
          onPointerEnter={() => { const country=map.countries.find(c=>c.id===city.countryId); if(country) scheduleCityIntent(city.countryId,city.id,country.worldVersion); }}
          onFocus={() => { const country=map.countries.find(c=>c.id===city.countryId); if(country) scheduleCityIntent(city.countryId,city.id,country.worldVersion); }}
          onPointerLeave={cancelCityIntent} onBlur={cancelCityIntent}
          onClick={() => focusOrSelectCity(city)} onKeyDown={event => { if(event.key==='Enter' || event.key===' ') {event.preventDefault();event.stopPropagation();void selectCity(city);} }}>
          <circle cx={city.center.x} cy={city.center.y} r={Math.max(12,Math.min(45,city.radius))} fill="transparent" />
          {labelDetail === "COUNTRIES" && <path d={`M${city.center.x-2} ${city.center.y-2}h4v4h-4z`} fill="#ebd396" pointerEvents="none" />}
        </g>)}</g>
        <g className="planet-railways" aria-hidden="true">{transportPaths.rails.map(route=><g key={route.id}>
          <path d={route.path} fill="none" stroke="#293c39" strokeWidth="2" />
          <path d={route.path} fill="none" stroke="#b5b69a" strokeWidth=".8" />
          <path d={route.path} fill="none" stroke="#293c39" strokeWidth="3" strokeDasharray=".7 3" />
        </g>)}</g>
        <ScheduledAtlasTrains routes={transportPaths.rails} scale={camera.zoom} />
        <AtlasShips routes={transportPaths.ships} scale={camera.zoom} />
        <ScheduledAtlasFlights routes={activeRoutes} />
        <g className="planet-clouds" aria-hidden="true">{map.clouds.map((cloud, index) => <g key={cloud.id} transform={`translate(${cloud.x} ${cloud.y}) scale(${cloud.scale})`} style={{ "--cloud-duration": `${cloud.durationSeconds}s`, "--cloud-delay": `${cloud.delaySeconds}s`, "--cloud-drift-x": `${Math.sin(cloud.delaySeconds) * 20}px`, "--cloud-drift-y": `${Math.cos(cloud.durationSeconds) * 9}px` } as CSSProperties}><PlanetCloud variant={index} /></g>)}</g>
      </g>
      <ellipse className="planet-atmosphere" cx={(map.surface.minX+map.surface.maxX)/2} cy={(map.surface.minY+map.surface.maxY)/2} rx={(map.surface.maxX-map.surface.minX)/2} ry={(map.surface.maxY-map.surface.minY)/2} fill="url(#planet-atmosphere)" pointerEvents="none" aria-hidden="true" />
      <g className="planet-fog-pixels" aria-hidden="true">{map.edgeFog.filter(fog => fog.point.x + fog.size >= visibleViewport.minX && fog.point.x - fog.size <= visibleViewport.minX + visibleViewport.width && fog.point.y + fog.size >= visibleViewport.minY && fog.point.y - fog.size <= visibleViewport.minY + visibleViewport.height).map((fog) => <rect key={fog.id} x={fog.point.x - fog.size / 2} y={fog.point.y - fog.size / 2} width={fog.size} height={fog.size} opacity={fog.opacity} />)}</g>
      <g className="planet-country-labels" pointerEvents="none">{countryLabels.map(label => {
        const country = visibleCountries.find(country => country.id === label.countryId)!;
        return <g key={label.countryId} className="planet-country-label" data-country-id={label.countryId} aria-label={country.name}>
          <title>{country.name}</title>
          <rect x={label.x} y={label.y} width={label.width} height={label.height} rx="2" fill="#183731" stroke="#b8a572" />
          <text x={label.x+label.width/2} y={label.y+13*labelScale} textAnchor="middle" fill="#f1e5bd" fontSize={9*labelScale} fontWeight="700">{country.name.length > 25 ? `${country.name.slice(0,24)}…` : country.name}</text>
        </g>;
      })}</g>
      <g className="planet-city-labels">{labels.map(label => <g key={label.id}>
        <path d={`M${label.x+label.width/2} ${label.y+label.height}L${label.center.x} ${label.center.y}`} stroke="#cdbd83" strokeWidth="1" opacity=".6" pointerEvents="none" />
        <g className="planet-city-label" data-city-id={label.id} data-country-id={label.countryId} data-selecting={selectingCityId===label.id}
          role="button" tabIndex={0} aria-label={`Открыть город ${label.name}`} onClick={()=>void selectCity(label)}
          onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();void selectCity(label);}}}>
          <rect x={label.x} y={label.y} width={label.width} height={label.height} rx="2" fill="#183731" stroke="#b8a572" />
          <text x={label.x+label.width/2} y={label.y+17*labelScale} textAnchor="middle" fill="#f1e5bd" fontSize={11*labelScale} fontWeight="700">{label.name.length>22?`${label.name.slice(0,21)}…`:label.name}</text>
        </g>
      </g>)}</g>
    </svg>
    {(readyRevision !== atlasRevision || assetError) && <div className="planet-texture-loading atlas-state" role={assetError ? "alert" : "status"}>
      <span>{assetError || "Готовим ландшафт планеты…"}</span>
      {assetError && <button type="button" onClick={() => setAssetAttempt(value => value + 1)}>Повторить</button>}
    </div>}
    {error && <div className="planet-refresh-warning" role="alert">{error}</div>}
  </div>;
}
