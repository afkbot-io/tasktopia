/** Versioned preferences apply only to newly planned blocks. They never
 * reinterpret existing parcel geometry or stored facade identities. */
export const BUILDING_PROFILES = {
  PRIVATE: { label: "Садовый малоэтажный", shapes: ["compact-row-v1", "compact-wide-v1", "compact-apartment-v1"], homes: ["compact-bungalow-v1", "compact-garden-house-v1", "compact-paired-townhouse-v1", "compact-terrace-v1", "compact-row-v1"] },
  NEW_BUILD: { label: "Современная застройка", shapes: ["compact-apartment-v1", "compact-long-slate-wing-v1", "compact-u-courtyard-v1", "compact-wide-v1"], homes: ["compact-four-floor-house-v1", "compact-stepped-apartment-v1", "compact-glass-stair-v1", "compact-long-slate-wing-v1", "compact-roofgarden-v1"] },
  MIXED_URBAN: { label: "Смешанный городской", shapes: [], homes: [] },
  COMMERCIAL: { label: "Торговые улицы", shapes: ["compact-long-gallery-v1", "compact-wide-v1", "compact-corner-court-v1", "compact-apartment-v1"], homes: ["compact-olive-cafe-v1", "compact-plum-workshop-v1", "compact-workshop-home-v1", "compact-rust-loft-v1", "compact-long-gallery-v1"] },
  CIVIC: { label: "Общественный центр", shapes: ["compact-u-courtyard-v1", "compact-corner-court-v1", "compact-apartment-v1", "compact-wide-v1"], homes: ["compact-ivory-library-v1", "compact-rose-clinic-annex-v1", "compact-sand-balcony-v1", "compact-u-courtyard-v1", "compact-corner-court-v1"] },
} as const;
export type BuildingProfile = keyof typeof BUILDING_PROFILES;
export function buildingProfile(value: unknown): BuildingProfile | undefined {
  return typeof value === "string" && Object.hasOwn(BUILDING_PROFILES, value) ? value as BuildingProfile : undefined;
}
export function preferredProfileHomes(candidates: readonly string[], profile?: BuildingProfile): string[] {
  const preferred: readonly string[] = profile ? BUILDING_PROFILES[profile].homes : [];
  const matching = candidates.filter(key => preferred.includes(key));
  return matching.length ? matching : [...candidates];
}
