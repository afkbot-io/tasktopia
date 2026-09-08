import { projectPlanetWorldPoint, type PlanetPoint, type PlanetTerrainCell, type PlanetTerrainKind, type ProjectedPlanetAtlas, type ProjectedPlanetCountry } from "../../shared/planet-atlas";

export const COUNTRY_GEOGRAPHY_COLUMNS = 36;
export const COUNTRY_GEOGRAPHY_ROWS = 22;
export const COUNTRY_GEOGRAPHY_CELL_SIZE = 4;

export type CountryTerrainKind = PlanetTerrainKind | "deep_water" | "shallow_water" | "unknown";
export type CountryMacroCell = Pick<PlanetTerrainCell, "q" | "r" | "id"> & {
  terrain: CountryTerrainKind;
  ownerCountryId: string | null;
};
export type CountryGridPoint = { column: number; row: number };
export type CountryGeographyCell = CountryGridPoint & {
  id: string;
  x: number;
  y: number;
  terrain: CountryTerrainKind;
  land: boolean;
  coast: boolean;
  macroCellId: string | null;
  ownerCountryId: string | null;
  selected: boolean;
};

export type CountryGeography = {
  grid: {
    columns: typeof COUNTRY_GEOGRAPHY_COLUMNS;
    rows: typeof COUNTRY_GEOGRAPHY_ROWS;
    cellSize: typeof COUNTRY_GEOGRAPHY_CELL_SIZE;
    topology: "SQUARE_4";
  };
  cells: CountryGeographyCell[];
};

export type CountryCityAnchor = { id: string; atlasCenter: { x: number; y: number } };

/** One cached transform for cities, airports and canonical route waypoints. */
export function createCountryWorldProjection(geography: CountryGeography, country: ProjectedPlanetCountry) {
  const macroRects = new Map<string, { minX: number; minY: number; maxX: number; maxY: number }>();
  for (const cell of geography.cells) {
    if (!cell.macroCellId) continue;
    const rect = macroRects.get(cell.macroCellId) ?? { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    rect.minX = Math.min(rect.minX, cell.x); rect.minY = Math.min(rect.minY, cell.y);
    rect.maxX = Math.max(rect.maxX, cell.x + geography.grid.cellSize);
    rect.maxY = Math.max(rect.maxY, cell.y + geography.grid.cellSize);
    macroRects.set(cell.macroCellId, rect);
  }
  return (source: PlanetPoint): { point: PlanetPoint; macroCellId: string; macro: { q: number; r: number } } | null => {
    if (!country.cells.length) return null;
    const projected = projectPlanetWorldPoint(country, source, country.cells, .5);
    const rect = macroRects.get(projected.cell.id);
    if (!rect) return null;
    return { point: {
      x: rect.minX + (projected.point.x - projected.cell.q) * (rect.maxX - rect.minX),
      y: rect.minY + (projected.point.y - projected.cell.r) * (rect.maxY - rect.minY),
    }, macroCellId: projected.cell.id, macro: { q: projected.cell.q, r: projected.cell.r } };
  };
}

/** Select one country's planet cells plus a wider ring of its real continental neighbours. */
export function countryMacroContext(atlas: ProjectedPlanetAtlas, countryId: string, padding = 3): CountryMacroCell[] {
  const selected = atlas.countries.find((country) => country.id === countryId);
  if (!selected || selected.cells.length === 0) return [];
  let minQ = Math.min(...selected.cells.map((cell) => cell.q)) - padding;
  let maxQ = Math.max(...selected.cells.map((cell) => cell.q)) + padding;
  let minR = Math.min(...selected.cells.map((cell) => cell.r)) - padding;
  let maxR = Math.max(...selected.cells.map((cell) => cell.r)) + padding;
  // Include real terrain across the viewport's aspect ratio, instead of
  // letterboxing a narrow crop with water that may actually be foreign land.
  const width = maxQ - minQ + 1, height = maxR - minR + 1;
  const extraQ = Math.max(0, Math.ceil(height * COUNTRY_GEOGRAPHY_COLUMNS / COUNTRY_GEOGRAPHY_ROWS) - width);
  const extraR = Math.max(0, Math.ceil(width * COUNTRY_GEOGRAPHY_ROWS / COUNTRY_GEOGRAPHY_COLUMNS) - height);
  minQ -= Math.floor(extraQ / 2); maxQ += Math.ceil(extraQ / 2);
  minR -= Math.floor(extraR / 2); maxR += Math.ceil(extraR / 2);
  const inside = (cell: { q: number; r: number }) => cell.q >= minQ && cell.q <= maxQ && cell.r >= minR && cell.r <= maxR;
  const context = new Map<string, CountryMacroCell>();
  for (const cell of atlas.oceanCells) if (inside(cell)) context.set(`${cell.q}:${cell.r}`, {
    ...cell, id: `ocean:${cell.q}:${cell.r}`, terrain: "deep_water", ownerCountryId: null,
  });
  for (const cell of atlas.coastCells) if (inside(cell)) context.set(`${cell.q}:${cell.r}`, {
    ...cell, ownerCountryId: null,
  });
  for (const country of atlas.countries) for (const cell of country.cells) if (inside(cell)) context.set(`${cell.q}:${cell.r}`, {
    ...cell, ownerCountryId: country.id,
  });
  return [...context.values()].sort((left, right) => left.r - right.r || left.q - right.q);
}

export function countryGridNeighbors(cell: CountryGridPoint): CountryGridPoint[] {
  return [
    { column: cell.column + 1, row: cell.row },
    { column: cell.column - 1, row: cell.row },
    { column: cell.column, row: cell.row + 1 },
    { column: cell.column, row: cell.row - 1 },
  ];
}

/** Keep miniature cities on distinct dry cells while minimizing displacement. */
export function snapCountryCitiesToLand(
  geography: CountryGeography,
  cities: readonly CountryCityAnchor[],
): Map<string, { x: number; y: number }> {
  const available = geography.cells.filter((cell) => cell.selected && cell.land && cell.terrain !== "coast");
  const used = new Set<string>();
  const result = new Map<string, { x: number; y: number }>();
  for (const city of cities) {
    const nearest = available
      .filter((cell) => !used.has(cell.id))
      .sort((left, right) => {
        const leftDistance = (left.x + geography.grid.cellSize / 2 - city.atlasCenter.x) ** 2
          + (left.y + geography.grid.cellSize / 2 - city.atlasCenter.y) ** 2;
        const rightDistance = (right.x + geography.grid.cellSize / 2 - city.atlasCenter.x) ** 2
          + (right.y + geography.grid.cellSize / 2 - city.atlasCenter.y) ** 2;
        return leftDistance - rightDistance || left.row - right.row || left.column - right.column;
      })[0];
    if (!nearest) {
      result.set(city.id, city.atlasCenter);
      continue;
    }
    used.add(nearest.id);
    result.set(city.id, {
      x: nearest.x + geography.grid.cellSize / 2,
      y: nearest.y + geography.grid.cellSize / 2,
    });
  }
  return result;
}

/**
 * Expands the planet's coarse square cells into the country's denser square
 * grid. Geography is inherited, never rerolled for the selected country.
 * The renderer's texture variations provide detail within each terrain family.
 */
export function buildCountryGeography(input: {
  countryId: string;
  seed: number;
  macroCells: ReadonlyArray<CountryMacroCell>;
}): CountryGeography {
  const macroByKey = new Map(input.macroCells.map((cell) => [`${cell.q}:${cell.r}`, cell]));
  const minQ = input.macroCells.length > 0 ? Math.min(...input.macroCells.map((cell) => cell.q)) : 0;
  const maxQ = input.macroCells.length > 0 ? Math.max(...input.macroCells.map((cell) => cell.q)) : 0;
  const minR = input.macroCells.length > 0 ? Math.min(...input.macroCells.map((cell) => cell.r)) : 0;
  const maxR = input.macroCells.length > 0 ? Math.max(...input.macroCells.map((cell) => cell.r)) : 0;
  const macroWidth = Math.max(1, maxQ - minQ + 1);
  const macroHeight = Math.max(1, maxR - minR + 1);
  // Preserve the PLANET macro aspect ratio. Unused cells are explicit
  // unknown context, never an invented ocean border.
  const macroScale = Math.min(COUNTRY_GEOGRAPHY_COLUMNS / macroWidth, COUNTRY_GEOGRAPHY_ROWS / macroHeight);
  const landColumns = Math.max(1, Math.min(COUNTRY_GEOGRAPHY_COLUMNS, Math.floor(macroWidth * macroScale)));
  const landRows = Math.max(1, Math.min(COUNTRY_GEOGRAPHY_ROWS, Math.floor(macroHeight * macroScale)));
  const paddingX = Math.floor((COUNTRY_GEOGRAPHY_COLUMNS - landColumns) / 2);
  const paddingY = Math.floor((COUNTRY_GEOGRAPHY_ROWS - landRows) / 2);

  const owners = new Map<string, (typeof input.macroCells)[number]>();
  for (let row = paddingY; row < paddingY + landRows; row += 1) {
    for (let column = paddingX; column < paddingX + landColumns; column += 1) {
      const q = minQ + Math.min(macroWidth - 1, Math.floor((column - paddingX) * macroWidth / landColumns));
      const r = minR + Math.min(macroHeight - 1, Math.floor((row - paddingY) * macroHeight / landRows));
      const owner = macroByKey.get(`${q}:${r}`);
      if (owner) owners.set(`${column}:${row}`, owner);
    }
  }

  const cells: CountryGeographyCell[] = [];
  for (let row = 0; row < COUNTRY_GEOGRAPHY_ROWS; row += 1) {
    for (let column = 0; column < COUNTRY_GEOGRAPHY_COLUMNS; column += 1) {
      const owner = owners.get(`${column}:${row}`);
      const terrain: CountryTerrainKind = owner?.terrain ?? "unknown";
      const land = !["deep_water", "shallow_water", "river", "unknown"].includes(terrain);
      const coast = terrain === "coast";
      cells.push({
        id: `${input.countryId}:country-cell:${column}:${row}`,
        column,
        row,
        x: column * COUNTRY_GEOGRAPHY_CELL_SIZE,
        y: row * COUNTRY_GEOGRAPHY_CELL_SIZE,
        terrain,
        land,
        coast,
        macroCellId: owner?.id ?? null,
        ownerCountryId: owner?.ownerCountryId ?? null,
        selected: owner?.ownerCountryId === input.countryId,
      });
    }
  }
  return {
    grid: {
      columns: COUNTRY_GEOGRAPHY_COLUMNS,
      rows: COUNTRY_GEOGRAPHY_ROWS,
      cellSize: COUNTRY_GEOGRAPHY_CELL_SIZE,
      topology: "SQUARE_4",
    },
    cells,
  };
}
