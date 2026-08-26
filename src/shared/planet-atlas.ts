import type { PlanetAtlasDto, PlanetCountryDto } from "./planet-atlas-contract";
import type { TerrainKind } from "./contracts";
import { terrainAt } from "./world-terrain";

export type PlanetHex = { q: number; r: number };
export type PlanetPoint = { x: number; y: number };
export type PlanetTerrainKind = "grass" | "meadow" | "forest" | "hill" | "mountain" | "coast" | "river" | "stone";
export type PlanetTerrainCell = PlanetHex & { id: string; terrain: PlanetTerrainKind };
export type PlanetAirport = { id: string; countryId: string; cityIndex: number; cellId: string; point: PlanetPoint };
export type ProjectedPlanetCountry = PlanetCountryDto & {
  continent: number;
  cells: PlanetTerrainCell[];
  airports: PlanetAirport[];
  center: PlanetPoint;
  color: string;
  accent: string;
};
export type PlanetRoute = {
  id: string;
  fromCountryId: string | null;
  toCountryId: string;
  fromAirportId: string | null;
  toAirportId: string;
  from: PlanetPoint;
  control: PlanetPoint;
  to: PlanetPoint;
  path: string;
  durationSeconds: number;
  delaySeconds: number;
  planeKind: number;
  altitudeScale: number;
  rotateWithPath: true;
};
export type PlanetStar = { id: string; xPercent: number; yPercent: number; size: number; opacity: number; delaySeconds: number; group: "field" | "constellation" | "milky-way" };
export type PlanetFogCell = { id: string; point: PlanetPoint; size: number; opacity: number };
export type ProjectedPlanetAtlas = {
  width: number;
  height: number;
  hexRadius: number;
  viewBox: string;
  oceanCells: PlanetHex[];
  coastCells: PlanetTerrainCell[];
  countries: ProjectedPlanetCountry[];
  routes: PlanetRoute[];
  clouds: Array<{ id: string; x: number; y: number; scale: number; durationSeconds: number; delaySeconds: number }>;
  stars: PlanetStar[];
  edgeFog: PlanetFogCell[];
};
export type PlanetMapCamera = { panX: number; panY: number; zoom: number };
export type PlanetMapCell = PlanetTerrainCell & { center: PlanetPoint; x: number; y: number; width: number; height: number; size: number };
export type PlanetMapAirport = Omit<PlanetAirport, "point"> & { center: PlanetPoint };
export type PlanetMapCountry = Omit<ProjectedPlanetCountry, "cells" | "airports" | "center"> & {
  cells: PlanetMapCell[];
  airports: PlanetMapAirport[];
  center: PlanetPoint;
};
export type PlanetCountryLabelLayout = { countryId: string; x: number; y: number; width: number; height: number };
export type ProjectedPlanetMap = {
  width: number;
  height: number;
  surface: { minX: number; minY: number; maxX: number; maxY: number };
  countries: PlanetMapCountry[];
  coastCells: PlanetMapCell[];
  routes: PlanetRoute[];
  clouds: Array<{ id: string; x: number; y: number; scale: number; durationSeconds: number; delaySeconds: number }>;
  stars: PlanetStar[];
  edgeFog: PlanetFogCell[];
};

const DIRECTIONS: PlanetHex[] = [
  { q: 1, r: 0 }, { q: -1, r: 0 }, { q: 0, r: 1 }, { q: 0, r: -1 },
];
const COUNTRY_COLORS = [
  ["#759b54", "#a9bf69"], ["#b88b52", "#dfb86b"], ["#4f8e7b", "#79b9a6"],
  ["#8b74a8", "#b49ac8"], ["#a8655b", "#d48b72"], ["#607ea5", "#88a7cf"],
] as const;
const MAP_WIDTH = 1000;
const MAP_HEIGHT = 700;

function hashText(value: string, seed = 2166136261): number {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function random01(seed: number): number {
  let value = seed >>> 0;
  value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
  return (value >>> 0) / 0x1_0000_0000;
}

function hexDistance(left: PlanetHex, right: PlanetHex): number {
  return Math.abs(left.q - right.q) + Math.abs(left.r - right.r);
}

function key(cell: PlanetHex): string { return `${cell.q}:${cell.r}`; }
function inside(cell: PlanetHex, columns: number, rows: number): boolean {
  return cell.q >= 2 && cell.r >= 2 && cell.q < columns - 2 && cell.r < rows - 2;
}

export function planetHexCenter(cell: PlanetHex, radius: number): PlanetPoint {
  return {
    x: cell.q * radius * 2 + radius,
    y: cell.r * radius * 2 + radius,
  };
}

export function planetHexPath(cell: PlanetHex, radius: number): string {
  const center = planetHexCenter(cell, radius);
  return `M${center.x - radius},${center.y - radius}H${center.x + radius}V${center.y + radius}H${center.x - radius}Z`;
}

function territorySize(country: PlanetCountryDto): number {
  return Math.max(32, Math.min(144, Math.round(
    26 + country.cityCount * 7 + Math.sqrt(country.districtCount) * 2.4 + Math.sqrt(country.buildingCount) * 1.8,
  )));
}

function growTerritory(anchor: PlanetHex, wanted: number, occupied: Set<string>, columns: number, rows: number, seed: number): PlanetHex[] {
  const cells: PlanetHex[] = [];
  const queued = new Set<string>([key(anchor)]);
  const frontier: PlanetHex[] = [anchor];
  while (frontier.length > 0 && cells.length < wanted) {
    frontier.sort((left, right) => {
      const leftDistance = Math.hypot(left.q - anchor.q, left.r - anchor.r);
      const rightDistance = Math.hypot(right.q - anchor.q, right.r - anchor.r);
      const leftScore = leftDistance * 1_000 + hashText(key(left), seed) % 620;
      const rightScore = rightDistance * 1_000 + hashText(key(right), seed) % 620;
      return leftScore - rightScore || left.r - right.r || left.q - right.q;
    });
    const cell = frontier.shift()!;
    if (!inside(cell, columns, rows) || occupied.has(key(cell))) continue;
    cells.push(cell);
    occupied.add(key(cell));
    for (const direction of DIRECTIONS) {
      const next = { q: cell.q + direction.q, r: cell.r + direction.r };
      const nextKey = key(next);
      if (inside(next, columns, rows) && !queued.has(nextKey) && !occupied.has(nextKey)) {
        queued.add(nextKey);
        frontier.push(next);
      }
    }
  }
  return cells;
}

function nearestFreeAnchor(preferred: PlanetHex, occupied: Set<string>, columns: number, rows: number): PlanetHex {
  const queue = [preferred];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const cell = queue.shift()!;
    if (!inside(cell, columns, rows)) continue;
    if (!occupied.has(key(cell))) return cell;
    if (visited.has(key(cell))) continue;
    visited.add(key(cell));
    for (const direction of DIRECTIONS) queue.push({ q: cell.q + direction.q, r: cell.r + direction.r });
  }
  return { q: 3, r: 3 };
}

function countryCenter(cells: PlanetHex[], radius: number): PlanetPoint {
  const points = cells.map((cell) => planetHexCenter(cell, radius));
  return {
    x: points.reduce((total, point) => total + point.x, 0) / Math.max(1, points.length),
    y: points.reduce((total, point) => total + point.y, 0) / Math.max(1, points.length),
  };
}

function terrainForCell(cell: PlanetHex, countrySeed: number, center: PlanetPoint, radius: number): PlanetTerrainKind {
  const value = hashText(`terrain:${cell.q}:${cell.r}`, countrySeed);
  const point = planetHexCenter(cell, radius);
  const northness = point.y < center.y;
  if ((cell.q + countrySeed % 7) % 13 === 0 && value % 4 !== 0) return "river";
  if (value % 19 === 0 || (northness && value % 13 === 0)) return "mountain";
  if (value % 11 === 0) return "hill";
  if (value % 7 === 0) return "forest";
  if (value % 17 === 0) return "stone";
  return value % 3 === 0 ? "meadow" : "grass";
}

function planetTerrainFromWorld(kind: TerrainKind): PlanetTerrainKind {
  if (kind === "FOREST") return "forest";
  if (kind === "HILL") return "hill";
  if (kind === "MOUNTAIN") return "mountain";
  if (kind === "STONE" || kind === "CLAY" || kind === "DIRT") return "stone";
  if (kind === "SAND" || kind === "WET_SAND") return "coast";
  if (kind === "SHALLOW_WATER" || kind === "DEEP_WATER") return "river";
  if (kind === "MEADOW") return "meadow";
  return "grass";
}

function projectedWorldTerrain(country: PlanetCountryDto, cell: PlanetHex, cells: readonly PlanetHex[]): PlanetTerrainKind | undefined {
  if (!country.worldBounds || cells.length === 0) return undefined;
  const minQ = Math.min(...cells.map((candidate) => candidate.q));
  const maxQ = Math.max(...cells.map((candidate) => candidate.q));
  const minR = Math.min(...cells.map((candidate) => candidate.r));
  const maxR = Math.max(...cells.map((candidate) => candidate.r));
  const x = Math.round(country.worldBounds.minX
    + (cell.q - minQ) / Math.max(1, maxQ - minQ) * (country.worldBounds.maxX - country.worldBounds.minX));
  const y = Math.round(country.worldBounds.minY
    + (cell.r - minR) / Math.max(1, maxR - minR) * (country.worldBounds.maxY - country.worldBounds.minY));
  return planetTerrainFromWorld(terrainAt(country.seed, x, y).terrain);
}

function buildAirports(country: PlanetCountryDto, cells: PlanetTerrainCell[], radius: number, seed: number): PlanetAirport[] {
  if (country.cityCount <= 0 || cells.length === 0) return [];
  const ordered = [...cells].sort((left, right) => hashText(left.id, seed) - hashText(right.id, seed) || left.id.localeCompare(right.id));
  return Array.from({ length: country.cityCount }, (_, cityIndex) => {
    const cell = ordered[Math.floor((cityIndex + .5) * ordered.length / country.cityCount)]!;
    return { id: `planet-airport-${country.id}-${cityIndex}`, countryId: country.id, cityIndex, cellId: cell.id, point: planetHexCenter(cell, radius) };
  });
}

function pathForRoute(from: PlanetPoint, control: PlanetPoint, to: PlanetPoint): string {
  return `M${from.x.toFixed(1)} ${from.y.toFixed(1)} Q${control.x.toFixed(1)} ${control.y.toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`;
}

export function projectPlanetAtlas(atlas: PlanetAtlasDto): ProjectedPlanetAtlas {
  const count = Math.max(1, atlas.countries.length);
  const columns = Math.max(92, Math.ceil(Math.sqrt(count) * 30));
  // Planet space is square even on a wide desktop viewport: the ocean/fog
  // aperture must read as one round world, never as a stretched ellipse.
  const rows = Math.max(columns, Math.ceil(count / Math.max(1, Math.floor(columns / 22))) * 18 + 18);
  const hexRadius = 4;
  const occupied = new Set<string>();
  const continentCount = count === 1 ? 1 : Math.min(5, Math.max(2, Math.ceil(count / 2)));
  const continentAnchors = Array.from({ length: continentCount }, (_, index) => {
    const angle = Math.PI * 2 * index / continentCount - Math.PI / 2;
    return { q: Math.round(columns / 2 + Math.cos(angle) * columns * .24), r: Math.round(rows / 2 + Math.sin(angle) * rows * .23) };
  });

  const ordered = [...atlas.countries].sort((left, right) => left.id.localeCompare(right.id));
  const countries = ordered.map((country, index): ProjectedPlanetCountry => {
    const countryHash = hashText(country.id, atlas.planetSeed ^ country.seed);
    const continent = countryHash % continentCount;
    const anchor = continentAnchors[continent]!;
    const localIndex = ordered.slice(0, index).filter((entry) => hashText(entry.id, atlas.planetSeed ^ entry.seed) % continentCount === continent).length;
    const angle = localIndex * 2.399963 + random01(countryHash) * .7;
    const distance = localIndex === 0 ? 0 : 8 + Math.floor(localIndex / 4) * 6;
    const preferred = { q: Math.round(anchor.q + Math.cos(angle) * distance), r: Math.round(anchor.r + Math.sin(angle) * distance) };
    const rawCells = growTerritory(nearestFreeAnchor(preferred, occupied, columns, rows), territorySize(country), occupied, columns, rows, countryHash);
    const center = countryCenter(rawCells, hexRadius);
    const cells = rawCells.map((cell): PlanetTerrainCell => ({
      ...cell,
      id: `${country.id}:${key(cell)}`,
      terrain: projectedWorldTerrain(country, cell, rawCells) ?? terrainForCell(cell, countryHash, center, hexRadius),
    }));
    const palette = COUNTRY_COLORS[countryHash % COUNTRY_COLORS.length]!;
    return { ...country, continent, cells, airports: buildAirports(country, cells, hexRadius, countryHash), center, color: palette[0], accent: palette[1] };
  });

  const coast = new Map<string, PlanetTerrainCell>();
  for (const country of countries) for (const cell of country.cells) for (const direction of DIRECTIONS) {
    const neighbor = { q: cell.q + direction.q, r: cell.r + direction.r };
    if (inside(neighbor, columns, rows) && !occupied.has(key(neighbor))) coast.set(key(neighbor), { ...neighbor, id: `coast:${key(neighbor)}`, terrain: "coast" });
  }
  for (let continent = 0; continent < continentCount; continent += 1) {
    const group = countries.filter((country) => country.continent === continent);
    for (let index = 1; index < group.length; index += 1) {
      const startCountry = group[index - 1]!;
      const endCountry = group[index]!;
      const startCell = startCountry.cells[Math.floor(startCountry.cells.length / 2)]!;
      const endCell = endCountry.cells[Math.floor(endCountry.cells.length / 2)]!;
      const steps = Math.max(1, hexDistance(startCell, endCell));
      for (let step = 0; step <= steps; step += 1) {
        const cell = { q: Math.round(startCell.q + (endCell.q - startCell.q) * step / steps), r: Math.round(startCell.r + (endCell.r - startCell.r) * step / steps) };
        if (!inside(cell, columns, rows) || occupied.has(key(cell))) continue;
        const terrain: PlanetTerrainKind = hashText(`${startCountry.id}:${endCountry.id}:${step}`, atlas.planetSeed) % 5 === 0 ? "stone" : "coast";
        coast.set(key(cell), { ...cell, id: `coast:${key(cell)}`, terrain });
      }
    }
  }
  const coastCells = [...coast.values()];
  const oceanCells: PlanetHex[] = [];
  for (let r = 0; r < rows; r += 1) for (let q = 0; q < columns; q += 1) if (!occupied.has(`${q}:${r}`)) oceanCells.push({ q, r });

  const pixelWidth = planetHexCenter({ q: columns, r: rows }, hexRadius).x + hexRadius * 2;
  const pixelHeight = planetHexCenter({ q: columns, r: rows }, hexRadius).y + hexRadius * 2;
  const airports = countries.flatMap((country) => country.airports);
  const routes: PlanetRoute[] = [];
  const routeTarget = airports.length < 2 ? 0 : Math.min(240, Math.max(airports.length, airports.length * 6));
  for (let index = 0; index < routeTarget; index += 1) {
    const from = airports[index % airports.length]!;
    const offset = 1 + hashText(`airport-route-offset:${index}`, atlas.planetSeed) % (airports.length - 1);
    const to = airports[(index + offset) % airports.length]!;
    const routeKey = `${from.id}:${to.id}:${index}`;
    const dx = to.point.x - from.point.x;
    const dy = to.point.y - from.point.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const bend = ((hashText(routeKey, atlas.planetSeed) % 2) * 2 - 1) * Math.min(68, 16 + distance * .2);
    const control = { x: (from.point.x + to.point.x) / 2 - dy / distance * bend, y: (from.point.y + to.point.y) / 2 + dx / distance * bend };
    routes.push({
      id: `planet-route-${index}`,
      fromCountryId: from.countryId,
      toCountryId: to.countryId,
      fromAirportId: from.id,
      toAirportId: to.id,
      from: from.point,
      control,
      to: to.point,
      path: pathForRoute(from.point, control, to.point),
      durationSeconds: 12 + hashText(routeKey) % 11,
      delaySeconds: -(hashText(routeKey, 91) % 17),
      planeKind: hashText(routeKey, 47) % 8,
      altitudeScale: [.82, 1, 1.18][hashText(routeKey, 73) % 3]!,
      rotateWithPath: true,
    });
  }
  for (let index = 0; index < airports.length; index += 1) {
    const to = airports[index]!;
    const edgeSeed = hashText(`edge-route:${to.id}`, atlas.planetSeed);
    const side = edgeSeed % 4;
    const from = side === 0
      ? { x: 0, y: random01(edgeSeed ^ 0x11) * pixelHeight }
      : side === 1
        ? { x: pixelWidth, y: random01(edgeSeed ^ 0x22) * pixelHeight }
        : side === 2
          ? { x: random01(edgeSeed ^ 0x33) * pixelWidth, y: 0 }
          : { x: random01(edgeSeed ^ 0x44) * pixelWidth, y: pixelHeight };
    const dx = to.point.x - from.x;
    const dy = to.point.y - from.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const bend = ((edgeSeed & 1) === 0 ? -1 : 1) * Math.min(110, 24 + distance * .18);
    const control = { x: (from.x + to.point.x) / 2 - dy / distance * bend, y: (from.y + to.point.y) / 2 + dx / distance * bend };
    routes.push({
      id: `planet-edge-route-${index}`,
      fromCountryId: null,
      toCountryId: to.countryId,
      fromAirportId: null,
      toAirportId: to.id,
      from,
      control,
      to: to.point,
      path: pathForRoute(from, control, to.point),
      durationSeconds: 14 + edgeSeed % 12,
      delaySeconds: -(edgeSeed % 29),
      planeKind: edgeSeed % 8,
      altitudeScale: [.82, 1, 1.18][(edgeSeed >>> 4) % 3]!,
      rotateWithPath: true,
    });
  }

  const clouds = Array.from({ length: Math.max(20, Math.min(38, 20 + countries.length * 3)) }, (_, index) => {
    const cloudSeed = hashText(`cloud:${index}`, atlas.planetSeed);
    return { id: `planet-cloud-${index}`, x: random01(cloudSeed) * pixelWidth, y: (.05 + random01(cloudSeed ^ 0xa531) * .88) * pixelHeight, scale: .48 + random01(cloudSeed ^ 0x13f7) * .62, durationSeconds: 18 + cloudSeed % 17, delaySeconds: -(cloudSeed % 43) };
  });
  const stars: PlanetStar[] = Array.from({ length: 180 }, (_, index) => {
    const starSeed = hashText(`star:${index}`, atlas.planetSeed);
    const milkyWay = index >= 132;
    const constellation = index >= 108 && index < 132;
    const xPercent = 1 + random01(starSeed) * 98;
    const yPercent = milkyWay
      ? Math.max(1, Math.min(99, 78 - xPercent * .56 + (random01(starSeed ^ 0xb137) - .5) * 18))
      : constellation
        ? 14 + (index % 8) * 9 + (random01(starSeed) - .5) * 4
        : 1 + random01(starSeed ^ 0xb137) * 98;
    return { id: `planet-star-${index}`, xPercent, yPercent, size: constellation ? 2 : 1 + starSeed % 2, opacity: milkyWay ? .18 + random01(starSeed ^ 0x19a) * .36 : constellation ? .66 + random01(starSeed ^ 0x32b) * .3 : .22 + random01(starSeed ^ 0x54d) * .58, delaySeconds: -(starSeed % 7), group: milkyWay ? "milky-way" : constellation ? "constellation" : "field" };
  });
  const edgeFog: PlanetFogCell[] = Array.from({ length: 288 }, (_, index) => {
    const fogSeed = hashText(`edge-fog:${index}`, atlas.planetSeed);
    const angle = Math.PI * 2 * index / 288 + (random01(fogSeed) - .5) * .05;
    const depth = index % 4;
    return { id: `planet-edge-fog-${index}`, point: { x: pixelWidth / 2 + Math.cos(angle) * pixelWidth * (.505 + depth * .024), y: pixelHeight / 2 + Math.sin(angle) * pixelHeight * (.505 + depth * .024) }, size: 4 + fogSeed % 2 * 4, opacity: .12 + depth * .11 + random01(fogSeed ^ 0x6d2b) * .1 };
  });
  return { width: pixelWidth, height: pixelHeight, hexRadius, viewBox: `0 0 ${pixelWidth} ${pixelHeight}`, oceanCells, coastCells, countries, routes, clouds, stars, edgeFog };
}

function affineProject(point: PlanetPoint, base: Pick<ProjectedPlanetAtlas, "width" | "height">, camera: PlanetMapCamera): PlanetPoint {
  const zoom = Math.max(.82, Math.min(8.5, camera.zoom));
  const fit = Math.min(MAP_WIDTH * .76 / base.width, MAP_HEIGHT * .76 / base.height);
  const scale = fit * zoom;
  return { x: Math.round(MAP_WIDTH / 2 + (point.x - base.width / 2 - camera.panX * base.width * .32) * scale), y: Math.round(MAP_HEIGHT / 2 + (point.y - base.height / 2 - camera.panY * base.height * .32) * scale) };
}

function projectCell(cell: PlanetTerrainCell, base: ProjectedPlanetAtlas, camera: PlanetMapCamera): PlanetMapCell {
  const unit = base.hexRadius * 2;
  const start = affineProject({ x: cell.q * unit, y: cell.r * unit }, base, camera);
  const end = affineProject({ x: (cell.q + 1) * unit, y: (cell.r + 1) * unit }, base, camera);
  const width = Math.max(1, end.x - start.x);
  const height = Math.max(1, end.y - start.y);
  return {
    ...cell,
    center: { x: start.x + width / 2, y: start.y + height / 2 },
    x: start.x,
    y: start.y,
    width,
    height,
    size: Math.min(width, height),
  };
}

export function projectProjectedPlanetMap(base: ProjectedPlanetAtlas, camera: PlanetMapCamera): ProjectedPlanetMap {
  // The atmosphere and its clip aperture scale with the globe. Pan remains a
  // content operation, so the user can still explore the surface without the
  // planet itself sliding through space. The bounded scale prevents the old
  // circle-plus-rectangle ("keyhole") frame at extreme zoom.
  const atmosphereCamera = {
    panX: 0,
    panY: 0,
    zoom: Math.max(.96, Math.min(1.45, 1 + (camera.zoom - 1) * .12)),
  };
  const countries = base.countries.map((country): PlanetMapCountry => {
    const cells = country.cells.map((cell) => projectCell(cell, base, camera));
    const cellById = new Map(cells.map((cell) => [cell.id, cell]));
    const airports = country.airports.map((airport): PlanetMapAirport => ({ id: airport.id, countryId: airport.countryId, cityIndex: airport.cityIndex, cellId: airport.cellId, center: cellById.get(airport.cellId)?.center ?? affineProject(airport.point, base, camera) }));
    return { ...country, cells, airports, center: affineProject(country.center, base, camera) };
  });
  const routes = base.routes.map((route): PlanetRoute => {
    const from = affineProject(route.from, base, camera);
    const control = affineProject(route.control, base, camera);
    const to = affineProject(route.to, base, camera);
    return { ...route, from, control, to, path: pathForRoute(from, control, to) };
  });
  const clouds = base.clouds.map((cloud) => {
    const point = affineProject(cloud, base, atmosphereCamera);
    return { ...cloud, x: point.x, y: point.y, scale: cloud.scale * Math.min(1.25, .72 + camera.zoom * .16) };
  });
  const fit = Math.min(MAP_WIDTH * .76 / base.width, MAP_HEIGHT * .76 / base.height);
  const fogScale = fit;
  const surfaceStart = affineProject({ x: 0, y: 0 }, base, atmosphereCamera);
  const surfaceEnd = affineProject({ x: base.width, y: base.height }, base, atmosphereCamera);
  return { width: MAP_WIDTH, height: MAP_HEIGHT, surface: { minX: surfaceStart.x, minY: surfaceStart.y, maxX: surfaceEnd.x, maxY: surfaceEnd.y }, countries, coastCells: base.coastCells.map((cell) => projectCell(cell, base, camera)), routes, clouds, stars: base.stars, edgeFog: base.edgeFog.map((fog) => ({ ...fog, point: affineProject(fog.point, base, atmosphereCamera), size: Math.max(4, Math.round(fog.size * fogScale)) })) };
}

/** Keep the same world point under the cursor while changing planet zoom. */
export function zoomPlanetCameraAtFocus(base: Pick<ProjectedPlanetAtlas, "width" | "height">, camera: PlanetMapCamera, nextZoom: number, focus: PlanetPoint): PlanetMapCamera {
  const fit = Math.min(MAP_WIDTH * .76 / base.width, MAP_HEIGHT * .76 / base.height);
  const oldScale = fit * camera.zoom;
  const newScale = fit * nextZoom;
  const world = {
    x: base.width / 2 + camera.panX * base.width * .32 + (focus.x - MAP_WIDTH / 2) / oldScale,
    y: base.height / 2 + camera.panY * base.height * .32 + (focus.y - MAP_HEIGHT / 2) / oldScale,
  };
  return {
    zoom: nextZoom,
    panX: Math.max(-1.25, Math.min(1.25, (world.x - base.width / 2 - (focus.x - MAP_WIDTH / 2) / newScale) / (base.width * .32))),
    panY: Math.max(-1, Math.min(1, (world.y - base.height / 2 - (focus.y - MAP_HEIGHT / 2) / newScale) / (base.height * .32))),
  };
}

export function projectPlanetMap(atlas: PlanetAtlasDto, camera: PlanetMapCamera): ProjectedPlanetMap {
  return projectProjectedPlanetMap(projectPlanetAtlas(atlas), camera);
}

function rectanglesOverlap(left: PlanetCountryLabelLayout, right: PlanetCountryLabelLayout): boolean {
  return left.x < right.x + right.width && left.x + left.width > right.x && left.y < right.y + right.height && left.y + left.height > right.y;
}

export function layoutPlanetCountryLabels(countries: PlanetMapCountry[], width: number, height: number): PlanetCountryLabelLayout[] {
  const labelWidth = 132;
  const labelHeight = 34;
  const margin = 12;
  const placed: PlanetCountryLabelLayout[] = [];
  const offsets = [
    { x: -labelWidth / 2, y: -62 }, { x: 18, y: -38 }, { x: -labelWidth - 18, y: -38 },
    { x: -labelWidth / 2, y: 24 }, { x: 26, y: 14 }, { x: -labelWidth - 26, y: 14 },
  ];
  for (const country of [...countries].sort((left, right) => right.progress - left.progress || left.id.localeCompare(right.id))) {
    let selected: PlanetCountryLabelLayout | undefined;
    for (const offset of offsets) {
      const candidate = { countryId: country.id, x: Math.max(margin, Math.min(width - labelWidth - margin, country.center.x + offset.x)), y: Math.max(margin, Math.min(height - labelHeight - margin, country.center.y + offset.y)), width: labelWidth, height: labelHeight };
      if (!placed.some((other) => rectanglesOverlap(candidate, other))) { selected = candidate; break; }
    }
    if (!selected) {
      for (let y = margin; y <= height - labelHeight - margin && !selected; y += labelHeight + 6) for (let x = margin; x <= width - labelWidth - margin; x += labelWidth + 6) {
        const candidate = { countryId: country.id, x, y, width: labelWidth, height: labelHeight };
        if (!placed.some((other) => rectanglesOverlap(candidate, other))) { selected = candidate; break; }
      }
    }
    if (selected) placed.push(selected);
  }
  return placed;
}
