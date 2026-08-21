import { useEffect, useMemo, useRef, useState } from "react";
import { gameAssetUrl, getBuilding, PROP_CATALOG, TERRAIN_SPRITES, type BuildingCatalogEntry } from "../../shared/catalog";
import type { Cell, TerrainKind } from "../../shared/contracts";
import {
  type CountryAtlasCityDto,
  type CountryAtlasDistrictDto,
  type CountryAtlasDto,
} from "../../shared/country-atlas-contract";
import { seededAtlasCutoutTerrain, seededAtlasMacroTerrain } from "../../shared/country-atlas-terrain";
import { api } from "../api";
import { atlasBuildingPresentation } from "../country-atlas-presentation";

const CELL = 8;
const DISTRICT_STATUS_LABEL: Record<CountryAtlasDistrictDto["status"], string> = {
  PLANNED: "Запланирован",
  ACTIVE: "Активный район",
  COMPLETED: "Завершён",
  ABANDONED: "Остановлен",
};

function terrainPatternId(terrain: TerrainKind, variant: number): string {
  return `atlas-terrain-${terrain.toLowerCase().replaceAll("_", "-")}-${variant}`;
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

export function CountryAtlasCanvas({ countryId, worldVersion, activeCityId, onCitySelect, onDistrictSelect, onCityHover }: {
  countryId: string;
  worldVersion: number;
  activeCityId?: string;
  onCitySelect: (city: CountryAtlasCityDto) => void;
  onDistrictSelect: (city: CountryAtlasCityDto, district: CountryAtlasDistrictDto) => void;
  onCityHover: (city: CountryAtlasCityDto | null) => void;
}) {
  const [atlas, setAtlas] = useState<CountryAtlasDto | null>(null);
  const [error, setError] = useState("");
  const [hoveredDistrict, setHoveredDistrict] = useState<{ cityId: string; districtId: string } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    void api<CountryAtlasDto>("/api/country-atlas", { signal: controller.signal })
      .then(setAtlas)
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Не удалось собрать карту страны");
      });
    return () => controller.abort();
  }, [countryId, worldVersion]);
  useEffect(() => () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
  }, []);

  const viewport = useMemo(() => {
    if (!atlas) return "0 0 1 1";
    return `${atlas.bounds.minX * CELL} ${atlas.bounds.minY * CELL} ${(atlas.bounds.maxX - atlas.bounds.minX + 1) * CELL} ${(atlas.bounds.maxY - atlas.bounds.minY + 1) * CELL}`;
  }, [atlas]);
  const seededTerrain = useMemo(() => {
    if (!atlas) return { macroTerrain: [], cutoutByCity: new Map<string, ReturnType<typeof seededAtlasCutoutTerrain>>() };
    return {
      macroTerrain: seededAtlasMacroTerrain(atlas.terrainSeed, atlas.bounds, atlas.cities),
      cutoutByCity: new Map(atlas.cities.map((city) => [city.id, seededAtlasCutoutTerrain(atlas.terrainSeed, city)])),
    };
  }, [atlas]);
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
    const progress = buildings.length > 0
      ? Math.round(buildings.reduce((total, building) => total + building.progress, 0) / buildings.length)
      : 0;
    const atlasMidpoint = (atlas.bounds.minX + atlas.bounds.maxX) / 2;
    const opensLeft = city.atlasCenter.x > atlasMidpoint;
    const tooltipAnchorX = opensLeft ? city.atlasBounds.minX - 2 : city.atlasBounds.maxX + 2;
    const x = (tooltipAnchorX - atlas.bounds.minX) / (atlas.bounds.maxX - atlas.bounds.minX + 1) * 100;
    const y = (district.atlasCenter.y - atlas.bounds.minY) / (atlas.bounds.maxY - atlas.bounds.minY + 1) * 100;
    return { city, district, buildings: buildings.length, progress, x, y, opensLeft };
  }, [atlas, hoveredDistrict]);

  if (error) return <div className="atlas-state" role="alert"><strong>Карта страны недоступна</strong><span>{error}</span></div>;
  if (!atlas) return <div className="atlas-state" role="status"><i /><span>Сжимаем расстояния между городами…</span></div>;

  return <div className="country-atlas" data-country-atlas-cities={atlas.cities.length} onPointerMove={(event) => {
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
      <rect x={atlas.bounds.minX * CELL} y={atlas.bounds.minY * CELL} width={(atlas.bounds.maxX - atlas.bounds.minX + 1) * CELL} height={(atlas.bounds.maxY - atlas.bounds.minY + 1) * CELL} className="atlas-ground" />
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
            return <g
              key={district.id}
              className="atlas-district"
              data-status={district.status}
              data-hovered={hovered ? "true" : "false"}
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
        <g className="atlas-city-label" role="button" tabIndex={0} aria-label={`Открыть город ${city.name}`} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onCitySelect(city); }}>
          <path d={`M${city.atlasCenter.x * CELL - 4} ${city.labelBounds.maxY * CELL + CELL}h8l-4 5Z`} className="atlas-city-label-tab" />
          <rect x={city.labelBounds.minX * CELL} y={city.labelBounds.minY * CELL} width={(city.labelBounds.maxX - city.labelBounds.minX + 1) * CELL} height={(city.labelBounds.maxY - city.labelBounds.minY + 1) * CELL} />
          {city.districts.some((district) => district.status === "ACTIVE") && <circle cx={city.labelBounds.minX * CELL + 14} cy={(city.labelBounds.minY + 2.45) * CELL} r="3.2" className="atlas-city-active-dot" />}
          <text x={city.atlasCenter.x * CELL} y={(city.labelBounds.minY + 2.5) * CELL} textAnchor="middle">{city.name}</text>
          <text x={city.atlasCenter.x * CELL} y={(city.labelBounds.minY + 4.85) * CELL} textAnchor="middle" className="atlas-city-meta">{city.districts.length} РАЙОНА · {city.buildings.length} ЗДАНИЙ</text>
        </g>
      </g>)}
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
