import type { PlanetAtlasDto, PlanetCountryDto } from "./planet-atlas-contract";

export type PlanetHex = { q: number; r: number };
export type PlanetPoint = { x: number; y: number };
export type ProjectedPlanetCountry = PlanetCountryDto & {
  continent: number;
  cells: PlanetHex[];
  center: PlanetPoint;
  color: string;
  accent: string;
};
export type PlanetRoute = {
  id: string;
  fromCountryId: string;
  toCountryId: string;
  path: string;
  durationSeconds: number;
  delaySeconds: number;
  planeKind: number;
  facing: "left" | "right";
};
export type ProjectedPlanetAtlas = {
  width: number;
  height: number;
  hexRadius: number;
  viewBox: string;
  oceanCells: PlanetHex[];
  coastCells: PlanetHex[];
  countries: ProjectedPlanetCountry[];
  routes: PlanetRoute[];
  clouds: Array<{ id: string; x: number; y: number; scale: number; durationSeconds: number; delaySeconds: number }>;
  edgeFog: Array<{ id: string; xPercent: number; yPercent: number; scale: number }>;
};
export type PlanetGlobeCamera = { longitude: number; latitude: number; zoom: number };
export type PlanetGlobeCell = PlanetHex & { center: PlanetPoint; path: string; depth: number };
export type PlanetGlobeCountry = Omit<ProjectedPlanetCountry, "cells" | "center"> & {
  cells: PlanetGlobeCell[];
  center: PlanetPoint;
};
export type PlanetCountryLabelLayout = {
  countryId: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
export type ProjectedPlanetGlobe = {
  width: number;
  height: number;
  center: PlanetPoint;
  clipRadius: number;
  countries: PlanetGlobeCountry[];
  coastCells: PlanetGlobeCell[];
  routes: PlanetRoute[];
  clouds: Array<{ id: string; x: number; y: number; scale: number; durationSeconds: number; delaySeconds: number }>;
};

const DIRECTIONS: PlanetHex[] = [
  { q: 1, r: 0 }, { q: -1, r: 0 }, { q: 0, r: 1 },
  { q: 0, r: -1 }, { q: 1, r: -1 }, { q: -1, r: 1 },
];
const COUNTRY_COLORS = [
  ["#759b54", "#a9bf69"], ["#b88b52", "#dfb86b"], ["#4f8e7b", "#79b9a6"],
  ["#8b74a8", "#b49ac8"], ["#a8655b", "#d48b72"], ["#607ea5", "#88a7cf"],
] as const;

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
  const q = left.q - right.q;
  const r = left.r - right.r;
  return Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));
}

function key(cell: PlanetHex): string { return `${cell.q}:${cell.r}`; }
function inside(cell: PlanetHex, columns: number, rows: number): boolean {
  return cell.q >= 1 && cell.r >= 1 && cell.q < columns - 1 && cell.r < rows - 1;
}

export function planetHexCenter(cell: PlanetHex, radius: number): PlanetPoint {
  return {
    x: radius * Math.sqrt(3) * (cell.q + cell.r / 2) + radius * 1.5,
    y: radius * 1.5 * cell.r + radius * 1.5,
  };
}

export function planetHexPath(cell: PlanetHex, radius: number): string {
  const center = planetHexCenter(cell, radius);
  const points = Array.from({ length: 6 }, (_, index) => {
    const angle = Math.PI / 180 * (60 * index - 30);
    return `${(center.x + radius * Math.cos(angle)).toFixed(2)},${(center.y + radius * Math.sin(angle)).toFixed(2)}`;
  });
  return `M${points.join("L")}Z`;
}

function territorySize(country: PlanetCountryDto): number {
  return Math.max(6, Math.min(32, Math.round(
    5 + country.cityCount * 1.8 + Math.sqrt(country.districtCount) * 0.9 + Math.sqrt(country.buildingCount) * 0.7,
  )));
}

function growTerritory(anchor: PlanetHex, wanted: number, occupied: Set<string>, columns: number, rows: number, seed: number): PlanetHex[] {
  const cells: PlanetHex[] = [];
  const queued = new Set<string>();
  const frontier: PlanetHex[] = [anchor];
  queued.add(key(anchor));
  while (frontier.length > 0 && cells.length < wanted) {
    frontier.sort((left, right) => {
      const leftScore = hexDistance(left, anchor) * 1_000 + hashText(key(left), seed) % 1_000;
      const rightScore = hexDistance(right, anchor) * 1_000 + hashText(key(right), seed) % 1_000;
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
  return { q: 2, r: 2 };
}

function countryCenter(cells: PlanetHex[], radius: number): PlanetPoint {
  const points = cells.map((cell) => planetHexCenter(cell, radius));
  return {
    x: points.reduce((total, point) => total + point.x, 0) / Math.max(1, points.length),
    y: points.reduce((total, point) => total + point.y, 0) / Math.max(1, points.length),
  };
}

export function projectPlanetAtlas(atlas: PlanetAtlasDto): ProjectedPlanetAtlas {
  const count = Math.max(1, atlas.countries.length);
  const columns = Math.max(54, Math.ceil(Math.sqrt(count) * 18));
  const rows = Math.max(30, Math.ceil(count / Math.max(1, Math.floor(columns / 14))) * 10 + 10);
  const hexRadius = 8;
  const occupied = new Set<string>();
  const continentCount = count === 1 ? 1 : Math.min(5, Math.max(2, Math.ceil(count / 2)));
  const continentAnchors = Array.from({ length: continentCount }, (_, index) => {
    const angle = Math.PI * 2 * index / continentCount - Math.PI / 2;
    return {
      q: Math.round(columns / 2 + Math.cos(angle) * columns * 0.26),
      r: Math.round(rows / 2 + Math.sin(angle) * rows * 0.25),
    };
  });

  const ordered = [...atlas.countries].sort((left, right) => left.id.localeCompare(right.id));
  const countries = ordered.map((country, index): ProjectedPlanetCountry => {
    const countryHash = hashText(country.id, atlas.planetSeed ^ country.seed);
    const continent = countryHash % continentCount;
    const anchor = continentAnchors[continent]!;
    const localIndex = ordered.slice(0, index).filter((entry) => hashText(entry.id, atlas.planetSeed ^ entry.seed) % continentCount === continent).length;
    const angle = localIndex * 2.399963 + random01(countryHash) * 0.7;
    const distance = localIndex === 0 ? 0 : 6 + Math.floor(localIndex / 4) * 5;
    const preferred = {
      q: Math.round(anchor.q + Math.cos(angle) * distance),
      r: Math.round(anchor.r + Math.sin(angle) * distance),
    };
    const cells = growTerritory(nearestFreeAnchor(preferred, occupied, columns, rows), territorySize(country), occupied, columns, rows, countryHash);
    const palette = COUNTRY_COLORS[countryHash % COUNTRY_COLORS.length]!;
    return { ...country, continent, cells, center: countryCenter(cells, hexRadius), color: palette[0], accent: palette[1] };
  });

  const coast = new Set<string>();
  for (const country of countries) for (const cell of country.cells) for (const direction of DIRECTIONS) {
    const neighbor = { q: cell.q + direction.q, r: cell.r + direction.r };
    if (inside(neighbor, columns, rows) && !occupied.has(key(neighbor))) coast.add(key(neighbor));
  }
  for (let continent = 0; continent < continentCount; continent += 1) {
    const group = countries.filter((country) => country.continent === continent);
    if (group.length < 2) continue;
    const first = group[0]!;
    const start = {
      q: Math.round(first.cells.reduce((total, cell) => total + cell.q, 0) / first.cells.length),
      r: Math.round(first.cells.reduce((total, cell) => total + cell.r, 0) / first.cells.length),
    };
    for (const country of group.slice(1)) {
      const end = {
        q: Math.round(country.cells.reduce((total, cell) => total + cell.q, 0) / country.cells.length),
        r: Math.round(country.cells.reduce((total, cell) => total + cell.r, 0) / country.cells.length),
      };
      const steps = Math.max(1, Math.max(Math.abs(end.q - start.q), Math.abs(end.r - start.r), Math.abs((end.q + end.r) - (start.q + start.r))));
      for (let step = 0; step <= steps; step += 1) {
        const center = { q: Math.round(start.q + (end.q - start.q) * step / steps), r: Math.round(start.r + (end.r - start.r) * step / steps) };
        for (const offset of [{ q: 0, r: 0 }, ...DIRECTIONS]) {
          const cell = { q: center.q + offset.q, r: center.r + offset.r };
          if (inside(cell, columns, rows) && !occupied.has(key(cell))) coast.add(key(cell));
        }
      }
    }
  }
  const coastCells = [...coast].map((entry) => { const [q, r] = entry.split(":").map(Number); return { q: q!, r: r! }; });
  const oceanCells: PlanetHex[] = [];
  for (let r = 0; r < rows; r += 1) for (let q = 0; q < columns; q += 1) if (!occupied.has(`${q}:${r}`)) oceanCells.push({ q, r });

  const routes: PlanetRoute[] = [];
  const airportCount = countries.reduce((total, country) => total + country.cityCount, 0);
  const routeTarget = countries.length < 2 ? 0 : Math.min(240, Math.max(countries.length - 1, airportCount * 12));
  for (let index = 0; index < routeTarget; index += 1) {
    const previous = countries[index % countries.length]!;
    const offset = 1 + hashText(`route-offset:${index}`, atlas.planetSeed) % (countries.length - 1);
    const target = countries[(index + offset) % countries.length]!;
    const routeKey = `${previous.id}:${target.id}:${index}`;
    const curve = ((hashText(routeKey, atlas.planetSeed) % 2) * 2 - 1) * (18 + hashText(routeKey) % 54);
    const lateral = (hashText(routeKey, 113) % 31) - 15;
    const midX = (previous.center.x + target.center.x) / 2 + lateral;
    const midY = (previous.center.y + target.center.y) / 2 - curve;
    routes.push({
      id: `planet-route-${routes.length}`,
      fromCountryId: previous.id,
      toCountryId: target.id,
      path: `M${previous.center.x.toFixed(1)} ${previous.center.y.toFixed(1)} Q${midX.toFixed(1)} ${midY.toFixed(1)} ${target.center.x.toFixed(1)} ${target.center.y.toFixed(1)}`,
      durationSeconds: 12 + hashText(routeKey) % 11,
      delaySeconds: -(hashText(routeKey, 91) % 13),
      planeKind: hashText(routeKey, 47) % 8,
      facing: target.center.x < previous.center.x ? "left" : "right",
    });
  }

  const pixelWidth = planetHexCenter({ q: columns, r: rows }, hexRadius).x + hexRadius * 2;
  const pixelHeight = planetHexCenter({ q: columns, r: rows }, hexRadius).y + hexRadius * 2;
  const clouds = Array.from({ length: Math.max(6, Math.min(18, 6 + countries.length * 2)) }, (_, index) => {
    const cloudSeed = hashText(`cloud:${index}`, atlas.planetSeed);
    return {
      id: `planet-cloud-${index}`,
      x: random01(cloudSeed) * pixelWidth,
      y: (0.08 + random01(cloudSeed ^ 0xa531) * 0.78) * pixelHeight,
      scale: 0.65 + random01(cloudSeed ^ 0x13f7) * 0.7,
      durationSeconds: 34 + cloudSeed % 27,
      delaySeconds: -(cloudSeed % 31),
    };
  });
  const edgeFog = Array.from({ length: 28 }, (_, index) => {
    const fogSeed = hashText(`edge-fog:${index}`, atlas.planetSeed);
    const side = index % 4;
    const along = 3 + random01(fogSeed) * 94;
    return {
      id: `planet-edge-fog-${index}`,
      xPercent: side === 0 ? along : side === 1 ? 98 : side === 2 ? along : 2,
      yPercent: side === 0 ? 2 : side === 1 ? along : side === 2 ? 98 : along,
      scale: .7 + random01(fogSeed ^ 0x93ab) * .9,
    };
  });
  return { width: pixelWidth, height: pixelHeight, hexRadius, viewBox: `0 0 ${pixelWidth} ${pixelHeight}`, oceanCells, coastCells, countries, routes, clouds, edgeFog };
}

const GLOBE_WIDTH = 1000;
const GLOBE_HEIGHT = 700;

function globePoint(
  point: PlanetPoint,
  base: Pick<ProjectedPlanetAtlas, "width" | "height">,
  camera: PlanetGlobeCamera,
  center: PlanetPoint,
  radius: number,
): PlanetPoint & { depth: number } {
  const longitude = point.x / base.width * Math.PI * 2 - Math.PI - camera.longitude;
  const latitude = Math.PI / 2 - point.y / base.height * Math.PI;
  const cosLatitude = Math.cos(latitude);
  const x = cosLatitude * Math.sin(longitude);
  const y = Math.sin(latitude);
  const z = cosLatitude * Math.cos(longitude);
  const cosPitch = Math.cos(camera.latitude);
  const sinPitch = Math.sin(camera.latitude);
  const rotatedY = y * cosPitch - z * sinPitch;
  const rotatedZ = y * sinPitch + z * cosPitch;
  return { x: center.x + x * radius, y: center.y - rotatedY * radius, depth: rotatedZ };
}

function globePixelPath(center: PlanetPoint, radius: number): string {
  const half = Math.max(4, Math.round(radius * .92));
  const left = Math.round(center.x - half);
  const top = Math.round(center.y - half);
  const right = Math.round(center.x + half + 1);
  const bottom = Math.round(center.y + half + 1);
  return `M${left},${top}L${right},${top}L${right},${bottom}L${left},${bottom}Z`;
}

function projectGlobeCell(
  cell: PlanetHex,
  base: ProjectedPlanetAtlas,
  camera: PlanetGlobeCamera,
  center: PlanetPoint,
  radius: number,
): PlanetGlobeCell | null {
  const point = globePoint(planetHexCenter(cell, base.hexRadius), base, camera, center, radius);
  if (point.depth <= 0.025) return null;
  const cellRadius = Math.max(4, 13.5 * camera.zoom * (0.65 + point.depth * 0.35));
  return { ...cell, center: point, depth: point.depth, path: globePixelPath(point, cellRadius) };
}

export function projectProjectedPlanetGlobe(base: ProjectedPlanetAtlas, camera: PlanetGlobeCamera): ProjectedPlanetGlobe {
  const center = { x: GLOBE_WIDTH / 2, y: GLOBE_HEIGHT / 2 };
  const zoom = Math.max(0.82, Math.min(5.5, camera.zoom));
  const clipRadius = GLOBE_HEIGHT * 0.36 * zoom;
  const normalizedCamera = { ...camera, zoom };
  const countries = base.countries.flatMap((country): PlanetGlobeCountry[] => {
    const cells = country.cells.flatMap((cell) => {
      const projected = projectGlobeCell(cell, base, normalizedCamera, center, clipRadius);
      return projected ? [projected] : [];
    });
    if (cells.length === 0) return [];
    const totalDepth = cells.reduce((total, cell) => total + cell.depth, 0);
    return [{
      ...country,
      cells,
      center: {
        x: cells.reduce((total, cell) => total + cell.center.x * cell.depth, 0) / totalDepth,
        y: cells.reduce((total, cell) => total + cell.center.y * cell.depth, 0) / totalDepth,
      },
    }];
  });
  const byCountry = new Map(countries.map((country) => [country.id, country]));
  const routes = base.routes.flatMap((route): PlanetRoute[] => {
    const from = byCountry.get(route.fromCountryId);
    const to = byCountry.get(route.toCountryId);
    if (!from || !to) return [];
    const midX = (from.center.x + to.center.x) / 2;
    const distance = Math.hypot(to.center.x - from.center.x, to.center.y - from.center.y);
    const midY = (from.center.y + to.center.y) / 2 - Math.max(18, distance * 0.22);
    return [{ ...route, path: `M${from.center.x.toFixed(1)} ${from.center.y.toFixed(1)} Q${midX.toFixed(1)} ${midY.toFixed(1)} ${to.center.x.toFixed(1)} ${to.center.y.toFixed(1)}` }];
  });
  const coastCells = base.coastCells.flatMap((cell) => {
    const projected = projectGlobeCell(cell, base, normalizedCamera, center, clipRadius);
    return projected ? [projected] : [];
  });
  const clouds = base.clouds.flatMap((cloud) => {
    const point = globePoint({ x: cloud.x, y: cloud.y }, base, normalizedCamera, center, clipRadius);
    if (point.depth <= 0.08) return [];
    return [{ ...cloud, x: point.x, y: point.y, scale: cloud.scale * (0.55 + point.depth * 0.35) }];
  });
  return { width: GLOBE_WIDTH, height: GLOBE_HEIGHT, center, clipRadius, countries, coastCells, routes, clouds };
}

export function projectPlanetGlobe(atlas: PlanetAtlasDto, camera: PlanetGlobeCamera): ProjectedPlanetGlobe {
  return projectProjectedPlanetGlobe(projectPlanetAtlas(atlas), camera);
}

function rectanglesOverlap(left: PlanetCountryLabelLayout, right: PlanetCountryLabelLayout): boolean {
  return left.x < right.x + right.width && left.x + left.width > right.x
    && left.y < right.y + right.height && left.y + left.height > right.y;
}

export function layoutPlanetCountryLabels(
  countries: PlanetGlobeCountry[],
  width: number,
  height: number,
): PlanetCountryLabelLayout[] {
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
      const candidate = {
        countryId: country.id,
        x: Math.max(margin, Math.min(width - labelWidth - margin, country.center.x + offset.x)),
        y: Math.max(margin, Math.min(height - labelHeight - margin, country.center.y + offset.y)),
        width: labelWidth,
        height: labelHeight,
      };
      if (!placed.some((other) => rectanglesOverlap(candidate, other))) { selected = candidate; break; }
    }
    if (!selected) {
      for (let y = margin; y <= height - labelHeight - margin && !selected; y += labelHeight + 6) {
        for (let x = margin; x <= width - labelWidth - margin; x += labelWidth + 6) {
          const candidate = { countryId: country.id, x, y, width: labelWidth, height: labelHeight };
          if (!placed.some((other) => rectanglesOverlap(candidate, other))) { selected = candidate; break; }
        }
      }
    }
    if (selected) placed.push(selected);
  }
  return placed;
}
