import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { gameAssetUrl, getBuilding, PROP_CATALOG, TERRAIN_SPRITES, type BuildingCatalogEntry } from "../../shared/catalog";
import type { Cell, RealtimeEvent, TerrainKind } from "../../shared/contracts";
import {
  COUNTRY_ATLAS_SCHEMA_VERSION,
  type CountryAtlasCityDto,
  type CountryAtlasDistrictDto,
  type CountryAtlasDto,
} from "../../shared/country-atlas-contract";
import { seededAtlasCutoutTerrain, seededAtlasMacroTerrain } from "../../shared/country-atlas-terrain";
import { atlasEdgePoint, buildAtlasFlightLane, countryAirportAnchor } from "../../shared/atlas-motion-scene";
import { countryAtlasEventBatchImpact, patchCountryAtlasTaskProgress } from "../../shared/country-atlas-events";
import {
  COUNTRY_ATLAS_BASE_HEIGHT_CELLS,
  COUNTRY_ATLAS_BASE_WIDTH_CELLS,
  fixedCountryAtlasLabelBounds,
  fitCountryAtlasBoundsToAspect,
} from "../../shared/country-atlas-viewport";
import { api } from "../api";
import {
  advanceAtlasEntryHysteresis,
  advanceAtlasZoomBoundary,
  atlasTargetCoverage,
  continuousAtlasZoom,
  initialAtlasEntryHysteresis,
  initialAtlasZoomBoundary,
  mapAtlasFocusPoint,
} from "../atlas-zoom-navigation";
import { atlasBuildingPresentation } from "../country-atlas-presentation";
import { AtlasAircraft } from "./AtlasAircraft";
import { AtlasOverviewCard, cityOverviewCardModel } from "./AtlasOverviewCard";

const CELL = 8;
const MIN_COUNTRY_ZOOM = 1;
const MAX_COUNTRY_ZOOM = 5;
const CITY_ENTRY_COVERAGE = .72;
const ATLAS_CACHE_PREFIX = `tasktopia:country-atlas:v${COUNTRY_ATLAS_SCHEMA_VERSION}:`;
const DISTRICT_STATUS_LABEL: Record<CountryAtlasDistrictDto["status"], string> = {
  PLANNED: "Запланирован",
  ACTIVE: "Активный район",
  COMPLETED: "Завершён",
  ABANDONED: "Остановлен",
};

function terrainPatternId(terrain: TerrainKind, variant: number): string {
  return `atlas-terrain-${terrain.toLowerCase().replaceAll("_", "-")}-${variant}`;
}

function readCachedAtlas(countryId: string): CountryAtlasDto | null {
  try {
    const raw = window.sessionStorage.getItem(`${ATLAS_CACHE_PREFIX}${countryId}`);
    if (!raw) return null;
    const cached = JSON.parse(raw) as CountryAtlasDto;
    return cached.schemaVersion === COUNTRY_ATLAS_SCHEMA_VERSION ? cached : null;
  } catch {
    return null;
  }
}

function writeCachedAtlas(countryId: string, atlas: CountryAtlasDto): void {
  try { window.sessionStorage.setItem(`${ATLAS_CACHE_PREFIX}${countryId}`, JSON.stringify(atlas)); } catch { /* Optional fast path. */ }
}

function cutoutBoundary(cells: Cell[]): string {
  const occupied = new Set(cells.map((cell) => `${cell.x}:${cell.y}`));
  const lines: string[] = [];
  for (const cell of cells) {
    const left = cell.x * CELL;
    const top = cell.y * CELL;
    const right = left + CELL;
    const bottom = top + CELL;
    if (!occupied.has(`${cell.x}:${cell.y - 1}`)) lines.push(`M${left} ${top}H${right}`);
    if (!occupied.has(`${cell.x + 1}:${cell.y}`)) lines.push(`M${right} ${top}V${bottom}`);
    if (!occupied.has(`${cell.x}:${cell.y + 1}`)) lines.push(`M${right} ${bottom}H${left}`);
    if (!occupied.has(`${cell.x - 1}:${cell.y}`)) lines.push(`M${left} ${bottom}V${top}`);
  }
  return lines.join("");
}

function districtSeparatorBoundary(districts: CountryAtlasDistrictDto[]): string {
  const owners = new Map<string, string>();
  for (const district of districts) {
    for (const cell of district.displayCells) owners.set(`${cell.x}:${cell.y}`, district.id);
  }

  const lines: string[] = [];
  for (const district of districts) {
    for (const cell of district.displayCells) {
      const rightOwner = owners.get(`${cell.x + 1}:${cell.y}`);
      if (rightOwner && rightOwner !== district.id) {
        const x = (cell.x + 1) * CELL;
        lines.push(`M${x} ${cell.y * CELL}V${(cell.y + 1) * CELL}`);
      }
      const bottomOwner = owners.get(`${cell.x}:${cell.y + 1}`);
      if (bottomOwner && bottomOwner !== district.id) {
        const y = (cell.y + 1) * CELL;
        lines.push(`M${cell.x * CELL} ${y}H${(cell.x + 1) * CELL}`);
      }
    }
  }
  return lines.join("");
}

function AtlasBuildingGlyph({ entry, identity, scale, groundX, groundY }: {
  entry: BuildingCatalogEntry;
  identity: string;
  scale: CountryAtlasCityDto["scale"];
  groundX: number;
  groundY: number;
}) {
  const marker = atlasBuildingPresentation(entry.category, entry.spriteSize, {
    identity,
    assetKey: entry.key,
    projectedFootprint: {
      width: entry.footprint.width * CELL * scale,
      height: entry.footprint.height * CELL * scale,
    },
  });
  const left = groundX - marker.width / 2;
  const top = groundY - marker.height;
  const bodyTop = top + marker.roofDepth;
  const bodyHeight = marker.height - marker.roofDepth;
  const detailTop = bodyTop + Math.max(2.5, bodyHeight * 0.32);
  const windowCount = Math.max(2, Math.min(4, Math.floor(marker.width / 3.2)));
  const windowGap = marker.width / (windowCount + 1);
  const body = marker.profile === "courtyard"
    ? <path d={`M${left} ${bodyTop}H${left + marker.width * 0.36}V${bodyTop + 2}H${left + marker.width * 0.64}V${bodyTop}H${left + marker.width}V${groundY}H${left}Z`} fill={marker.facade} stroke={marker.outline} strokeWidth=".75" />
    : <rect x={left} y={bodyTop} width={marker.width} height={bodyHeight} fill={marker.facade} stroke={marker.outline} strokeWidth=".75" />;
  const roof = marker.profile === "gable"
    ? <path d={`M${left - marker.sideDepth} ${bodyTop}L${groundX} ${top - 0.5}L${left + marker.width + marker.sideDepth} ${bodyTop}Z`} fill={marker.roof} stroke={marker.outline} strokeWidth=".75" />
    : marker.profile === "stepped"
      ? <><rect x={left - marker.sideDepth} y={bodyTop - 1.25} width={marker.width + marker.sideDepth * 2} height="1.5" fill={marker.roof} stroke={marker.outline} strokeWidth=".65" /><rect x={left + marker.width * 0.23} y={top - 0.5} width={marker.width * 0.54} height={marker.roofDepth} fill={marker.roof} stroke={marker.outline} strokeWidth=".65" /></>
      : marker.profile === "courtyard"
        ? <path d={`M${left - marker.sideDepth} ${bodyTop}V${top}H${left + marker.width * 0.38}V${top + 1.5}H${left + marker.width * 0.62}V${top}H${left + marker.width + marker.sideDepth}V${bodyTop}Z`} fill={marker.roof} stroke={marker.outline} strokeWidth=".75" />
        : <rect x={left - marker.sideDepth} y={top} width={marker.width + marker.sideDepth * 2} height={marker.roofDepth} fill={marker.roof} stroke={marker.outline} strokeWidth=".75" />;

  return <g data-atlas-profile={marker.profile} opacity=".9">
    <rect x={left + 1} y={groundY} width={marker.width} height="1.25" fill="#173432" opacity=".28" />
    {body}
    {roof}
    {Array.from({ length: windowCount }, (_, index) => <rect
      key={index}
      x={left + windowGap * (index + 1) - 0.6}
      y={detailTop}
      width="1.2"
      height={entry.category === "HIGHRISE" ? Math.max(2, bodyHeight * 0.42) : 2}
      fill={marker.window}
    />)}
    {entry.category !== "HIGHRISE" && bodyHeight >= 8 && <path d={`M${left + 1.5} ${groundY - 4}H${left + marker.width - 1.5}`} stroke={marker.accent} strokeWidth=".7" opacity=".7" />}
    <rect x={groundX - marker.doorWidth / 2} y={groundY - 3.5} width={marker.doorWidth} height="3.5" fill="#29494b" />
  </g>;
}

function AtlasCityLabel({ city, sceneScale, onSelect }: { city: CountryAtlasCityDto; sceneScale: number; onSelect: () => void }) {
  const bounds = fixedCountryAtlasLabelBounds(city.labelAnchor, city.labelBounds.maxY);
  const minX = bounds.minX;
  const maxY = bounds.maxY;
  const minY = bounds.minY;
  const model = cityOverviewCardModel(city);
  return <g className="atlas-city-label">
    <path d={`M${city.labelAnchor.x * CELL} ${(maxY + 1) * CELL}h8l-4 5Z`} className="atlas-city-label-tab" />
    <AtlasOverviewCard
      transform={`translate(${minX * CELL} ${minY * CELL}) scale(${sceneScale})`}
      model={model}
      width={132}
      height={34}
      ariaLabel={`Открыть город ${city.name}, ${model.metrics[0]!.value} зданий в работе, прогресс ${model.progress}%`}
      onSelect={onSelect}
    />
  </g>;
}

export function CountryAtlasCanvas({ countryId, activeCityId, events, onEventsProcessed, onCitySelect, onDistrictSelect, onCityHover, onZoomOut }: {
  countryId: string;
  activeCityId?: string;
  events: RealtimeEvent[];
  onEventsProcessed: (eventId: number) => void;
  onCitySelect: (city: CountryAtlasCityDto, focus?: { x: number; y: number }, sourcePoint?: { x: number; y: number }) => void;
  onDistrictSelect: (city: CountryAtlasCityDto, district: CountryAtlasDistrictDto) => void;
  onCityHover: (city: CountryAtlasCityDto | null) => void;
  onZoomOut: () => void;
}) {
  const [atlas, setAtlas] = useState<CountryAtlasDto | null>(() => readCachedAtlas(countryId));
  const [error, setError] = useState("");
  const [hostAspect, setHostAspect] = useState(16 / 9);
  const [camera, setCamera] = useState<{ zoom: number; center: { x: number; y: number } | null }>({ zoom: 1, center: null });
  const hostRef = useRef<HTMLDivElement>(null);
  const processedEventIdRef = useRef(0);
  const [hoveredDistrict, setHoveredDistrict] = useState<{ cityId: string; districtId: string } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoomBoundary = useRef(initialAtlasZoomBoundary());
  const entryHysteresis = useRef(initialAtlasEntryHysteresis());
  const scheduleDistrictHover = (next: { cityId: string; districtId: string }, immediate = false) => {
    if (hoveredDistrict?.cityId === next.cityId && hoveredDistrict.districtId === next.districtId) return;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    if (immediate) {
      setHoveredDistrict(next);
      return;
    }
    hoverTimer.current = setTimeout(() => {
      setHoveredDistrict(next);
      hoverTimer.current = null;
    }, 220);
  };
  const clearDistrictHover = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    setHoveredDistrict(null);
  };
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setAtlas(readCachedAtlas(countryId));
    void api<CountryAtlasDto>("/api/country-atlas", {
      signal: controller.signal,
      cache: "no-cache",
      headers: { "Cache-Control": "no-cache" },
    })
      .then((next) => { setAtlas(next); writeCachedAtlas(countryId, next); })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Не удалось собрать карту страны");
      });
    return () => controller.abort();
  }, [countryId]);
  useEffect(() => {
    if (!atlas) return;
    const pending = events
      .filter((event) => event.countryId === countryId && event.id > processedEventIdRef.current)
      .sort((left, right) => left.id - right.id);
    if (pending.length === 0) return;
    const latestEventId = pending.at(-1)!.id;
    const batchImpact = countryAtlasEventBatchImpact(pending);
    if (batchImpact !== "STRUCTURE") {
      setAtlas((current) => {
        if (!current) return current;
        const updated = pending.reduce((snapshot, event) => patchCountryAtlasTaskProgress(snapshot, event), current);
        if (updated !== current) writeCachedAtlas(countryId, updated);
        return updated;
      });
      processedEventIdRef.current = latestEventId;
      onEventsProcessed(latestEventId);
      return;
    }
    const controller = new AbortController();
    void api<CountryAtlasDto>("/api/country-atlas", { signal: controller.signal, cache: "reload" })
      .then((next) => {
        setAtlas(next);
        writeCachedAtlas(countryId, next);
        setError("");
        processedEventIdRef.current = latestEventId;
        onEventsProcessed(latestEventId);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Не удалось обновить карту страны");
      });
    return () => controller.abort();
  }, [atlas, countryId, events, onEventsProcessed]);
  useEffect(() => () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const update = () => {
      const bounds = host.getBoundingClientRect();
      if (bounds.width > 0 && bounds.height > 0) setHostAspect(bounds.width / bounds.height);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    return () => observer.disconnect();
  }, [atlas]);

  const displayBounds = useMemo(() => atlas
    ? fitCountryAtlasBoundsToAspect(atlas.bounds, hostAspect, {
      width: COUNTRY_ATLAS_BASE_WIDTH_CELLS,
      height: COUNTRY_ATLAS_BASE_HEIGHT_CELLS,
    })
    : { minX: 0, minY: 0, maxX: 0, maxY: 0 }, [atlas, hostAspect]);

  const viewportBounds = useMemo(() => {
    const baseWidth = displayBounds.maxX - displayBounds.minX + 1;
    const baseHeight = displayBounds.maxY - displayBounds.minY + 1;
    const width = baseWidth / camera.zoom;
    const height = baseHeight / camera.zoom;
    const center = camera.center ?? {
      x: displayBounds.minX + baseWidth / 2,
      y: displayBounds.minY + baseHeight / 2,
    };
    return { minX: center.x - width / 2, minY: center.y - height / 2, maxX: center.x + width / 2, maxY: center.y + height / 2 };
  }, [camera, displayBounds]);
  const viewport = `${viewportBounds.minX * CELL} ${viewportBounds.minY * CELL} ${(viewportBounds.maxX - viewportBounds.minX) * CELL} ${(viewportBounds.maxY - viewportBounds.minY) * CELL}`;
  const sceneScale = (viewportBounds.maxX - viewportBounds.minX) * CELL / 1000;
  const seededTerrain = useMemo(() => {
    if (!atlas) return { macroTerrain: [], cutoutByCity: new Map<string, ReturnType<typeof seededAtlasCutoutTerrain>>() };
    return {
      macroTerrain: seededAtlasMacroTerrain(atlas.terrainSeed, displayBounds, atlas.cities),
      cutoutByCity: new Map(atlas.cities.map((city) => [city.id, seededAtlasCutoutTerrain(atlas.terrainSeed, city)])),
    };
  }, [atlas, displayBounds]);
  const terrainPatterns = useMemo(() => {
    if (!atlas) return [];
    const combinations = new Map<string, { terrain: TerrainKind; variant: number }>();
    for (const tile of seededTerrain.macroTerrain) combinations.set(terrainPatternId(tile.terrain, tile.variant), tile);
    for (const city of atlas.cities) {
      for (const tile of seededTerrain.cutoutByCity.get(city.id) ?? []) combinations.set(terrainPatternId(tile.terrain, tile.variant), tile);
    }
    return [...combinations.values()];
  }, [atlas, seededTerrain]);
  const airportAnchors = useMemo(() => new Map((atlas?.cities ?? []).flatMap((city) => {
    const anchor = countryAirportAnchor(city);
    return anchor ? [[city.id, { x: (anchor.x + .5) * CELL, y: (anchor.y + .5) * CELL }] as const] : [];
  })), [atlas]);
  const domesticFlightLanes = useMemo(() => {
    if (!atlas || airportAnchors.size < 2) return [];
    const entries = [...airportAnchors.entries()].sort(([left], [right]) => left.localeCompare(right));
    const existing = new Set(atlas.connections.flatMap((connection) => [
      `${connection.fromCityId}:${connection.toCityId}`,
      `${connection.toCityId}:${connection.fromCityId}`,
    ]));
    return entries.flatMap(([fromId, from], index) => {
      const [toId, to] = entries[(index + 1) % entries.length]!;
      if (fromId === toId || existing.has(`${fromId}:${toId}`)) return [];
      return [buildAtlasFlightLane(`country-domestic:${fromId}:${toId}`, from, to, atlas.terrainSeed, index % 4)];
    }).slice(0, 16);
  }, [airportAnchors, atlas]);
  const hoveredDistrictInfo = useMemo(() => {
    if (!atlas || !hoveredDistrict) return null;
    const city = atlas.cities.find((entry) => entry.id === hoveredDistrict.cityId);
    const district = city?.districts.find((entry) => entry.id === hoveredDistrict.districtId);
    if (!city || !district) return null;
    const buildings = city.buildings.filter((building) => building.districtId === district.id);
    const atlasMidpoint = (displayBounds.minX + displayBounds.maxX) / 2;
    const opensLeft = city.atlasCenter.x > atlasMidpoint;
    const tooltipAnchorX = opensLeft ? city.atlasBounds.minX - 2 : city.atlasBounds.maxX + 2;
    const x = (tooltipAnchorX - displayBounds.minX) / (displayBounds.maxX - displayBounds.minX + 1) * 100;
    const y = (district.atlasCenter.y - displayBounds.minY) / (displayBounds.maxY - displayBounds.minY + 1) * 100;
    return { city, district, buildings: buildings.length, progress: district.progress, x, y, opensLeft };
  }, [atlas, displayBounds, hoveredDistrict]);
  const atmosphereClouds = useMemo(() => {
    if (!atlas) return [];
    const width = (displayBounds.maxX - displayBounds.minX + 1) * CELL;
    const height = (displayBounds.maxY - displayBounds.minY + 1) * CELL;
    return Array.from({ length: Math.max(5, Math.min(12, atlas.cities.length + 4)) }, (_, index) => {
      const value = Math.abs((atlas.terrainSeed ^ Math.imul(index + 1, 2_654_435_761)) >>> 0);
      return {
        id: `country-cloud-${index}`,
        x: displayBounds.minX * CELL + (index + .5) / Math.max(1, Math.max(5, Math.min(12, atlas.cities.length + 4))) * width,
        y: displayBounds.minY * CELL + (value >>> 9) % Math.max(1, Math.floor(height)),
        scale: .7 + (value % 5) * .1,
        duration: 18 + value % 17,
        delay: -(value % 31),
        variant: value % 8,
        driftX: index % 3 === 0 ? -44 : 34 + value % 28,
        driftY: index % 4 === 0 ? 20 : index % 4 === 1 ? -18 : 5,
      };
    });
  }, [atlas, displayBounds]);
  const countryEdgeFog = useMemo(() => {
    if (!atlas) return [];
    const centerX = (displayBounds.minX + displayBounds.maxX + 1) * CELL / 2;
    const centerY = (displayBounds.minY + displayBounds.maxY + 1) * CELL / 2;
    const radiusX = (displayBounds.maxX - displayBounds.minX + 1) * CELL / 2;
    const radiusY = (displayBounds.maxY - displayBounds.minY + 1) * CELL / 2;
    return Array.from({ length: 108 }, (_, index) => {
      const value = Math.abs((atlas.terrainSeed ^ Math.imul(index + 11, 1_103_515_245)) >>> 0);
      const depth = index % 3;
      const angle = Math.PI * 2 * index / 108 + ((value % 9) - 4) * .008;
      return {
        id: `country-edge-fog-${index}`,
        x: centerX + Math.cos(angle) * radiusX * (.9 + depth * .075),
        y: centerY + Math.sin(angle) * radiusY * (.9 + depth * .075),
        size: 12 + value % 3 * 8,
        opacity: .14 + depth * .16 + (value % 13) / 100,
      };
    });
  }, [atlas, displayBounds]);

  if (error && !atlas) return <div className="atlas-state" role="alert"><strong>Карта страны недоступна</strong><span>{error}</span></div>;
  if (!atlas) return <div className="atlas-state" role="status"><i /><span>Сжимаем расстояния между городами…</span></div>;

  return <div ref={hostRef} className="country-atlas" data-country-atlas-cities={atlas.cities.length} onWheel={(event) => {
    event.preventDefault();
    const direction = event.deltaY < 0 ? "IN" : "OUT";
    const bounds = hostRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const focus = {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width))),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / Math.max(1, bounds.height))),
    };
    const pointer = {
      x: viewportBounds.minX + focus.x * (viewportBounds.maxX - viewportBounds.minX),
      y: viewportBounds.minY + focus.y * (viewportBounds.maxY - viewportBounds.minY),
    };
    const nextZoom = continuousAtlasZoom(camera.zoom, event.deltaY, { min: MIN_COUNTRY_ZOOM, max: MAX_COUNTRY_ZOOM });
    const atMinimum = direction === "OUT" && camera.zoom <= MIN_COUNTRY_ZOOM + .001 && nextZoom <= MIN_COUNTRY_ZOOM + .001;
    const boundary = advanceAtlasZoomBoundary(zoomBoundary.current, { at: performance.now(), atBoundary: atMinimum, direction });
    zoomBoundary.current = boundary.state;
    if (boundary.triggered) { onZoomOut(); return; }
    const nextWidth = (displayBounds.maxX - displayBounds.minX + 1) / nextZoom;
    const nextHeight = (displayBounds.maxY - displayBounds.minY + 1) / nextZoom;
    const nextCenter = {
      x: pointer.x + (.5 - focus.x) * nextWidth,
      y: pointer.y + (.5 - focus.y) * nextHeight,
    };
    const nextViewport = {
      minX: nextCenter.x - nextWidth / 2,
      minY: nextCenter.y - nextHeight / 2,
      maxX: nextCenter.x + nextWidth / 2,
      maxY: nextCenter.y + nextHeight / 2,
    };
    const city = [...atlas.cities].sort((left, right) =>
      Math.hypot(left.atlasCenter.x - pointer.x, left.atlasCenter.y - pointer.y)
      - Math.hypot(right.atlasCenter.x - pointer.x, right.atlasCenter.y - pointer.y))[0];
    const coverage = city ? atlasTargetCoverage(city.atlasBounds, nextViewport) : 0;
    const entry = advanceAtlasEntryHysteresis(entryHysteresis.current, {
      direction,
      zoom: nextZoom,
      rearmZoom: 1.15,
      coverage,
      enterCoverage: CITY_ENTRY_COVERAGE,
    });
    entryHysteresis.current = entry.state;
    setCamera({ zoom: nextZoom, center: nextCenter });
    if (entry.triggered && city) onCitySelect(city, focus, mapAtlasFocusPoint(pointer, city.atlasBounds, city.sourceBounds));
  }} onPointerMove={(event) => {
    const target = event.target instanceof Element ? event.target.closest<SVGGElement>(".atlas-city") : null;
    const city = target ? atlas.cities.find((entry) => entry.id === target.dataset.cityId) : undefined;
    onCityHover(city ?? null);
  }}>
    <svg viewBox={viewport} role="group" aria-label={`Карта страны: ${atlas.cities.length} городов`} preserveAspectRatio="xMidYMin meet">
      <defs>
        {terrainPatterns.map(({ terrain, variant }) => {
          const sprites = TERRAIN_SPRITES[terrain] ?? TERRAIN_SPRITES.GRASS!;
          const sprite = sprites[Math.abs(variant) % sprites.length] ?? sprites[0]!;
          return <pattern key={terrainPatternId(terrain, variant)} id={terrainPatternId(terrain, variant)} width={CELL} height={CELL} patternUnits="userSpaceOnUse">
            <image href={gameAssetUrl(sprite)} width={CELL} height={CELL} className="atlas-pixel" />
          </pattern>;
        })}
      </defs>
      <rect x={displayBounds.minX * CELL} y={displayBounds.minY * CELL} width={(displayBounds.maxX - displayBounds.minX + 1) * CELL} height={(displayBounds.maxY - displayBounds.minY + 1) * CELL} className="atlas-ground" />
      <g className="atlas-macro-terrain" aria-hidden="true">
        {seededTerrain.macroTerrain.map((tile) => <rect
          key={tile.id}
          x={tile.atlasOrigin.x * CELL}
          y={tile.atlasOrigin.y * CELL}
          width={tile.widthCells * CELL}
          height={tile.heightCells * CELL}
          fill={`url(#${terrainPatternId(tile.terrain, tile.variant)})`}
          data-terrain={tile.terrain}
        />)}
      </g>

      {atlas.cities.map((city) => <g key={city.id} className="atlas-city" data-city-id={city.id} data-active={city.id === activeCityId ? "true" : "false"} onClick={() => onCitySelect(city)} onPointerLeave={clearDistrictHover}>
        <g aria-hidden="true">
          <g className="atlas-city-cutout-shadow">
            {city.cutoutMask.map((cell) => <rect key={`${cell.x}:${cell.y}`} x={cell.x * CELL + 3} y={cell.y * CELL + 4} width={CELL} height={CELL} />)}
          </g>
          <path d={cutoutBoundary(city.cutoutMask)} className="atlas-city-cutout-outline" />
          <path d={cutoutBoundary(city.cutoutMask)} className="atlas-city-cutout-highlight" />
          <g className="atlas-city-cutout-ground">
            {(seededTerrain.cutoutByCity.get(city.id) ?? []).map((tile) => <rect key={`${tile.atlasCell.x}:${tile.atlasCell.y}`} x={tile.atlasCell.x * CELL} y={tile.atlasCell.y * CELL} width={CELL} height={CELL} fill={`url(#${terrainPatternId(tile.terrain, tile.variant)})`} />)}
          </g>
        </g>
        <g className="atlas-districts">
          {city.districts.map((district) => {
            const hovered = hoveredDistrict?.districtId === district.id;
            const progressOpacity = (0.1 + district.progress * 0.0044).toFixed(3);
            return <g
              key={district.id}
              className="atlas-district"
              data-status={district.status}
              data-hovered={hovered ? "true" : "false"}
              data-progress={district.progress}
              style={{ "--atlas-progress-opacity": progressOpacity } as CSSProperties}
              role="button"
              tabIndex={0}
              aria-label={`${district.name}, ${DISTRICT_STATUS_LABEL[district.status]}`}
              onPointerEnter={() => scheduleDistrictHover({ cityId: city.id, districtId: district.id })}
              onFocus={() => scheduleDistrictHover({ cityId: city.id, districtId: district.id }, true)}
              onBlur={clearDistrictHover}
              onClick={(event) => { event.stopPropagation(); onDistrictSelect(city, district); }}
              onKeyDown={(event) => {
                if (event.key === "Escape") clearDistrictHover();
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  onDistrictSelect(city, district);
                }
              }}
            >
              <g className="atlas-district-fill" aria-hidden="true">
                {district.displayCells.map((cell) => <rect
                  key={`${cell.x}:${cell.y}`}
                  x={cell.x * CELL}
                  y={cell.y * CELL}
                  width={CELL}
                  height={CELL}
                  fill={district.color}
                />)}
              </g>
              <path d={cutoutBoundary(district.displayCells)} className="atlas-district-state-outline" style={{ stroke: district.color }} aria-hidden="true" />
            </g>;
          })}
          <path d={districtSeparatorBoundary(city.districts)} className="atlas-district-separators" aria-hidden="true" />
        </g>
        <g className="atlas-local-infrastructure" aria-hidden="true">
          {city.features.filter((feature) => feature.assetKind === "AREA" && feature.kind !== "AIRPORT").flatMap((feature) => feature.atlasFootprint.map((cell) => <rect
            key={`${feature.id}:${cell.x}:${cell.y}`}
            x={cell.x * CELL} y={cell.y * CELL} width={CELL} height={CELL}
            className={feature.assetKey === "urban-grove" ? "atlas-grove-cell" : "atlas-park-cell"}
          />))}
          {city.roads.map((road, index) => <rect key={`${road.sourceCell.x}:${road.sourceCell.y}:${index}`} x={road.atlasCell.x * CELL + 2} y={road.atlasCell.y * CELL + 2} width={CELL - 4} height={CELL - 4} className="atlas-road-cell" />)}
          {city.surfaces.map((surface, index) => <rect key={`${surface.sourceCell.x}:${surface.sourceCell.y}:${index}`} x={surface.atlasCell.x * CELL + 2.75} y={surface.atlasCell.y * CELL + 2.75} width={CELL - 5.5} height={CELL - 5.5} className={`atlas-surface-cell atlas-surface-${surface.kind.toLowerCase()}`} />)}
        </g>
        <g className="atlas-airport-markers" aria-label={`Аэропорт города ${city.name}`}>
          {airportAnchors.has(city.id) && <g transform={`translate(${airportAnchors.get(city.id)!.x} ${airportAnchors.get(city.id)!.y}) scale(${sceneScale})`}>
            <rect x="-5" y="-5" width="10" height="10" rx="1" />
            <path d="M-2 0h1l1-2h1L.5 0H2v1H.5L1 3H0l-1-2h-1Z" />
          </g>}
        </g>
        <g className="atlas-buildings">
          {[...city.buildings].sort((left, right) => left.atlasOrigin.y - right.atlasOrigin.y || left.atlasOrigin.x - right.atlasOrigin.x).map((building) => {
            const entry = getBuilding(building.buildingType);
            const scale = city.scale;
            const groundX = building.atlasOrigin.x * CELL + entry.footprint.width * CELL * scale / 2;
            const groundY = building.atlasOrigin.y * CELL + entry.footprint.height * CELL * scale;
            if (building.visualKind === "PARK") {
              if (building.atlasFootprint.length === 0) return null;
              const minX = Math.min(...building.atlasFootprint.map((cell) => cell.x)) * CELL;
              const minY = Math.min(...building.atlasFootprint.map((cell) => cell.y)) * CELL;
              const width = (Math.max(...building.atlasFootprint.map((cell) => cell.x)) - Math.min(...building.atlasFootprint.map((cell) => cell.x)) + 1) * CELL;
              const height = (Math.max(...building.atlasFootprint.map((cell) => cell.y)) - Math.min(...building.atlasFootprint.map((cell) => cell.y)) + 1) * CELL;
              const district = city.districts.find((entry) => entry.id === building.districtId);
              return <g key={building.id} role="button" aria-label={`Открыть район ${district?.name ?? city.name}`} data-district-id={building.districtId} tabIndex={0}
                onPointerEnter={() => scheduleDistrictHover({ cityId: city.id, districtId: building.districtId })}
                onClick={(event) => { event.stopPropagation(); if (district) onDistrictSelect(city, district); else onCitySelect(city); }}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (district) onDistrictSelect(city, district); else onCitySelect(city); } }}>
                <rect x={minX} y={minY} width={width} height={height} fill="#638c4d" stroke="#263945" strokeWidth="2" />
                <path d={`M ${minX + width / 2} ${minY} V ${minY + height} M ${minX} ${minY + height / 2} H ${minX + width}`} stroke="#b7b8a2" strokeWidth="2" />
              </g>;
            }
            const district = city.districts.find((entry) => entry.id === building.districtId);
            return <g
              key={building.id}
              className="atlas-building"
              role="button"
              aria-label={`Открыть район ${district?.name ?? city.name}`}
              data-district-id={building.districtId}
              tabIndex={0}
              onPointerEnter={() => scheduleDistrictHover({ cityId: city.id, districtId: building.districtId })}
              onClick={(event) => { event.stopPropagation(); if (district) onDistrictSelect(city, district); else onCitySelect(city); }}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (district) onDistrictSelect(city, district); else onCitySelect(city); } }}
            >
              <AtlasBuildingGlyph entry={entry} identity={building.id} scale={scale} groundX={groundX} groundY={groundY} />
            </g>;
          })}
          {city.features.filter((feature) => feature.assetKind !== "AREA").sort((left, right) => left.atlasOrigin.y - right.atlasOrigin.y).map((feature) => {
            if (feature.assetKind === "PROP") {
              const entry = PROP_CATALOG[feature.assetKey];
              if (!entry) return null;
              const groundX = feature.atlasOrigin.x * CELL + entry.footprint.width * CELL * city.scale / 2;
              const groundY = feature.atlasOrigin.y * CELL + entry.footprint.height * CELL * city.scale;
              const district = city.districts.find((candidate) => candidate.id === feature.districtId);
              return <image key={feature.id} href={entry.path} x={groundX - entry.anchor.x * city.scale} y={groundY - entry.anchor.y * city.scale} width={entry.size.width * city.scale} height={entry.size.height * city.scale} className="atlas-pixel atlas-feature" aria-hidden="true"
                onPointerEnter={() => { if (feature.districtId) scheduleDistrictHover({ cityId: city.id, districtId: feature.districtId }); }}
                onClick={(event) => { if (!district) return; event.stopPropagation(); onDistrictSelect(city, district); }} />;
            }
            const entry = getBuilding(feature.assetKey);
            const groundX = feature.atlasOrigin.x * CELL + entry.footprint.width * CELL * city.scale / 2;
            const groundY = feature.atlasOrigin.y * CELL + entry.footprint.height * CELL * city.scale;
            const district = city.districts.find((candidate) => candidate.id === feature.districtId);
            return <g key={feature.id} className="atlas-building atlas-feature" aria-hidden="true"
              onPointerEnter={() => { if (feature.districtId) scheduleDistrictHover({ cityId: city.id, districtId: feature.districtId }); }}
              onClick={(event) => { if (!district) return; event.stopPropagation(); onDistrictSelect(city, district); }}>
              <AtlasBuildingGlyph entry={entry} identity={feature.id} scale={city.scale} groundX={groundX} groundY={groundY} />
            </g>;
          })}
        </g>
        <AtlasCityLabel city={city} sceneScale={sceneScale} onSelect={() => onCitySelect(city)} />
      </g>)}
      <g className="atlas-air-routes" aria-hidden="true">
        {domesticFlightLanes.map((lane) => <g key={lane.id}>
          <path d={lane.path} className="atlas-air-route-line" />
          <AtlasAircraft path={lane.path} durationSeconds={lane.durationSeconds} delaySeconds={lane.delaySeconds} kind={lane.aircraftKind} size="planet" rotateWithPath visualScale={lane.altitudeScale * sceneScale} />
        </g>)}
        {atlas.connections.map((connection, index) => {
          const from = airportAnchors.get(connection.fromCityId);
          const to = airportAnchors.get(connection.toCityId);
          if (!from || !to) return null;
          const lane = buildAtlasFlightLane(`country:${connection.fromCityId}:${connection.toCityId}`, from, to, atlas.terrainSeed, index % 3);
          return <g key={`${connection.fromCityId}:${connection.toCityId}`}>
            <path d={lane.path} className="atlas-air-route-line" />
            <AtlasAircraft path={lane.path} durationSeconds={lane.durationSeconds} delaySeconds={lane.delaySeconds} kind={lane.aircraftKind} size="planet" rotateWithPath visualScale={lane.altitudeScale * sceneScale} />
          </g>;
        })}
        {atlas.cities.map((city, index) => {
          const end = airportAnchors.get(city.id);
          if (!end) return null;
          const pixelBounds = { minX: displayBounds.minX * CELL, minY: displayBounds.minY * CELL, maxX: displayBounds.maxX * CELL, maxY: displayBounds.maxY * CELL };
          const start = atlasEdgePoint(pixelBounds, end, atlas.terrainSeed + index);
          const lane = buildAtlasFlightLane(`country-edge:${city.id}`, start, end, atlas.terrainSeed, index % 4);
          return <g key={`edge-flight-${city.id}`}><path d={lane.path} className="atlas-air-route-line" /><AtlasAircraft path={lane.path} durationSeconds={lane.durationSeconds} delaySeconds={lane.delaySeconds} kind={lane.aircraftKind} size="planet" rotateWithPath visualScale={lane.altitudeScale * sceneScale} /></g>;
        })}
      </g>
      <g className="atlas-clouds" aria-hidden="true">
        {atmosphereClouds.map((cloud) => <g key={cloud.id} transform={`translate(${cloud.x} ${cloud.y}) scale(${cloud.scale})`} style={{ "--atlas-cloud-duration": `${cloud.duration}s`, "--atlas-cloud-delay": `${cloud.delay}s`, "--atlas-cloud-drift-x": `${cloud.driftX}px`, "--atlas-cloud-drift-y": `${cloud.driftY}px` } as CSSProperties}>
          <image href={gameAssetUrl(`atlas/clouds-v2/cloud-topdown-${cloud.variant + 1}.png`)} x="-32" y="-16" width="64" height="32" className="atlas-pixel" />
        </g>)}
      </g>
      <g className="country-world-fog" aria-hidden="true">
        {countryEdgeFog.map((fog) => <rect key={fog.id} x={fog.x - fog.size / 2} y={fog.y - fog.size / 2} width={fog.size} height={fog.size} opacity={fog.opacity} />)}
      </g>
    </svg>
    {hoveredDistrictInfo && <aside
      className={`atlas-district-tooltip${hoveredDistrictInfo.opensLeft ? " atlas-district-tooltip-left" : ""}`}
      role="tooltip"
      style={{ left: `${hoveredDistrictInfo.x}%`, top: `${Math.max(10, Math.min(90, hoveredDistrictInfo.y))}%` }}
      data-status={hoveredDistrictInfo.district.status}
    >
      <header><i style={{ backgroundColor: hoveredDistrictInfo.district.color }} /><span>{DISTRICT_STATUS_LABEL[hoveredDistrictInfo.district.status]}</span></header>
      <strong>{hoveredDistrictInfo.district.name}</strong>
      <p>{hoveredDistrictInfo.city.name}</p>
      <dl>
        <div><dt>Здания</dt><dd>{hoveredDistrictInfo.buildings}</dd></div>
        <div><dt>Прогресс</dt><dd>{hoveredDistrictInfo.progress}%</dd></div>
      </dl>
    </aside>}
  </div>;
}
