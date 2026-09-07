import type { TerrainKind } from "./contracts.js";
import { BLOCK_V1_CITY_PRESENTATION } from "./city-presentation-profile.js";

export { BLOCK_V1_CITY_PRESENTATION } from "./city-presentation-profile.js";

export type CityTerrainCell = Readonly<{
  x: number;
  y: number;
  terrain: TerrainKind;
}>;

export type CityTerrainMacroCommand = Readonly<{
  x: number;
  y: number;
  terrain: TerrainKind;
  sizeCells: number;
  variantKey: number;
}>;

export type CityTerrainDetailCommand = CityTerrainCell & Readonly<{
  variantKey: number;
}>;

export type CityTerrainRenderPlan = Readonly<{
  schemaVersion: 1;
  profileVersion: typeof BLOCK_V1_CITY_PRESENTATION.version;
  seed: string;
  macros: readonly CityTerrainMacroCommand[];
  details: readonly CityTerrainDetailCommand[];
}>;

export type CompileCityTerrainOptions = Readonly<{ seed: string }>;

export type CityTerrainPlanAudit = Readonly<{
  exact: boolean;
  sourceCells: number;
  reconstructedCells: number;
  macroCommands: number;
  detailCommands: number;
  commandReduction: number;
}>;

function coordinateKey(x: number, y: number): string {
  return `${x},${y}`;
}

function compareCoordinates(a: Pick<CityTerrainCell, "x" | "y">, b: Pick<CityTerrainCell, "x" | "y">): number {
  return a.y - b.y || a.x - b.x;
}

function variantKey(seed: string, terrain: TerrainKind, x: number, y: number): number {
  const value = `${BLOCK_V1_CITY_PRESENTATION.version}:${seed}:${terrain}:${x}:${y}`;
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function normalizedCells(cells: readonly CityTerrainCell[]): CityTerrainCell[] {
  const unique = new Map<string, CityTerrainCell>();
  for (const cell of cells) {
    if (!Number.isInteger(cell.x) || !Number.isInteger(cell.y)) {
      throw new Error(`CITY terrain coordinates must be integers: ${cell.x},${cell.y}`);
    }
    const key = coordinateKey(cell.x, cell.y);
    const existing = unique.get(key);
    if (existing && existing.terrain !== cell.terrain) {
      throw new Error(`Conflicting terrain cells at ${key}: ${existing.terrain} and ${cell.terrain}`);
    }
    unique.set(key, { x: cell.x, y: cell.y, terrain: cell.terrain });
  }
  return [...unique.values()].sort(compareCoordinates);
}

export function compileCityTerrain(
  sourceCells: readonly CityTerrainCell[],
  options: CompileCityTerrainOptions,
): CityTerrainRenderPlan {
  const cells = normalizedCells(sourceCells);
  const sizeCells = BLOCK_V1_CITY_PRESENTATION.terrainMacroCells;
  const groups = new Map<string, CityTerrainCell[]>();

  for (const cell of cells) {
    const x = Math.floor(cell.x / sizeCells) * sizeCells;
    const y = Math.floor(cell.y / sizeCells) * sizeCells;
    const key = coordinateKey(x, y);
    const group = groups.get(key) ?? [];
    group.push(cell);
    groups.set(key, group);
  }

  const macros: CityTerrainMacroCommand[] = [];
  const details: CityTerrainDetailCommand[] = [];
  const orderedGroups = [...groups.values()].sort((a, b) => compareCoordinates(a[0], b[0]));

  for (const group of orderedGroups) {
    const first = group[0];
    const x = Math.floor(first.x / sizeCells) * sizeCells;
    const y = Math.floor(first.y / sizeCells) * sizeCells;
    const homogeneous = group.length === sizeCells * sizeCells
      && group.every((cell) => cell.terrain === first.terrain);

    if (homogeneous) {
      macros.push({
        x,
        y,
        terrain: first.terrain,
        sizeCells,
        variantKey: variantKey(options.seed, first.terrain, x, y),
      });
      continue;
    }

    for (const cell of group) {
      details.push({
        ...cell,
        variantKey: variantKey(options.seed, cell.terrain, cell.x, cell.y),
      });
    }
  }

  return {
    schemaVersion: 1,
    profileVersion: BLOCK_V1_CITY_PRESENTATION.version,
    seed: options.seed,
    macros: macros.sort(compareCoordinates),
    details: details.sort(compareCoordinates),
  };
}

export function reconstructCityTerrain(plan: CityTerrainRenderPlan): CityTerrainCell[] {
  if (plan.profileVersion !== BLOCK_V1_CITY_PRESENTATION.version) {
    throw new Error(`Unsupported CITY terrain profile: ${plan.profileVersion}`);
  }

  const cells: CityTerrainCell[] = plan.details.map(({ x, y, terrain }) => ({ x, y, terrain }));
  for (const macro of plan.macros) {
    if (macro.sizeCells !== BLOCK_V1_CITY_PRESENTATION.terrainMacroCells) {
      throw new Error(`Invalid CITY terrain macro size: ${macro.sizeCells}`);
    }
    for (let offsetY = 0; offsetY < macro.sizeCells; offsetY += 1) {
      for (let offsetX = 0; offsetX < macro.sizeCells; offsetX += 1) {
        cells.push({ x: macro.x + offsetX, y: macro.y + offsetY, terrain: macro.terrain });
      }
    }
  }
  return normalizedCells(cells);
}

export function auditCityTerrainPlan(
  sourceCells: readonly CityTerrainCell[],
  plan: CityTerrainRenderPlan,
): CityTerrainPlanAudit {
  const source = normalizedCells(sourceCells);
  const reconstructed = reconstructCityTerrain(plan);
  const commandCount = plan.macros.length + plan.details.length;
  return {
    exact: JSON.stringify(reconstructed) === JSON.stringify(source),
    sourceCells: source.length,
    reconstructedCells: reconstructed.length,
    macroCommands: plan.macros.length,
    detailCommands: plan.details.length,
    commandReduction: commandCount === 0 ? 1 : source.length / commandCount,
  };
}
