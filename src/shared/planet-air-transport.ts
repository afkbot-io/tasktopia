import { countryAirNetwork } from './air-network';
import type { ProjectedPlanetAtlas } from './planet-atlas';
import type { PlanetAirRouteDto } from './planet-atlas-contract';
import { airportScheduleOffset, airportTimetable, retainedTransportNetwork } from './transport-network';
import { transportSchedule } from './transport-schedule';

/** Keep the existing representative airport and foreign country chain while
 * both authorized endpoints remain ready. New domestic slots stay canonical. */
export function buildPlanetAirRoutes(atlas: ProjectedPlanetAtlas, previous: readonly PlanetAirRouteDto[] = []): PlanetAirRouteDto[] {
  const stops = atlas.countries.flatMap(country => country.airports.map(airport => ({
    ...airport, taskId: airport.id, cityId: country.cities[airport.cityIndex]!.id,
  })));
  const byId = new Map(stops.map(stop => [stop.id, stop]));
  const domestic = atlas.countries.flatMap(country => countryAirNetwork(
    stops.filter(stop => stop.countryId === country.id), country.transportNetworks?.AIR,
  ));
  const oldForeign = previous.filter(route => route.fromCountryId !== route.toCountryId);
  const oldAirports = new Set(oldForeign.flatMap(route => [route.fromAirportId, route.toAirportId]));
  const representatives = atlas.countries.flatMap(country => {
    const candidates = stops.filter(stop => stop.countryId === country.id).sort((a, b) => a.id.localeCompare(b.id));
    const stop = candidates.find(stop => oldAirports.has(stop.id)) ?? candidates[0];
    return stop ? [{ ...stop, cityId: country.id }] : [];
  });
  const retained = previous.length ? retainedTransportNetwork(representatives.map(stop => ({
    ...stop, point: stop.point,
  })), oldForeign.map(route => ({ fromCityId: route.fromCountryId, toCityId: route.toCountryId }))) : undefined;
  const foreign = countryAirNetwork(representatives, retained);
  const pairs = [...domestic, ...foreign];
  const city = (stop: typeof stops[number]) => byId.get(stop.id)!.cityId;
  const saved = oldForeign.map(route => ({
    fromCityId: route.fromCityId, toCityId: route.toCityId,
    arrivalPhaseMs: (((route.fromAirportId < route.toAirportId ? 0 : 100_000) - route.scheduleOffsetMs) % 100_000 + 100_000) % 100_000,
  }));
  const timed = airportTimetable(pairs.map(({ from, to }) => ({ fromCityId: city(from), toCityId: city(to) })),
    [...atlas.countries.flatMap(country => country.transportNetworks?.AIR ?? []), ...saved], false);
  return pairs.flatMap(({ from, to }) => {
    const timing = timed.find(edge => edge.fromCityId === city(from) && edge.toCityId === city(to));
    if (!timing) return [];
    const scheduleOffsetMs = airportScheduleOffset(timing, from.id, to.id);
    return [{ id: transportSchedule('AIR', from.id, to.id).id, fromAirportId: from.id, toAirportId: to.id,
      fromCityId: city(from), toCityId: city(to), fromCountryId: from.countryId, toCountryId: to.countryId, scheduleOffsetMs }];
  });
}
