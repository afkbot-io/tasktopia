import type { PlanetTerrainCell, PlanetTerrainKind, ProjectedPlanetAtlas } from "../../shared/planet-atlas";

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

/** Select one country's planet cells plus the immediately visible world ring. */
export function countryMacroContext(atlas: ProjectedPlanetAtlas, countryId: string, padding = 1): CountryMacroCell[] {
  const selected = atlas.countries.find((country) => country.id === countryId);
  if (!selected || selected.cells.length === 0) return [];
  const minQ = Math.min(...selected.cells.map((cell) => cell.q)) - padding;
  const maxQ = Math.max(...selected.cells.map((cell) => cell.q)) + padding;
  const minR = Math.min(...selected.cells.map((cell) => cell.r)) - padding;
  const maxR = Math.max(...selected.cells.map((cell) => cell.r)) + padding;
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
  const available = geography.cells.filter((cell) => cell.land && cell.terrain !== "coast");
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

function hashText(value: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function detailedTerrain(base: PlanetTerrainKind, value: number): PlanetTerrainKind {
  const percentile = value % 100;
  switch (base) {
    case "mountain": return percentile < 72 ? "mountain" : percentile < 90 ? "hill" : "stone";
    case "hill": return percentile < 66 ? "hill" : percentile < 84 ? "stone" : "grass";
    case "forest": return percentile < 80 ? "forest" : percentile < 95 ? "grass" : "meadow";
    case "river": return percentile < 76 ? "river" : percentile < 91 ? "grass" : "forest";
    case "stone": return percentile < 76 ? "stone" : percentile < 90 ? "hill" : "grass";
    case "coast": return percentile < 70 ? "coast" : "grass";
    case "meadow": return percentile < 78 ? "meadow" : "grass";
    default: return percentile < 82 ? "grass" : percentile < 94 ? "meadow" : "forest";
  }
}

/**
 * Expands the planet's coarse square cells into the country's denser square
 * grid. The macro cell owns the local terrain family, while deterministic
 * sub-cell noise adds detail without moving the feature to another region.
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

  const isLandMacro = (cell: CountryMacroCell | undefined) => Boolean(cell?.ownerCountryId);
  const isWaterMacro = (cell: CountryMacroCell | undefined) => cell?.terrain === "deep_water" || cell?.terrain === "shallow_water" || cell?.terrain === "coast";
  const cells: CountryGeographyCell[] = [];
  for (let row = 0; row < COUNTRY_GEOGRAPHY_ROWS; row += 1) {
    for (let column = 0; column < COUNTRY_GEOGRAPHY_COLUMNS; column += 1) {
      const owner = owners.get(`${column}:${row}`);
      const land = isLandMacro(owner);
      const coast = land && countryGridNeighbors({ column, row })
        .some((neighbor) => isWaterMacro(owners.get(`${neighbor.column}:${neighbor.row}`)));
      const value = hashText(`${input.countryId}:${column}:${row}`, input.seed);
      const terrain: CountryTerrainKind = !owner
        ? "unknown"
        : land
          ? coast ? "coast" : detailedTerrain(owner.terrain as PlanetTerrainKind, value)
          : owner.terrain;
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
