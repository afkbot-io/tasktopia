import { getBuilding } from "./catalog";
import type { CountryCityMiniature } from "./country-overview-contract";

export const CITY_MINIATURE_BUILDING_LIMIT = 12;
export const CITY_MINIATURE_TRANSPORT_LIMIT = 3;

const transportRoles = new Set(["AIRPORT", "RAILWAY", "PORT"]);
function landmarkPriority(family: string): number {
  const entry = getBuilding(family);
  return entry.maxPerCity === 1 || entry.rarity === "UNIQUE" ? 0
    : entry.rarity === "RARE" ? 1 : entry.rarity === "UNCOMMON" ? 2 : 3;
}

/** Pick a real characteristic building even when a home occupies the first slot.
 * Construction progress never changes which building represents the block. */
export function miniatureRepresentative<T extends {slotKey:string;buildingFamily:string}>(placements: readonly T[]): T | undefined {
  return [...placements].filter(p=>!transportRoles.has(getBuilding(p.buildingFamily).serviceRole ?? ""))
    .sort((a,b)=>landmarkPriority(a.buildingFamily)-landmarkPriority(b.buildingFamily)
      || a.slotKey.localeCompare(b.slotKey) || a.buildingFamily.localeCompare(b.buildingFamily))[0];
}

/** Stable identity ranking: zoom, progress and the order of incoming rows never
 * change the selected landmarks. Rare families precede repeated housing. */
export function selectMiniatureBuildings(blocks: CountryCityMiniature["blocks"]): CountryCityMiniature["blocks"] {
  const ordered = [...blocks].sort((a, b) => landmarkPriority(a.family)-landmarkPriority(b.family) || a.id.localeCompare(b.id));
  const unique: typeof ordered = [], repeated: typeof ordered = [];
  const seen = new Set<string>();
  for (const block of ordered) {
    const entry = getBuilding(block.family);
    // Transport has its own marker and must not appear a second time as a home.
    if (entry.serviceRole === "AIRPORT" || entry.serviceRole === "RAILWAY" || entry.serviceRole === "PORT") continue;
    if (seen.has(block.family)) repeated.push(block);
    else { unique.push(block); seen.add(block.family); }
  }
  return [...unique, ...repeated].slice(0, CITY_MINIATURE_BUILDING_LIMIT);
}

/** A shared longest-edge envelope preserves native aspect ratio, including
 * long and tall buildings. Both map renderers use integer screen dimensions. */
export function miniatureBuildingArt(family: string, zoom = 1, baseSize = 10, stage = 5) {
  const entry = getBuilding(family);
  const scale = baseSize * Math.max(.01, zoom) / Math.max(entry.spriteSize.width, entry.spriteSize.height);
  return { key: entry.key, url: entry.stages[Math.max(0,Math.min(4,Math.round(stage)-1))]!, nativeWidth: entry.spriteSize.width, nativeHeight: entry.spriteSize.height,
    width: Math.max(1, Math.round(entry.spriteSize.width * scale)), height: Math.max(1, Math.round(entry.spriteSize.height * scale)) };
}

export function miniatureTransportMarkers(miniature: Pick<CountryCityMiniature,"airports"|"stations"|"transport">) {
  return (miniature.transport ?? [
    ...miniature.airports.map(point=>({...point,family:"compact-airport-v1",stage:5})),
    ...(miniature.stations ?? []).map(point=>({...point,family:"compact-railway-v1",stage:5})),
  ]).slice().sort((a,b)=>a.taskId.localeCompare(b.taskId)).slice(0,CITY_MINIATURE_TRANSPORT_LIMIT);
}
