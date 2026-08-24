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
import { countryAtlasEventBatchImpact, patchCountryAtlasTaskProgress } from "../../shared/country-atlas-events";
import {
  COUNTRY_ATLAS_BASE_HEIGHT_CELLS,
  COUNTRY_ATLAS_BASE_WIDTH_CELLS,
  fixedCountryAtlasLabelBounds,
  fitCountryAtlasBoundsToAspect,
} from "../../shared/country-atlas-viewport";
import { api } from "../api";
import { advanceAtlasZoomBoundary, initialAtlasZoomBoundary } from "../atlas-zoom-navigation";
import { atlasBuildingPresentation } from "../country-atlas-presentation";
import { AtlasAircraft } from "./AtlasAircraft";
import { AtlasOverviewCard, cityOverviewCardModel } from "./AtlasOverviewCard";

const CELL = 8;
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

function atlasFlightPath(from: CountryAtlasCityDto, to: CountryAtlasCityDto, index: number): string {
  const start = { x: from.atlasCenter.x * CELL, y: from.atlasCenter.y * CELL };
  const end = { x: to.atlasCenter.x * CELL, y: to.atlasCenter.y * CELL };
  const curve = (index % 2 === 0 ? -1 : 1) * Math.max(22, Math.hypot(end.x - start.x, end.y - start.y) * .15);
  return `M${start.x} ${start.y} Q${(start.x + end.x) / 2} ${(start.y + end.y) / 2 + curve} ${end.x} ${end.y}`;
}

function AtlasCityLabel({ city, onSelect }: { city: CountryAtlasCityDto; onSelect: () => void }) {
  const bounds = fixedCountryAtlasLabelBounds(city.labelAnchor, city.labelBounds.maxY);
  const widthCells = bounds.maxX - bounds.minX + 1;
  const heightCells = bounds.maxY - bounds.minY + 1;
  const minX = bounds.minX;
  const maxY = bounds.maxY;
  const minY = bounds.minY;
  const width = widthCells * CELL;
  const model = cityOverviewCardModel(city);
  return <g className="atlas-city-label">
    <path d={`M${city.labelAnchor.x * CELL} ${(maxY + 1) * CELL}h8l-4 5Z`} className="atlas-city-label-tab" />
    <AtlasOverviewCard
      transform={`translate(${minX * CELL} ${minY * CELL})`}
      model={model}
      width={width}
      height={heightCells * CELL}
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
  onCitySelect: (city: CountryAtlasCityDto) => void;
  onDistrictSelect: (city: CountryAtlasCityDto, district: CountryAtlasDistrictDto) => void;
  onCityHover: (city: CountryAtlasCityDto | null) => void;
  onZoomOut: () => void;
}) {
  const [atlas, setAtlas] = useState<CountryAtlasDto | null>(() => readCachedAtlas(countryId));
  const [error, setError] = useState("");
  const [hostAspect, setHostAspect] = useState(16 / 9);
  const hostRef = useRef<HTMLDivElement>(null);
  const processedEventIdRef = useRef(0);
  const [hoveredDistrict, setHoveredDistrict] = useState<{ cityId: string; districtId: string } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoomBoundary = useRef(initialAtlasZoomBoundary());
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

  const viewport = useMemo(() => {
    if (!atlas) return "0 0 1 1";
    return `${displayBounds.minX * CELL} ${displayBounds.minY * CELL} ${(displayBounds.maxX - displayBounds.minX + 1) * CELL} ${(displayBounds.maxY - displayBounds.minY + 1) * CELL}`;
  }, [atlas, displayBounds]);
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
        x: displayBounds.minX * CELL + value % Math.max(1, Math.floor(width)),
        y: displayBounds.minY * CELL + (value >>> 9) % Math.max(1, Math.floor(height * .82)),
        scale: .7 + (value % 5) * .1,
        duration: 28 + value % 25,
      };
    });
  }, [atlas, displayBounds]);
  const countryEdgeFog = useMemo(() => {
    if (!atlas) return [];
    return Array.from({ length: 24 }, (_, index) => {
      const value = Math.abs((atlas.terrainSeed ^ Math.imul(index + 11, 1_103_515_245)) >>> 0);
      const side = index % 4;
      const along = 2 + value % 96;
      return {
        id: `country-edge-fog-${index}`,
        left: side === 0 ? along : side === 1 ? 98 : side === 2 ? along : 2,
        top: side === 0 ? 2 : side === 1 ? along : side === 2 ? 98 : along,
        scale: .75 + (value % 4) * .2,
      };
    });
  }, [atlas]);

  if (error && !atlas) return <div className="atlas-state" role="alert"><strong>Карта страны недоступна</strong><span>{error}</span></div>;
  if (!atlas) return <div className="atlas-state" role="status"><i /><span>Сжимаем расстояния между городами…</span></div>;

  return <div ref={hostRef} className="country-atlas" data-country-atlas-cities={atlas.cities.length} onWheel={(event) => {
    event.preventDefault();
    const direction = event.deltaY < 0 ? "IN" : "OUT";
    const next = advanceAtlasZoomBoundary(zoomBoundary.current, {
      at: performance.now(), atBoundary: true, direction,
    });
    zoomBoundary.current = next.state;
    if (!next.triggered) return;
    if (direction === "OUT") { onZoomOut(); return; }
    const bounds = hostRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const pointer = {
      x: displayBounds.minX + (event.clientX - bounds.left) / Math.max(1, bounds.width) * (displayBounds.maxX - displayBounds.minX + 1),
      y: displayBounds.minY + (event.clientY - bounds.top) / Math.max(1, bounds.height) * (displayBounds.maxY - displayBounds.minY + 1),
    };
    const city = [...atlas.cities].sort((left, right) =>
      Math.hypot(left.atlasCenter.x - pointer.x, left.atlasCenter.y - pointer.y)
      - Math.hypot(right.atlasCenter.x - pointer.x, right.atlasCenter.y - pointer.y))[0];
    if (city) onCitySelect(city);
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

      <g className="atlas-air-routes" aria-hidden="true">
        {atlas.connections.map((connection, index) => {
          const from = atlas.cities.find((city) => city.id === connection.fromCityId);
          const to = atlas.cities.find((city) => city.id === connection.toCityId);
          if (!from || !to) return null;
          const path = atlasFlightPath(from, to, index);
          const duration = 11 + index % 7;
          return <g key={`${connection.fromCityId}:${connection.toCityId}`}>
            <path d={path} className="atlas-air-route-line" />
            <AtlasAircraft
              path={path}
              durationSeconds={duration}
              delaySeconds={-(index * 3 % duration)}
              kind={index}
              facing={to.atlasCenter.x < from.atlasCenter.x ? "left" : "right"}
            />
          </g>;
        })}
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
          {city.features.filter((feature) => feature.assetKind === "AREA").flatMap((feature) => feature.atlasFootprint.map((cell) => <rect
            key={`${feature.id}:${cell.x}:${cell.y}`}
            x={cell.x * CELL} y={cell.y * CELL} width={CELL} height={CELL}
            className={feature.assetKey === "urban-grove" ? "atlas-grove-cell" : "atlas-park-cell"}
          />))}
          {city.roads.map((road, index) => <rect key={`${road.sourceCell.x}:${road.sourceCell.y}:${index}`} x={road.atlasCell.x * CELL + 2} y={road.atlasCell.y * CELL + 2} width={CELL - 4} height={CELL - 4} className="atlas-road-cell" />)}
          {city.surfaces.map((surface, index) => <rect key={`${surface.sourceCell.x}:${surface.sourceCell.y}:${index}`} x={surface.atlasCell.x * CELL + 2.75} y={surface.atlasCell.y * CELL + 2.75} width={CELL - 5.5} height={CELL - 5.5} className={`atlas-surface-cell atlas-surface-${surface.kind.toLowerCase()}`} />)}
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
        <AtlasCityLabel city={city} onSelect={() => onCitySelect(city)} />
      </g>)}
      <g className="atlas-clouds" aria-hidden="true">
        {atmosphereClouds.map((cloud) => <g key={cloud.id} transform={`translate(${cloud.x} ${cloud.y}) scale(${cloud.scale})`} style={{ "--atlas-cloud-duration": `${cloud.duration}s` } as CSSProperties}>
          <path d="M0 7h6V3h5V0h8v3h6v4h8v5H0Z" />
          <path className="atlas-cloud-shadow" d="M6 12h21v3H6Z" />
        </g>)}
      </g>
    </svg>
    <div className="country-edge-water-fog" aria-hidden="true">
      {countryEdgeFog.map((fog) => <i key={fog.id} style={{ left: `${fog.left}%`, top: `${fog.top}%`, scale: fog.scale }} />)}
    </div>
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
