import type { Cell, Rect, TerrainKind } from "../../shared/contracts";
import { COUNTRY_ATLAS_TERRAIN_TILE_CELLS } from "../../shared/country-atlas-contract";
import { aStarPath, cellKey, intersects } from "./grid";

const CELL_SIZE_PX = 8;
// A country view should still read as a collection of living cities rather
// than map pins. The 3/8 tier gives the common 100×100-cell city 50% more
// presence than the former 1/4 miniature without crowding eight-city atlases.
const TARGET_CITY_TEXTURE_PX = 320;
const CITY_GAP_CELLS = 6;
const ATLAS_MARGIN_CELLS = 8;
const LABEL_GAP_CELLS = 1;
const DISTANCE_COMPRESSION = 0.12;
const DISTRICT_DISTANCE_COMPRESSION = 0.55;
const DISTRICT_GAP_CELLS = 1;
// Labels and collision reservations add much more height than the source
// constellation. This correction target settles to a normal landscape atlas.
const TARGET_ATLAS_ASPECT = 5.5;
const SCALE_TIERS = [0.5, 0.375, 0.25, 0.125, 0.0625] as const;
const CITY_CUTOUT_BUFFER_CELLS = 2;

export type CountryAtlasScale = typeof SCALE_TIERS[number];

export type CountryAtlasProjectionInput = {
  terrainSampler?: (cell: Cell) => { terrain: TerrainKind; variant: number };
  cities: Array<{
    id: string;
    sourceCenter: Cell;
    /**
     * Complete visual bounds of the city composition, including authored
     * sprite overhang above gameplay footprints. Read this from the active
     * manifest/render catalog rather than assuming an 8 px footprint box.
     */
    sourceVisualSizePx: { width: number; height: number };
    /**
     * District geometry in absolute world cells. The atlas treats each
     * district as a rigid visual cluster and uses their union as the city
     * cutout. Terrain, roads, props and buildings can then share this mask.
     */
    districts?: Array<{ id: string; cells: Cell[] }>;
    /** Measured label card size; callers may omit it for the safe default. */
    labelSizePx?: { width: number; height: number };
  }>;
};

export type ProjectedAtlasCity = {
  id: string;
  sourceCenter: Cell;
  atlasCenter: Cell;
  atlasBounds: Rect;
  labelBounds: Rect;
  scale: CountryAtlasScale;
  miniatureSizePx: { width: number; height: number };
  atlasMask: Cell[];
  cutoutMask: Cell[];
  cutoutTerrain: ProjectedAtlasTerrainCell[];
  districts: ProjectedAtlasDistrict[];
};

export type ProjectedAtlasTerrainCell = {
  atlasCell: Cell;
  sourceCell: Cell;
  terrain: TerrainKind;
  variant: number;
};

export type ProjectedAtlasMacroTerrain = {
  id: string;
  atlasOrigin: Cell;
  widthCells: number;
  heightCells: number;
  atlasCenter: { x: number; y: number };
  sourceCenter: Cell;
  terrain: TerrainKind;
  variant: number;
};

export type ProjectedAtlasDistrict = {
  id: string;
  sourceCenter: { x: number; y: number };
  atlasCenter: Cell;
  atlasCells: Cell[];
  displayCells: Cell[];
};

export type ProjectedAtlasConnection = {
  fromCityId: string;
  toCityId: string;
  path: Cell[];
};

export type CountryAtlasProjection = {
  bounds: Rect;
  cities: ProjectedAtlasCity[];
  connections: ProjectedAtlasConnection[];
  macroTerrain: ProjectedAtlasMacroTerrain[];
};

type PreparedCity = CountryAtlasProjectionInput["cities"][number] & {
  scale: CountryAtlasScale;
  miniatureSizePx: { width: number; height: number };
  miniatureWidthCells: number;
  miniatureHeightCells: number;
  labelWidthCells: number;
  labelHeightCells: number;
  collisionWidthCells: number;
  collisionHeightCells: number;
  compactedDistricts: Array<{
    id: string;
    sourceCenter: { x: number; y: number };
    atlasCenter: Cell;
    atlasCells: Cell[];
  }>;
  position: { x: number; y: number };
};

type DistrictDraft = {
  id: string;
  sourceCenter: { x: number; y: number };
  localCells: Cell[];
  position: { x: number; y: number };
};

function selectScale(size: { width: number; height: number }): CountryAtlasScale {
  return SCALE_TIERS.find((scale) => (
    size.width * scale <= TARGET_CITY_TEXTURE_PX
    && size.height * scale <= TARGET_CITY_TEXTURE_PX
  )) ?? SCALE_TIERS.at(-1)!;
}

function sizedBounds(widthCells: number, heightCells: number, center: Cell): Rect {
  const minX = center.x - Math.floor(widthCells / 2);
  const minY = center.y - Math.floor(heightCells / 2);
  return {
    minX,
    minY,
    maxX: minX + widthCells - 1,
    maxY: minY + heightCells - 1,
  };
}

function compareCells(left: Cell, right: Cell): number {
  return left.y - right.y || left.x - right.x;
}

function cellsBounds(cells: Cell[]): Rect {
  const first = cells[0];
  if (!first) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const bounds = { minX: first.x, minY: first.y, maxX: first.x, maxY: first.y };
  for (let index = 1; index < cells.length; index += 1) {
    const cell = cells[index]!;
    if (cell.x < bounds.minX) bounds.minX = cell.x;
    if (cell.y < bounds.minY) bounds.minY = cell.y;
    if (cell.x > bounds.maxX) bounds.maxX = cell.x;
    if (cell.y > bounds.maxY) bounds.maxY = cell.y;
  }
  return bounds;
}

function bufferedCutout(cells: Cell[]): Cell[] {
  const result = new Map<string, Cell>();
  for (const cell of cells) {
    for (let dy = -CITY_CUTOUT_BUFFER_CELLS; dy <= CITY_CUTOUT_BUFFER_CELLS; dy += 1) {
      for (let dx = -CITY_CUTOUT_BUFFER_CELLS; dx <= CITY_CUTOUT_BUFFER_CELLS; dx += 1) {
        if (Math.abs(dx) + Math.abs(dy) > CITY_CUTOUT_BUFFER_CELLS) continue;
        const buffered = { x: cell.x + dx, y: cell.y + dy };
        result.set(cellKey(buffered), buffered);
      }
    }
  }
  return [...result.values()].sort(compareCells);
}

function sourceCellForCutout(city: ProjectedAtlasCity, cell: Cell): Cell {
  const district = [...city.districts].sort((left, right) => {
    const leftDistance = (cell.x - left.atlasCenter.x) ** 2 + (cell.y - left.atlasCenter.y) ** 2;
    const rightDistance = (cell.x - right.atlasCenter.x) ** 2 + (cell.y - right.atlasCenter.y) ** 2;
    return leftDistance - rightDistance || left.id.localeCompare(right.id);
  })[0];
  if (!district) {
    return {
      x: city.sourceCenter.x + Math.round((cell.x - city.atlasCenter.x) / city.scale),
      y: city.sourceCenter.y + Math.round((cell.y - city.atlasCenter.y) / city.scale),
    };
  }
  return {
    x: Math.round(district.sourceCenter.x + (cell.x - district.atlasCenter.x) / city.scale),
    y: Math.round(district.sourceCenter.y + (cell.y - district.atlasCenter.y) / city.scale),
  };
}

function macroTerrain(
  bounds: Rect,
  cities: ProjectedAtlasCity[],
  sampler: NonNullable<CountryAtlasProjectionInput["terrainSampler"]> | undefined,
): ProjectedAtlasMacroTerrain[] {
  if (!sampler || cities.length === 0) return [];
  const sourceSpan = {
    x: Math.max(...cities.map((city) => city.sourceCenter.x)) - Math.min(...cities.map((city) => city.sourceCenter.x)),
    y: Math.max(...cities.map((city) => city.sourceCenter.y)) - Math.min(...cities.map((city) => city.sourceCenter.y)),
  };
  const atlasSpan = {
    x: Math.max(...cities.map((city) => city.atlasCenter.x)) - Math.min(...cities.map((city) => city.atlasCenter.x)),
    y: Math.max(...cities.map((city) => city.atlasCenter.y)) - Math.min(...cities.map((city) => city.atlasCenter.y)),
  };
  const sourcePerAtlas = {
    x: atlasSpan.x > 0 ? sourceSpan.x / atlasSpan.x : 1 / DISTANCE_COMPRESSION,
    y: atlasSpan.y > 0 ? sourceSpan.y / atlasSpan.y : 1 / DISTANCE_COMPRESSION,
  };
  const tileSize = COUNTRY_ATLAS_TERRAIN_TILE_CELLS;
  const result: ProjectedAtlasMacroTerrain[] = [];
  for (let y = bounds.minY; y <= bounds.maxY; y += tileSize) {
    for (let x = bounds.minX; x <= bounds.maxX; x += tileSize) {
      const widthCells = Math.min(tileSize, bounds.maxX - x + 1);
      const heightCells = Math.min(tileSize, bounds.maxY - y + 1);
      const atlasCenter = {
        x: x + widthCells / 2,
        y: y + heightCells / 2,
      };
      let totalWeight = 0;
      let residualX = 0;
      let residualY = 0;
      for (const city of cities) {
        const distanceSquared = (atlasCenter.x - city.atlasCenter.x) ** 2 + (atlasCenter.y - city.atlasCenter.y) ** 2;
        const weight = 1 / Math.max(0.25, distanceSquared);
        totalWeight += weight;
        residualX += (city.sourceCenter.x - city.atlasCenter.x * sourcePerAtlas.x) * weight;
        residualY += (city.sourceCenter.y - city.atlasCenter.y * sourcePerAtlas.y) * weight;
      }
      const sourceCenter = {
        x: Math.round(atlasCenter.x * sourcePerAtlas.x + residualX / totalWeight),
        y: Math.round(atlasCenter.y * sourcePerAtlas.y + residualY / totalWeight),
      };
      result.push({
        id: `${x}:${y}`,
        atlasOrigin: { x, y },
        widthCells,
        heightCells,
        atlasCenter,
        sourceCenter,
        ...sampler(sourceCenter),
      });
    }
  }
  return result;
}

function translatedDistrictBounds(district: DistrictDraft): Rect {
  const bounds = cellsBounds(district.localCells);
  return {
    minX: bounds.minX + district.position.x,
    minY: bounds.minY + district.position.y,
    maxX: bounds.maxX + district.position.x,
    maxY: bounds.maxY + district.position.y,
  };
}

function districtAxis(left: DistrictDraft, right: DistrictDraft): "x" | "y" {
  const dx = right.sourceCenter.x - left.sourceCenter.x;
  const dy = right.sourceCenter.y - left.sourceCenter.y;
  if (Math.abs(dx) !== Math.abs(dy)) return Math.abs(dx) > Math.abs(dy) ? "x" : "y";
  return left.id.localeCompare(right.id) <= 0 ? "x" : "y";
}

function separateDistricts(districts: DistrictDraft[]): void {
  for (let iteration = 0; iteration < 128; iteration += 1) {
    let separated = true;
    for (let leftIndex = 0; leftIndex < districts.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < districts.length; rightIndex += 1) {
        const left = districts[leftIndex]!;
        const right = districts[rightIndex]!;
        const leftBounds = translatedDistrictBounds(left);
        const rightBounds = translatedDistrictBounds(right);
        const leftCenter = { x: (leftBounds.minX + leftBounds.maxX) / 2, y: (leftBounds.minY + leftBounds.maxY) / 2 };
        const rightCenter = { x: (rightBounds.minX + rightBounds.maxX) / 2, y: (rightBounds.minY + rightBounds.maxY) / 2 };
        const requiredX = (leftBounds.maxX - leftBounds.minX + rightBounds.maxX - rightBounds.minX + 2) / 2 + DISTRICT_GAP_CELLS;
        const requiredY = (leftBounds.maxY - leftBounds.minY + rightBounds.maxY - rightBounds.minY + 2) / 2 + DISTRICT_GAP_CELLS;
        const overlapX = requiredX - Math.abs(rightCenter.x - leftCenter.x);
        const overlapY = requiredY - Math.abs(rightCenter.y - leftCenter.y);
        if (overlapX <= 0 || overlapY <= 0) continue;
        separated = false;
        const axis = districtAxis(left, right);
        const sourceDelta = axis === "x"
          ? right.sourceCenter.x - left.sourceCenter.x
          : right.sourceCenter.y - left.sourceCenter.y;
        const projectedDelta = axis === "x"
          ? right.position.x - left.position.x
          : right.position.y - left.position.y;
        const direction = Math.sign(sourceDelta || projectedDelta || 1);
        const shift = (axis === "x" ? overlapX : overlapY) / 2 + 0.5;
        if (axis === "x") {
          left.position.x -= direction * shift;
          right.position.x += direction * shift;
        } else {
          left.position.y -= direction * shift;
          right.position.y += direction * shift;
        }
      }
    }
    if (separated) return;
  }
  throw new Error("Country atlas district packing did not converge");
}

function compactDistricts(
  city: CountryAtlasProjectionInput["cities"][number],
  scale: CountryAtlasScale,
): PreparedCity["compactedDistricts"] {
  const drafts: DistrictDraft[] = [...(city.districts ?? [])]
    .filter((district) => district.cells.length > 0)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((district) => {
      const bounds = cellsBounds(district.cells);
      const sourceCenter = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
      const unique = new Map<string, Cell>();
      for (const sourceCell of district.cells) {
        const localCell = {
          x: Math.round((sourceCell.x - sourceCenter.x) * scale),
          y: Math.round((sourceCell.y - sourceCenter.y) * scale),
        };
        unique.set(cellKey(localCell), localCell);
      }
      return {
        id: district.id,
        sourceCenter,
        localCells: [...unique.values()].sort(compareCells),
        position: {
          x: Math.round((sourceCenter.x - city.sourceCenter.x) * scale * DISTRICT_DISTANCE_COMPRESSION),
          y: Math.round((sourceCenter.y - city.sourceCenter.y) * scale * DISTRICT_DISTANCE_COMPRESSION),
        },
      };
    });
  separateDistricts(drafts);
  return drafts.map((district) => ({
    id: district.id,
    sourceCenter: district.sourceCenter,
    atlasCenter: { x: Math.round(district.position.x), y: Math.round(district.position.y) },
    atlasCells: district.localCells.map((cell) => ({
      x: cell.x + Math.round(district.position.x),
      y: cell.y + Math.round(district.position.y),
    })).sort(compareCells),
  }));
}

function projectDistricts(city: PreparedCity, atlasCenter: Cell): ProjectedAtlasCity["districts"] {
  return city.compactedDistricts.map((district) => ({
    id: district.id,
    sourceCenter: district.sourceCenter,
    atlasCenter: {
      x: district.atlasCenter.x + atlasCenter.x,
      y: district.atlasCenter.y + atlasCenter.y,
    },
    atlasCells: district.atlasCells.map((cell) => ({ x: cell.x + atlasCenter.x, y: cell.y + atlasCenter.y })),
    displayCells: [],
  }));
}

function partitionCutout(cutoutMask: Cell[], districts: ProjectedAtlasDistrict[]): void {
  if (districts.length === 0) return;
  const cellsByDistrict = new Map(districts.map((district) => [district.id, [] as Cell[]]));
  for (const cell of cutoutMask) {
    const owner = [...districts].sort((left, right) => {
      const distanceTo = (district: ProjectedAtlasDistrict) => Math.min(...district.atlasCells.map((candidate) => (
        Math.abs(cell.x - candidate.x) + Math.abs(cell.y - candidate.y)
      )));
      return distanceTo(left) - distanceTo(right) || left.id.localeCompare(right.id);
    })[0]!;
    cellsByDistrict.get(owner.id)!.push(cell);
  }
  for (const district of districts) district.displayCells = cellsByDistrict.get(district.id)!.sort(compareCells);
}

function collisionBounds(city: PreparedCity, center: Cell): Rect {
  return sizedBounds(city.collisionWidthCells, city.collisionHeightCells, center);
}

function stableAxis(left: PreparedCity, right: PreparedCity): "x" | "y" {
  const sourceDx = right.sourceCenter.x - left.sourceCenter.x;
  const sourceDy = right.sourceCenter.y - left.sourceCenter.y;
  if (Math.abs(sourceDx) !== Math.abs(sourceDy)) return Math.abs(sourceDx) > Math.abs(sourceDy) ? "x" : "y";
  let hash = 0;
  for (const character of `${left.id}:${right.id}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0) % 2 === 0 ? "x" : "y";
}

function stableDirection(left: PreparedCity, right: PreparedCity, axis: "x" | "y"): number {
  const sourceDelta = axis === "x"
    ? right.sourceCenter.x - left.sourceCenter.x
    : right.sourceCenter.y - left.sourceCenter.y;
  if (sourceDelta !== 0) return Math.sign(sourceDelta);
  const projectedDelta = axis === "x"
    ? right.position.x - left.position.x
    : right.position.y - left.position.y;
  return projectedDelta === 0 ? 1 : Math.sign(projectedDelta);
}

function separateCities(cities: PreparedCity[]): void {
  for (let iteration = 0; iteration < 512; iteration += 1) {
    let separated = true;
    for (let leftIndex = 0; leftIndex < cities.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < cities.length; rightIndex += 1) {
        const left = cities[leftIndex]!;
        const right = cities[rightIndex]!;
        const requiredX = (left.collisionWidthCells + right.collisionWidthCells) / 2 + CITY_GAP_CELLS;
        const requiredY = (left.collisionHeightCells + right.collisionHeightCells) / 2 + CITY_GAP_CELLS;
        const overlapX = requiredX - Math.abs(right.position.x - left.position.x);
        const overlapY = requiredY - Math.abs(right.position.y - left.position.y);
        if (overlapX <= 0 || overlapY <= 0) continue;
        separated = false;
        const axis = stableAxis(left, right);
        const direction = stableDirection(left, right, axis);
        const shift = (axis === "x" ? overlapX : overlapY) / 2 + 0.5;
        if (axis === "x") {
          left.position.x -= direction * shift;
          right.position.x += direction * shift;
        } else {
          left.position.y -= direction * shift;
          right.position.y += direction * shift;
        }
      }
    }
    if (separated) return;
  }
  throw new Error("Country atlas city packing did not converge");
}

function roundedCitiesDoNotOverlap(cities: PreparedCity[]): boolean {
  return cities.every((left, leftIndex) => cities.slice(leftIndex + 1).every((right) => !intersects(
    collisionBounds(left, { x: Math.round(left.position.x), y: Math.round(left.position.y) }),
    collisionBounds(right, { x: Math.round(right.position.x), y: Math.round(right.position.y) }),
  )));
}

function settleRoundedCities(cities: PreparedCity[]): void {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    separateCities(cities);
    for (const city of cities) {
      city.position.x = Math.round(city.position.x);
      city.position.y = Math.round(city.position.y);
    }
    if (roundedCitiesDoNotOverlap(cities)) return;
  }
  throw new Error("Country atlas city packing overlaps after pixel snapping");
}

function connectionPort(city: ProjectedAtlasCity, target: Cell): Cell {
  const dx = target.x - city.atlasCenter.x;
  const dy = target.y - city.atlasCenter.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return {
      x: dx < 0 ? city.atlasBounds.minX - 1 : city.atlasBounds.maxX + 1,
      y: Math.max(city.atlasBounds.minY, Math.min(city.atlasBounds.maxY, target.y)),
    };
  }
  return {
    x: Math.max(city.atlasBounds.minX, Math.min(city.atlasBounds.maxX, target.x)),
    y: dy < 0 ? city.atlasBounds.minY - 1 : city.atlasBounds.maxY + 1,
  };
}

function minimumSpanningEdges(cities: ProjectedAtlasCity[]): Array<readonly [ProjectedAtlasCity, ProjectedAtlasCity]> {
  const candidates: Array<{ left: ProjectedAtlasCity; right: ProjectedAtlasCity; distance: number }> = [];
  for (let left = 0; left < cities.length; left += 1) {
    for (let right = left + 1; right < cities.length; right += 1) {
      const a = cities[left]!;
      const b = cities[right]!;
      const dx = b.atlasCenter.x - a.atlasCenter.x;
      const dy = b.atlasCenter.y - a.atlasCenter.y;
      candidates.push({ left: a, right: b, distance: dx * dx + dy * dy });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance
    || a.left.id.localeCompare(b.left.id)
    || a.right.id.localeCompare(b.right.id));

  const parent = new Map(cities.map((city) => [city.id, city.id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cursor = id;
    while (parent.get(cursor) !== root) {
      const next = parent.get(cursor)!;
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };
  const result: Array<readonly [ProjectedAtlasCity, ProjectedAtlasCity]> = [];
  for (const candidate of candidates) {
    const leftRoot = find(candidate.left.id);
    const rightRoot = find(candidate.right.id);
    if (leftRoot === rightRoot) continue;
    parent.set(rightRoot, leftRoot);
    result.push([candidate.left, candidate.right]);
    if (result.length === cities.length - 1) break;
  }
  return result;
}

function routeConnections(cities: ProjectedAtlasCity[], atlasBounds: Rect): ProjectedAtlasConnection[] {
  const occupied = new Set(cities.flatMap((city) => {
    const cells: string[] = [];
    for (const bounds of [city.atlasBounds, city.labelBounds]) {
      for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
        for (let x = bounds.minX; x <= bounds.maxX; x += 1) cells.push(cellKey({ x, y }));
      }
    }
    return cells;
  }));
  const existingPath = new Set<string>();
  const searchMargin = Math.max(48, atlasBounds.maxX - atlasBounds.minX, atlasBounds.maxY - atlasBounds.minY);
  return minimumSpanningEdges(cities).map(([left, right]) => {
    const start = connectionPort(left, right.atlasCenter);
    const end = connectionPort(right, left.atlasCenter);
    const path = aStarPath(start, end, (cell) => {
      if (cell.x < atlasBounds.minX || cell.x > atlasBounds.maxX || cell.y < atlasBounds.minY || cell.y > atlasBounds.maxY) {
        return Number.POSITIVE_INFINITY;
      }
      if (occupied.has(cellKey(cell))) return Number.POSITIVE_INFINITY;
      return existingPath.has(cellKey(cell)) ? 0.35 : 1;
    }, searchMargin, 0.08, false);
    if (path.length === 0) throw new Error(`Country atlas could not connect ${left.id} to ${right.id}`);
    for (const cell of path) existingPath.add(cellKey(cell));
    return { fromCityId: left.id, toCityId: right.id, path };
  }).sort((a, b) => a.fromCityId.localeCompare(b.fromCityId) || a.toCityId.localeCompare(b.toCityId));
}

/**
 * Build the compact, presentation-only city layout. The function is pure and
 * deliberately knows nothing about PostgreSQL, HTTP, PixiJS or asset paths.
 */
export function projectCountryAtlas(input: CountryAtlasProjectionInput): CountryAtlasProjection {
  if (input.cities.length === 0) {
    return { bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, cities: [], connections: [], macroTerrain: [] };
  }
  const ordered = [...input.cities].sort((left, right) => left.id.localeCompare(right.id));
  const centroid = ordered.reduce((sum, city) => ({
    x: sum.x + city.sourceCenter.x / ordered.length,
    y: sum.y + city.sourceCenter.y / ordered.length,
  }), { x: 0, y: 0 });
  const sourceSpan = {
    x: Math.max(...ordered.map((city) => city.sourceCenter.x)) - Math.min(...ordered.map((city) => city.sourceCenter.x)),
    y: Math.max(...ordered.map((city) => city.sourceCenter.y)) - Math.min(...ordered.map((city) => city.sourceCenter.y)),
  };
  const axisCorrection = sourceSpan.x > 0 && sourceSpan.y > 0
    ? Math.max(0.65, Math.min(3.2, Math.sqrt(TARGET_ATLAS_ASPECT / (sourceSpan.x / sourceSpan.y))))
    : 1;
  const distanceCompression = {
    x: DISTANCE_COMPRESSION * axisCorrection,
    y: DISTANCE_COMPRESSION / axisCorrection,
  };
  const prepared: PreparedCity[] = ordered.map((city) => {
    const scale = selectScale(city.sourceVisualSizePx);
    const miniatureSizePx = {
      width: Math.ceil(city.sourceVisualSizePx.width * scale),
      height: Math.ceil(city.sourceVisualSizePx.height * scale),
    };
    const miniatureWidthCells = Math.max(1, Math.ceil(miniatureSizePx.width / CELL_SIZE_PX));
    const miniatureHeightCells = Math.max(1, Math.ceil(miniatureSizePx.height / CELL_SIZE_PX));
    const labelSizePx = city.labelSizePx ?? { width: 96, height: 20 };
    const labelWidthCells = Math.max(1, Math.ceil(labelSizePx.width / CELL_SIZE_PX));
    const labelHeightCells = Math.max(1, Math.ceil(labelSizePx.height / CELL_SIZE_PX));
    const compactedDistricts = compactDistricts(city, scale);
    const position = {
      x: Math.round((city.sourceCenter.x - centroid.x) * distanceCompression.x),
      y: Math.round((city.sourceCenter.y - centroid.y) * distanceCompression.y),
    };
    return {
      ...city,
      scale,
      miniatureSizePx,
      miniatureWidthCells,
      miniatureHeightCells,
      labelWidthCells,
      labelHeightCells,
      collisionWidthCells: Math.max(miniatureWidthCells, labelWidthCells),
      // The symmetric reservation intentionally leaves the label's height
      // below the miniature too. It is conservative and keeps packing pure.
      collisionHeightCells: miniatureHeightCells + 2 * (labelHeightCells + LABEL_GAP_CELLS + CITY_CUTOUT_BUFFER_CELLS),
      compactedDistricts,
      position,
    };
  });
  settleRoundedCities(prepared);

  const rawBounds = prepared.map((city) => collisionBounds(city, {
    x: Math.round(city.position.x),
    y: Math.round(city.position.y),
  }));
  const shift = {
    x: ATLAS_MARGIN_CELLS - Math.min(...rawBounds.map((bounds) => bounds.minX)),
    y: ATLAS_MARGIN_CELLS - Math.min(...rawBounds.map((bounds) => bounds.minY)),
  };
  const cities: ProjectedAtlasCity[] = prepared.map((city) => {
    const atlasCenter = {
      x: Math.round(city.position.x) + shift.x,
      y: Math.round(city.position.y) + shift.y,
    };
    const atlasBounds = sizedBounds(city.miniatureWidthCells, city.miniatureHeightCells, atlasCenter);
    const labelMaxY = atlasBounds.minY - LABEL_GAP_CELLS - CITY_CUTOUT_BUFFER_CELLS - 1;
    const labelMinX = atlasCenter.x - Math.floor(city.labelWidthCells / 2);
    const districts = projectDistricts(city, atlasCenter);
    const atlasMask = [...new Map(districts
      .flatMap((district) => district.atlasCells)
      .map((cell) => [cellKey(cell), cell] as const)).values()].sort(compareCells);
    const cutoutMask = bufferedCutout(atlasMask);
    partitionCutout(cutoutMask, districts);
    const projectedCity: ProjectedAtlasCity = {
      id: city.id,
      sourceCenter: { ...city.sourceCenter },
      atlasCenter,
      atlasBounds,
      labelBounds: {
        minX: labelMinX,
        minY: labelMaxY - city.labelHeightCells + 1,
        maxX: labelMinX + city.labelWidthCells - 1,
        maxY: labelMaxY,
      },
      scale: city.scale,
      miniatureSizePx: city.miniatureSizePx,
      atlasMask,
      cutoutMask,
      cutoutTerrain: [],
      districts,
    };
    projectedCity.cutoutTerrain = input.terrainSampler
      ? projectedCity.cutoutMask.map((atlasCell) => {
        const sourceCell = sourceCellForCutout(projectedCity, atlasCell);
        return { atlasCell, sourceCell, ...input.terrainSampler!(sourceCell) };
      })
      : [];
    return projectedCity;
  });
  const renderedCells = cities.flatMap((city) => city.cutoutMask);
  const renderedBounds = cellsBounds(renderedCells);
  const bounds: Rect = {
    minX: 0,
    minY: 0,
    maxX: Math.max(renderedBounds.maxX, ...cities.flatMap((city) => [city.atlasBounds.maxX, city.labelBounds.maxX])) + ATLAS_MARGIN_CELLS,
    maxY: Math.max(renderedBounds.maxY, ...cities.flatMap((city) => [city.atlasBounds.maxY, city.labelBounds.maxY])) + ATLAS_MARGIN_CELLS,
  };
  return {
    bounds,
    cities,
    connections: routeConnections(cities, bounds),
    macroTerrain: macroTerrain(bounds, cities, input.terrainSampler),
  };
}
