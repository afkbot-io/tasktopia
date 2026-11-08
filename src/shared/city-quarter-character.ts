import {cityNeighbourhoodKey,type NeighbourhoodBlock} from './city-neighbourhood';
import type {BuildingProfile} from './building-profiles';
import type {BuildingCatalogEntry} from './catalog';

export const QUARTER_CHARACTERS=['TERRACOTTA','SLATE','GARDENS'] as const;
export type QuarterCharacter=typeof QUARTER_CHARACTERS[number];
// Authored material/massing groups, never tints or substitute geometries.
const HOMES:Record<QuarterCharacter,ReadonlySet<string>>={
  TERRACOTTA:new Set(['compact-apartment-v1','compact-copper-court-v1','compact-rust-loft-v1',
    'compact-gabled-apartment-v1','compact-four-floor-house-v1','compact-section-five-floor-v1',
    'compact-paired-townhouse-v1','compact-wide-v1','compact-terrace-v1','compact-row-v1',
    'compact-long-gallery-v1','compact-corner-five-floor-v1','compact-corner-court-v1']),
  SLATE:new Set(['compact-blue-bay-v1','compact-stepped-apartment-v1','compact-panel-four-floor-v1',
    'compact-gallery-four-floor-v1','compact-modern-five-floor-v1','compact-teal-mansard-v1',
    'compact-glass-stair-v1','compact-corner-balcony-v1','compact-workshop-home-v1','compact-bungalow-v1',
    'compact-long-slate-wing-v1','compact-court-four-floor-v1','compact-corner-five-floor-v1']),
  GARDENS:new Set(['compact-garden-house-v1','compact-courtyard-apartment-v1','compact-olive-five-floor-v1',
    'compact-sand-balcony-v1','compact-olive-cafe-v1','compact-roofgarden-v1','compact-paired-townhouse-v1',
    'compact-bungalow-v1','compact-terrace-v1','compact-corner-court-v1','compact-court-four-floor-v1']),
};
export function quarterCharacter(value:unknown):QuarterCharacter|undefined{
  return QUARTER_CHARACTERS.find(key=>key===value);
}
/** Stable world coordinates and city seed; task count/order never enters it. */
export function quarterCharacterFor(seed:number,block:NeighbourhoodBlock):QuarterCharacter{
  let hash=2166136261;
  for(const char of `${seed}:${cityNeighbourhoodKey(block)}`)hash=Math.imul(hash^char.charCodeAt(0),16777619);
  return QUARTER_CHARACTERS[(hash>>>0)%QUARTER_CHARACTERS.length]!;
}

/** At least two compatible choices, otherwise the original profile wins.
 * Specialised civic/commercial profiles never expand into ordinary housing;
 * the garden low-rise profile never expands into four/five-floor aliases. */
export function preferredQuarterHomes(candidates:readonly Pick<BuildingCatalogEntry,'key'|'floorCount'>[],
  profilePool:readonly string[],profile:BuildingProfile|undefined,character?:QuarterCharacter):readonly string[]{
  if(!character)return profilePool;
  const homes=HOMES[character],preferred=profilePool.filter(key=>homes.has(key));
  if(preferred.length>=2)return preferred;
  if(profile==='CIVIC'||profile==='COMMERCIAL')return profilePool;
  const expanded=candidates.filter(item=>homes.has(item.key)&&(profile!=='PRIVATE'||(item.floorCount??3)<=3)).map(item=>item.key).sort();
  return expanded.length>=2?expanded:profilePool;
}
