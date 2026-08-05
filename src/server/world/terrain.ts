import type { TerrainCellDto, TerrainKind } from "../../shared/contracts";

export function hashCoordinate(seed: number, x: number, y: number, salt = 0): number {
  let value = Math.imul(x, 0x1f123bb5) ^ Math.imul(y, 0x5f356495) ^ Math.imul(seed + salt, 0x6c8e9cf5);
  value ^= value >>> 15;
  value = Math.imul(value, 0x2c1b3c6d);
  value ^= value >>> 12;
  value = Math.imul(value, 0x297a2d39);
  value ^= value >>> 15;
  return (value >>> 0) / 0xffffffff;
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

function valueNoise(seed: number, x: number, y: number, scale: number, salt: number): number {
  const sx = x / scale;
  const sy = y / scale;
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const tx = smoothstep(sx - x0);
  const ty = smoothstep(sy - y0);
  const a = hashCoordinate(seed, x0, y0, salt);
  const b = hashCoordinate(seed, x0 + 1, y0, salt);
  const c = hashCoordinate(seed, x0, y0 + 1, salt);
  const d = hashCoordinate(seed, x0 + 1, y0 + 1, salt);
  const top = a + (b - a) * tx;
  const bottom = c + (d - c) * tx;
  return top + (bottom - top) * ty;
}

function fractal(seed: number, x: number, y: number, salt: number): number {
  return valueNoise(seed, x, y, 84, salt) * 0.55
    + valueNoise(seed, x, y, 37, salt + 1) * 0.3
    + valueNoise(seed, x, y, 16, salt + 2) * 0.15;
}

function macroFractal(seed: number, x: number, y: number, salt: number): number {
  return valueNoise(seed, x, y, 176, salt) * 0.58
    + valueNoise(seed, x, y, 73, salt + 1) * 0.29
    + valueNoise(seed, x, y, 29, salt + 2) * 0.13;
}

export function elevationAt(seed: number, x: number, y: number): number {
  const broad = macroFractal(seed, x - 640, y + 410, 401);
  const ridgeNoise = valueNoise(seed, x + 210, y - 370, 96, 409);
  const ridge = 1 - Math.abs(ridgeNoise * 2 - 1);
  return broad * 0.78 + ridge * 0.22;
}

function lakeDistance(seed: number, x: number, y: number): number {
  const warpX = (valueNoise(seed, x, y, 128, 931) - 0.5) * 42;
  const warpY = (valueNoise(seed, x, y, 137, 937) - 0.5) * 42;
  const first = macroFractal(seed, x + warpX + 260, y + warpY - 180, 947);
  const second = macroFractal(seed, x - warpY - 430, y + warpX + 360, 953);
  const firstDistance = first > 0.69 ? Math.max(0, (0.77 - first) * 96) : 100;
  const secondDistance = second > 0.715 ? Math.max(0, (0.79 - second) * 102) : 100;
  return Math.min(firstDistance, secondDistance);
}

function waterDistance(seed: number, x: number, y: number): number {
  const phase = hashCoordinate(seed, 0, 0, 901) * Math.PI * 2;
  const riverY = 42 + Math.sin(x / 31 + phase) * 10 + Math.sin(x / 83 + phase * 0.4) * 7;
  const primary = Math.abs(y - riverY);
  const verticalPhase = hashCoordinate(seed, 0, 0, 907) * Math.PI * 2;
  const riverX = -118 + Math.sin(y / 43 + verticalPhase) * 13;
  const secondary = Math.abs(x - riverX);
  return Math.min(primary, secondary, lakeDistance(seed, x, y));
}

export function terrainAt(seed: number, x: number, y: number): Omit<TerrainCellDto, "x" | "y"> {
  const distance = waterDistance(seed, x, y);
  let terrain: TerrainKind;
  if (distance < 2.2) terrain = "DEEP_WATER";
  else if (distance < 4.5) terrain = "SHALLOW_WATER";
  else if (distance < 5.8) terrain = "WET_SAND";
  else if (distance < 7.6) terrain = "SAND";
  else {
    const moisture = fractal(seed, x, y, 101);
    const geology = fractal(seed, x - 500, y + 320, 170);
    const localGeology = valueNoise(seed, x + 140, y - 90, 11, 177);
    const elevation = elevationAt(seed, x, y);
    const canopy = moisture * 0.76 + valueNoise(seed, x - 90, y + 70, 23, 211) * 0.24;
    const clearing = valueNoise(seed, x + 40, y - 120, 13, 223);
    if (elevation > 0.79) terrain = "MOUNTAIN";
    else if (elevation > 0.675) terrain = "HILL";
    else if (geology > 0.76 && localGeology > 0.78) terrain = "STONE";
    else if (geology < 0.24 && localGeology < 0.22) terrain = "CLAY";
    else if (canopy > 0.625 && clearing > 0.2) terrain = "FOREST";
    else if (moisture > 0.5) terrain = "MEADOW";
    else terrain = "GRASS";
  }
  const baseVariant = Math.floor(hashCoordinate(seed, x, y, 311) * 3);
  const fishChance = hashCoordinate(seed, x, y, 313);
  const variant = isWater(terrain) && fishChance < 0.055
    ? 3 + Math.floor(hashCoordinate(seed, x, y, 317) * 2)
    : baseVariant;
  return { terrain, variant };
}

export function isWater(terrain: TerrainKind): boolean {
  return terrain === "SHALLOW_WATER" || terrain === "DEEP_WATER";
}

export function isBuildableTerrain(terrain: TerrainKind): boolean {
  return !isWater(terrain) && terrain !== "WET_SAND" && terrain !== "HILL" && terrain !== "MOUNTAIN";
}
