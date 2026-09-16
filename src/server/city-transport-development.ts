import type { CityDevelopmentDto, CityTransportDevelopmentDto } from "../shared/city-development";
import type { CountryOverviewDto } from "../shared/country-overview-contract";
import { transportSchedule } from "../shared/transport-schedule";

/** Explain the same authorized ready graph that the maps use; never invent links. */
export function cityTransportDevelopment(cityId: string, services: CityDevelopmentDto["services"], overview?: CountryOverviewDto): CityTransportDevelopmentDto[] {
  const cities = new Map(overview?.cities.map(city => [city.id, city.name]));
  for (const route of [...overview?.connections ?? [],...overview?.railConnections ?? [],...overview?.seaConnections ?? []]) {
    if (route.fromCityName) cities.set(route.fromCityId,route.fromCityName);
    if (route.toCityName) cities.set(route.toCityId,route.toCityName);
  }
  return (["AIR", "RAIL", "SEA"] as const).map(kind => {
    const role = kind === "AIR" ? "AIRPORT" : kind === "RAIL" ? "RAILWAY" : "PORT";
    const ready = services.some(service => service.role === role && service.state === "READY");
    const candidates = kind === "AIR" ? (overview?.connections ?? []).map(route => ({
      fromId: route.fromAirportId, toId: route.toAirportId, fromCityId: route.fromCityId, toCityId: route.toCityId,
    })) : kind === "SEA" ? (overview?.seaConnections ?? []).map(route => ({
      fromId: route.fromPortId, toId: route.toPortId, fromCityId: route.fromCityId, toCityId: route.toCityId,
    })) : (overview?.railConnections ?? []).map(route => ({
      fromId: route.fromStationId, toId: route.toStationId, fromCityId: route.fromCityId, toCityId: route.toCityId,
    }));
    const routes = new Map<string, CityTransportDevelopmentDto["routes"][number]>();
    if (ready) for (const route of candidates) {
      if (!route.fromId || !route.toId || route.fromId === route.toId || (route.fromCityId !== cityId && route.toCityId !== cityId)) continue;
      const destinationCityId = route.fromCityId === cityId ? route.toCityId : route.fromCityId;
      const destinationName = cities.get(destinationCityId);
      if (destinationName === undefined) continue;
      const schedule = transportSchedule(kind, route.fromId, route.toId);
      routes.set(schedule.id, { id: schedule.id, destinationCityId, destinationName, travelMs: schedule.travelMs, dwellMs: schedule.dwellMs });
    }
    return { kind, state: !ready ? "NOT_READY" : routes.size ? "CONNECTED" : "NO_CONNECTION",
      routes: [...routes.values()].sort((a, b) => a.destinationName.localeCompare(b.destinationName) || a.id.localeCompare(b.id)) };
  });
}
