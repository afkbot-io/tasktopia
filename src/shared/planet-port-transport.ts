import type { PlanetSeaRouteDto } from "./planet-atlas-contract";
import type { ProjectedPlanetAtlas } from "./planet-atlas";
import { planetHexCenter } from "./planet-atlas";
import { openOceanCells } from "./ocean-connectivity";
import { resolvePortOceanLink } from "./port-ocean-link";
import { portRoutes, type PortStop } from "./port-routes";

/** Only task-backed ready ports in this authorized sector produce voyages. */
export function buildPlanetSeaRoutes(atlas: ProjectedPlanetAtlas, navigation?: {blocked:ReadonlySet<string>;coastOwners:Readonly<Record<string,readonly string[]>>}):PlanetSeaRouteDto[] {
  if(atlas.seaRoutes && !navigation)return atlas.seaRoutes;
  if (!atlas.countries.some(country => country.cities.some(city => city.ports?.length))) return [];
  const ocean = openOceanCells(atlas.oceanCells.map(cell => ({ x: cell.q, y: cell.r })).filter(cell=>!navigation?.blocked.has(`${cell.x},${cell.y}`)), {
    minX: 0, minY: 0, maxX: Math.round(atlas.width / (atlas.hexRadius * 2) - 1.5) - 1,
    maxY: Math.round(atlas.height / (atlas.hexRadius * 2) - 1.5) - 1,
  });
  const coastOwner = new Map<string, string>();
  for (const coast of atlas.coastCells) {
    if(navigation){
      const owners=navigation.coastOwners[coast.id];
      if(owners?.length===1)coastOwner.set(coast.id,owners[0]!);
      continue;
    }
    let distance = Infinity, owner: string | undefined;
    for (const country of atlas.countries) {
      const next = Math.min(...country.cells.map(cell => Math.abs(cell.q - coast.q) + Math.abs(cell.r - coast.r)));
      if (next < distance) { distance = next; owner = country.id; }
      else if (next === distance) owner = undefined;
    }
    if (owner) coastOwner.set(coast.id, owner);
  }
  const stops: PortStop[] = atlas.countries.flatMap(country => {
    const ownedCoast = atlas.coastCells.filter(cell => coastOwner.get(cell.id) === country.id);
    return country.cities.flatMap(city => (city.ports ?? []).flatMap(port => {
      if (port.stage !== 5) return [];
      const link = resolvePortOceanLink({ country, cityId: city.id, localBerth: port.waterOutlet,
        projected: country, ownedCoast, openOcean: ocean });
      return link ? [{ id: port.taskId, cityId: city.id, countryId: country.id, continent: country.continent, stage: port.stage, dock: link.oceanOutlet }] : [];
    }));
  });
  return portRoutes(stops, ocean, 1).map(route => ({
    id: route.id, fromPortId: route.from.id, toPortId: route.to.id,
    fromCityId: route.from.cityId, toCityId: route.to.cityId,
    fromCountryId: route.from.countryId, toCountryId: route.to.countryId,
    points: route.cells.map(cell => planetHexCenter({ q: cell.x, r: cell.y }, atlas.hexRadius)),
  }));
}
