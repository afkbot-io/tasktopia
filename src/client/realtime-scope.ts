/** Read mutable authority at delivery time, including the render/cleanup gap. */
export function matchesRealtimeScope(countryId: string | undefined, epoch: number, currentCountryId: string | undefined, currentEpoch: number): boolean {
  return Boolean(countryId) && countryId === currentCountryId && epoch === currentEpoch;
}
