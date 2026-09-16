import type { ProjectedPlanetAtlas } from "../../shared/planet-atlas";

/** Only the authorized, selected atlas sector may contribute foreign stops. */
export function internationalAirConnections(atlas: ProjectedPlanetAtlas, countryId: string) {
  const endpoints = new Map(atlas.countries.flatMap(country => country.cities.flatMap(city => city.airports.map(airport => [airport.taskId, {
    taskId:airport.taskId, cityId:city.id, cityName:city.name ?? country.name, countryId:country.id, countryName:country.name, point:airport.center,
  }] as const))));
  return atlas.routes.flatMap(route => {
    if (!route.fromAirportId || route.fromCountryId === route.toCountryId
      || (route.fromCountryId !== countryId && route.toCountryId !== countryId)) return [];
    const from = endpoints.get(route.fromAirportId), to = endpoints.get(route.toAirportId);
    return from && to ? [{ id:route.id, from, to, atlasFrom:route.from, atlasTo:route.to }] : [];
  });
}
