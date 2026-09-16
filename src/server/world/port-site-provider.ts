import type { Db } from "../db";
import type { Cell, Rect } from "../../shared/contracts";
import type { PersonalPlanetGeography } from "../../shared/planet-geography";
import type { PlanetCountryDto } from "../../shared/planet-atlas-contract";
import type { WorldTerrainProfile } from "../../shared/world-terrain-profile";
import { openOceanCells } from "../../shared/ocean-connectivity";
import { resolvePortOceanLink } from "../../shared/port-ocean-link";
import { planPortSite } from "../../shared/port-site";
import { terrainAt } from "../../shared/world-terrain";
import { blockSlots } from "../../shared/block-templates";
import type { BlockLayoutCompilerInput } from "./block-layout-compiler";
const inside = (p: Cell, b: Rect) => p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;

/** One saved owner view supplies eligibility, not global atlas coordinates.
 * Missing geography remains an explicit unavailable port; ordinary layout
 * creation never initializes another user's private map as a side effect. */
export async function createPortSiteProvider(db: Db, input: {
  countryId: string; cityId: string; seed: number; profile: WorldTerrainProfile;
  center: Cell; reservations: readonly Rect[];
}): Promise<BlockLayoutCompilerInput["planPort"]> {
  const row = await db.prepare(`SELECT p.geography_json FROM countries c
    JOIN country_members m ON m.country_id=c.id AND m.user_id=c.user_id AND m.role='OWNER'
    JOIN personal_planet_geography_v1 p ON p.user_id=c.user_id WHERE c.id=?`).get<{ geography_json: PersonalPlanetGeography }>(input.countryId);
  const geo = row?.geography_json, record = geo?.countries[input.countryId];
  if (!geo || !record?.worldBounds || !record.cities[input.cityId]) return undefined;
  const sector = record.sector ?? 0, key = (x: number, y: number) => `${x},${y}`;
  // Hidden countries retain their reservations; never turn them into a shortcut.
  const land = new Set(Object.values(geo.countries).filter(c => (c.sector ?? 0) === sector).flatMap(c => c.cells.map(cell => key(cell.q, cell.r))));
  const coast = geo.coastCells.filter(cell => (cell.sector ?? 0) === sector);
  for (const cell of coast) land.add(key(cell.q, cell.r));
  const bounds = { minX: 0, minY: 0, maxX: Math.round(geo.width / (geo.hexRadius * 2) - 1.5) - 1,
    maxY: Math.round(geo.height / (geo.hexRadius * 2) - 1.5) - 1 };
  const water: Cell[] = [];
  for (let y = 0; y <= bounds.maxY; y++) for (let x = 0; x <= bounds.maxX; x++) if (!land.has(key(x, y))) water.push({ x, y });
  const ocean = openOceanCells(water, bounds);
  const ownedCoast = coast.filter(cell => geo.coastOwners[cell.id]?.length === 1 && geo.coastOwners[cell.id]![0] === input.countryId);
  const country: PlanetCountryDto = { id: input.countryId, name: "", seed: input.seed, terrainProfile: input.profile,
    worldVersion: 0, cityCount: 1, districtCount: 0, buildingCount: 0, unfinishedBuildingCount: 0, progress: 0,
    worldBounds: record.worldBounds, cities: [{ id: input.cityId, center: input.center, districts: [], airports: [] }] };
  return (terminal, blocks) => {
    const y = Math.floor((terminal.minY + terminal.maxY) / 2);
    const link = resolvePortOceanLink({ country, cityId: input.cityId, localBerth: { x: input.profile.coastX + 16, y },
      projected: { id: input.countryId, cells: record.cells, worldBounds: record.worldBounds }, ownedCoast, openOcean: ocean });
    if (!link) return null;
    const minX = terminal.minX - 10, maxX = Math.max(terminal.maxX + 10, link.localOutlet.x + 2);
    if (maxX - minX > 96) return null;
    const occupied = blocks.flatMap(block => blockSlots(block).flatMap(slot => slot.footprint)).filter(cell => !inside(cell, terminal));
    const cells: Array<Cell & { water: boolean }> = [];
    for (let cy = terminal.minY - 10; cy <= terminal.maxY + 10; cy++) for (let x = minX; x <= maxX; x++) {
      const terrain = terrainAt(input.seed, x, cy, input.profile).terrain, cell = { x, y: cy };
      cells.push({ ...cell, water: terrain === "DEEP_WATER" || terrain === "SHALLOW_WATER" });
      if (input.reservations.some(rect => inside(cell, rect))) occupied.push(cell);
    }
    return planPortSite({ countryId: input.countryId, cityId: input.cityId, worldSeed: input.seed, terminal,
      cells, occupied, link, oceanCells: ocean, oceanBounds: bounds });
  };
}
