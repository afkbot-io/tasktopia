import type { CountryOverviewDto } from "../shared/country-overview-contract";

/** Only fields consumed by immutable geometry, miniature art and transport.
 * Labels/activity are rendered by React and must not restart map animation. */
export function countryRenderKey(overview: CountryOverviewDto): string {
  return JSON.stringify({countryId:overview.countryId,schemaVersion:overview.schemaVersion,
    terrainSeed:overview.terrainSeed,bounds:overview.bounds,geography:overview.geography,
    groundRoads:overview.groundRoads,connections:overview.connections,railConnections:overview.railConnections,seaConnections:overview.seaConnections,
    cities:overview.cities.map(city=>({id:city.id,sourceCenter:city.sourceCenter,sourceBounds:city.sourceBounds,
      atlasCenter:city.atlasCenter,miniature:city.miniature}))});
}
export function retainCountryRenderSnapshot(previous: CountryOverviewDto|null,next:CountryOverviewDto):CountryOverviewDto {
  return previous && countryRenderKey(previous)===countryRenderKey(next) ? previous : next;
}
