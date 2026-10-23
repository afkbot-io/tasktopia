import type { CitySceneDto } from "../shared/city-scene-contract";

/** Publication fences and content identity are independent. A newer world
 * version must not discard already decoded pages or bake unchanged pixels. */
export function citySceneChanges(a: CitySceneDto, b: CitySceneDto) {
  const previous = new Map(a.chunks.map(chunk => [`${chunk.chunkX},${chunk.chunkY}`, chunk]));
  const changedChunks = new Set<string>(), groundChunks = new Set<string>(), terrainChunks = new Set<string>();
  let paddingChanged = JSON.stringify([a.city.bounds,a.roadContext,a.intercityRoads,a.railway,a.airports,a.ports])
    !== JSON.stringify([b.city.bounds,b.roadContext,b.intercityRoads,b.railway,b.airports,b.ports]);
  const occupied = (chunk:CitySceneDto["chunks"][number]) => [chunk.decorationContext?.blockedCellRuns,chunk.decorationContext?.surfaceHaloRuns,
    chunk.tasks?.map(task=>[task.footprint,task.accessPath]),chunk.worldFeatures?.map(feature=>feature.footprint),
    chunk.plannedSites?.map(site=>[site.origin,site.width,site.height])];
  for (const chunk of b.chunks) {
    const id = `${chunk.chunkX},${chunk.chunkY}`, old = previous.get(id);
    previous.delete(id);
    const terrainChanged = !old || old.size !== chunk.size || old.terrainSeed !== chunk.terrainSeed
      || JSON.stringify(old.terrainProfile) !== JSON.stringify(chunk.terrainProfile);
    const groundChanged = terrainChanged || !old || JSON.stringify([old.roadRuns, old.surfaceRuns]) !== JSON.stringify([chunk.roadRuns, chunk.surfaceRuns]);
    if (!old || old.contentHash !== chunk.contentHash || groundChanged) changedChunks.add(id);
    if (groundChanged) groundChunks.add(id);
    if (terrainChanged) terrainChunks.add(id);
    if (groundChanged || !old || JSON.stringify(occupied(old)) !== JSON.stringify(occupied(chunk))) paddingChanged = true;
  }
  return { changedChunks, groundChunks, terrainChunks, removedChunks: new Set(previous.keys()),paddingChanged:paddingChanged || previous.size>0 };
}

/** Transport and metadata may change without replacing any resident geometry. */
export function sameCitySceneContent(a: CitySceneDto, b: CitySceneDto): boolean {
  if (a.city.id !== b.city.id || a.schemaVersion !== b.schemaVersion || a.chunkSize !== b.chunkSize || a.lod !== b.lod
    || a.chunks.length !== b.chunks.length || a.completedDistrictSnapshots.length !== b.completedDistrictSnapshots.length) return false;
  const chunks = new Map(a.chunks.map(chunk=>[`${chunk.chunkX}:${chunk.chunkY}`,chunk]));
  if (b.chunks.some(chunk=>{const old=chunks.get(`${chunk.chunkX}:${chunk.chunkY}`);return !old || old.contentHash!==chunk.contentHash;})) return false;
  const snapshots = new Map(a.completedDistrictSnapshots.map(snapshot=>[snapshot.districtId,snapshot.revision]));
  return b.completedDistrictSnapshots.every(snapshot=>snapshots.get(snapshot.districtId)===snapshot.revision)
    && JSON.stringify([a.city.bounds,a.railway,a.airports,a.ports,a.intercityRoads,a.roadContext])===JSON.stringify([b.city.bounds,b.railway,b.airports,b.ports,b.intercityRoads,b.roadContext]);
}
