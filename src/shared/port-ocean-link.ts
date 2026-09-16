import type { Cell } from "./contracts";
import type { PlanetCountryDto } from "./planet-atlas-contract";
import type { ProjectedPlanetCountry, PlanetTerrainCell } from "./planet-atlas";
import type { PortOceanLink } from "./port-site";
import { coastlineX } from "./world-terrain-profile";

/** Resolve an eastern marine outlet against one authorized, frozen atlas view.
 * The local sea comes from the immutable terrain profile. The overview link
 * crosses only that country's recorded coast, never another country's land.
 * This view-specific result must not be persisted as global country geometry. */
export function resolvePortOceanLink(input: {
  country: PlanetCountryDto;
  cityId: string;
  localBerth: Cell;
  projected: Pick<ProjectedPlanetCountry, "id" | "cells" | "worldBounds">;
  ownedCoast: readonly PlanetTerrainCell[];
  openOcean: readonly Cell[];
}): PortOceanLink | null {
  const { country, projected, localBerth } = input, profile = country.terrainProfile;
  if (!profile || projected.id !== country.id || !country.cities.some(city => city.id === input.cityId)
    || !projected.worldBounds || !projected.cells.length
    || !Number.isSafeInteger(localBerth.x) || !Number.isSafeInteger(localBerth.y)) return null;
  // All three rows of the hull must be in the profile's marine half-plane.
  for (let dy = -1; dy <= 1; dy++) {
    if (localBerth.x - 1 < coastlineX(country.seed, localBerth.y + dy, profile) + 3) return null;
  }
  const bounds = projected.worldBounds;
  const rows = projected.cells.map(cell => cell.r), minR = Math.min(...rows), maxR = Math.max(...rows);
  // Like city projection, clamp new local development to the frozen country
  // extent. Growing beyond the initial bounds must not move the personal map.
  const r = Math.max(minR, Math.min(maxR, Math.round(minR + (localBerth.y - bounds.minY)
    / Math.max(1, bounds.maxY - bounds.minY) * (maxR - minR))));
  const edge = projected.cells.filter(cell => cell.r === r).sort((a, b) => b.q - a.q)[0];
  if (!edge) return null;
  const key = (x: number, y: number) => `${x},${y}`;
  const coast = new Set(input.ownedCoast.map(cell => key(cell.q, cell.r)));
  const ocean = new Set(input.openOcean.map(cell => key(cell.x, cell.y)));
  let crossedCoast = false;
  for (let distance = 1; distance <= 8; distance++) {
    const x = edge.q + distance;
    if (coast.has(key(x, r))) { crossedCoast = true; continue; }
    if (!crossedCoast || !ocean.has(key(x, r))) return null;
    let clear = true;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!ocean.has(key(x + dx, r + dy))) clear = false;
    }
    if (clear) return {
      countryId: country.id, cityId: input.cityId, worldSeed: country.seed,
      localOutlet: { x: Math.max(localBerth.x, profile.coastX + 16), y: localBerth.y },
      oceanOutlet: { x, y: r },
    };
  }
  return null;
}
