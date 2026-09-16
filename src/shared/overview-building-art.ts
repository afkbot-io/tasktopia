import { miniatureBuildingArt } from "./city-miniature";
import { BUILDING_CATALOG } from "./catalog";

const houses = BUILDING_CATALOG.filter(entry => entry.category === "HOUSE" && !entry.serviceRole
  && entry.tags.includes("compact-building")).sort((a, b) => a.key.localeCompare(b.key));

/** A district is one miniature, not a stretched silhouette of its territory. */
export function overviewBuildingArt(identity: string, zoom = 1) {
  let hash = 2166136261;
  for (let i = 0; i < identity.length; i++) hash = Math.imul(hash ^ identity.charCodeAt(i), 16777619) >>> 0;
  const entry = houses[hash % houses.length]!;
  return miniatureBuildingArt(entry.key, zoom);
}
