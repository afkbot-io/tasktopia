import type { Cell, CityDto, DistrictDto, Rect } from "./contracts";

export const COUNTRY_OVERVIEW_SCHEMA_VERSION = 4 as const;

export const COUNTRY_TERRAIN_KINDS = [
  "grass", "meadow", "forest", "hill", "mountain", "coast", "river", "stone", "deep_water", "shallow_water", "unknown",
] as const;
export type CountryOverviewTerrainKind = typeof COUNTRY_TERRAIN_KINDS[number];

export function encodeCountryTerrain(terrain: readonly CountryOverviewTerrainKind[]): string {
  return terrain.map((kind) => COUNTRY_TERRAIN_KINDS.indexOf(kind).toString(16)).join("");
}

export function decodeCountryTerrain(code: string): CountryOverviewTerrainKind {
  const kind = COUNTRY_TERRAIN_KINDS[Number.parseInt(code, 16)];
  return kind ?? "grass";
}

export type CountryOverviewDistrictDto = {
  id: string;
  name: string;
  status: DistrictDto["status"];
  color: string;
  progress: number;
  taskCount: number;
};

export type CountryOverviewCityDto = {
  id: string;
  name: string;
  status: CityDto["status"];
  sourceCenter: Cell;
  sourceBounds: Rect;
  atlasCenter: Cell;
  progress: number;
  districts: CountryOverviewDistrictDto[];
  /** A semantic city silhouette. Zero means empty; 1..f reference a district. */
  miniature: {
    blockSize: number;
    columns: number;
    rows: number;
    districtCodes: string;
    coverageCodes: string;
    shapeCodes: string;
    /** Dominant canonical terrain for each 8x8 semantic block. */
    terrainCodes: string;
    airportCell: Cell;
  };
};

export type CountryOverviewDto = {
  schemaVersion: typeof COUNTRY_OVERVIEW_SCHEMA_VERSION;
  countryId: string;
  revision: string;
  terrainSeed: number;
  bounds: Rect;
  geography: {
    columns: number;
    rows: number;
    cellSize: number;
    topology: "SQUARE_4";
    terrainCodes: string;
    /** 0 = unowned/ocean/unknown, 1 = selected country, 2 = neighbouring country. */
    territoryCodes: string;
  };
  cities: CountryOverviewCityDto[];
  connections: Array<{ fromCityId: string; toCityId: string }>;
};

export type LegacyCountryOverviewDto = Omit<CountryOverviewDto, "schemaVersion" | "geography" | "cities"> & {
  schemaVersion: 3;
  geography: Omit<CountryOverviewDto["geography"], "territoryCodes">;
  cities: Array<Omit<CountryOverviewCityDto, "miniature"> & {
    miniature: Pick<CountryOverviewCityDto["miniature"], "columns" | "rows" | "districtCodes" | "airportCell">;
  }>;
};

/**
 * Keeps schema-v3 browser bundles usable during a rolling release. The v4
 * semantic grid is reduced to the former 14-cell envelope at the HTTP edge;
 * the persisted canonical snapshot remains v4.
 */
export function legacyCountryOverview(overview: CountryOverviewDto): LegacyCountryOverviewDto {
  const cities = overview.cities.map((city) => {
    const source = city.miniature;
    const scale = Math.min(1, 14 / Math.max(source.columns, source.rows));
    const columns = Math.max(1, Math.round(source.columns * scale));
    const rows = Math.max(1, Math.round(source.rows * scale));
    const codes = Array.from({ length: columns * rows }, () => 0);
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const fromX = Math.floor(column * source.columns / columns);
        const toX = Math.max(fromX + 1, Math.ceil((column + 1) * source.columns / columns));
        const fromY = Math.floor(row * source.rows / rows);
        const toY = Math.max(fromY + 1, Math.ceil((row + 1) * source.rows / rows));
        const counts = new Map<number, number>();
        for (let y = fromY; y < toY; y += 1) for (let x = fromX; x < toX; x += 1) {
          const code = Number.parseInt(source.districtCodes[y * source.columns + x] ?? "0", 16);
          if (code) counts.set(code, (counts.get(code) ?? 0) + 1);
        }
        codes[row * columns + column] = [...counts].sort((left, right) => right[1] - left[1] || left[0] - right[0])[0]?.[0] ?? 0;
      }
    }
    const airportCell = {
      x: Math.max(0, Math.min(columns - 1, Math.floor(source.airportCell.x * columns / source.columns))),
      y: Math.max(0, Math.min(rows - 1, Math.floor(source.airportCell.y * rows / source.rows))),
    };
    return {
      ...city,
      miniature: { columns, rows, districtCodes: codes.map((code) => code.toString(16)).join(""), airportCell },
    };
  });
  const geography = {
    columns: overview.geography.columns,
    rows: overview.geography.rows,
    cellSize: overview.geography.cellSize,
    topology: overview.geography.topology,
    terrainCodes: overview.geography.terrainCodes,
  };
  return { ...overview, schemaVersion: 3, geography, cities };
}
