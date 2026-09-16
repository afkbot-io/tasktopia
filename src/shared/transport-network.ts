/** One primary ready stop per city and a deterministic chain. Each city has
 * at most two neighbours. O(n log n), independent of camera, projection, array
 * order and personal visibility of other countries. Call once per country. */
export function countryTransportNetwork<T extends { taskId: string; cityId: string }>(endpoints: readonly T[]): Array<{from:T;to:T}> {
  const primary=new Map<string,T>();
  for(const endpoint of endpoints){
    const previous=primary.get(endpoint.cityId);
    if(!previous || endpoint.taskId<previous.taskId)primary.set(endpoint.cityId,endpoint);
  }
  const cities=[...primary.values()].sort((a,b)=>a.cityId<b.cityId?-1:a.cityId>b.cityId?1:0);
  return cities.slice(1).map((to,index)=>({from:cities[index]!,to}));
}
