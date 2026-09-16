import type { CitySceneDto } from "../shared/city-scene-contract";

/** Transport and metadata may change without replacing any resident geometry. */
export function sameCitySceneContent(a: CitySceneDto, b: CitySceneDto): boolean {
  if (a.city.id !== b.city.id || a.schemaVersion !== b.schemaVersion || a.chunkSize !== b.chunkSize || a.lod !== b.lod
    || a.chunks.length !== b.chunks.length || a.completedDistrictSnapshots.length !== b.completedDistrictSnapshots.length) return false;
  const chunks = new Map(a.chunks.map(chunk=>[`${chunk.chunkX}:${chunk.chunkY}`,chunk]));
  if (b.chunks.some(chunk=>{const old=chunks.get(`${chunk.chunkX}:${chunk.chunkY}`);return !old || old.contentHash!==chunk.contentHash || old.publishedVersion!==chunk.publishedVersion;})) return false;
  const snapshots = new Map(a.completedDistrictSnapshots.map(snapshot=>[snapshot.districtId,snapshot.revision]));
  return b.completedDistrictSnapshots.every(snapshot=>snapshots.get(snapshot.districtId)===snapshot.revision)
    && JSON.stringify([a.city.bounds,a.railway,a.intercityRoads])===JSON.stringify([b.city.bounds,b.railway,b.intercityRoads]);
}
