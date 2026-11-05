import { PROP_SPRITES } from './catalog';
import type { MicroDirection } from './micro-ambient';

export type TransitFleetRole = 'BUS' | 'SCHOOL_BUS';
/** Native8px authored sprites, centred exactly as the mobility renderer.
 * Opaque bounds are the reviewed runtime PNG bounds, not the full tile. */
export function transitVehicleArt(role: TransitFleetRole, direction: MicroDirection) {
  const key = `city-event-${role === 'BUS' ? 'bus' : 'school-bus'}-${direction}`;
  const vertical = direction === 'north' || direction === 'south';
  return { key, url: PROP_SPRITES[key]!, anchor: { x: 4, y: 4 }, opaqueBounds: vertical
    ? { left: 2, top: 1, right: role === 'BUS' ? 6 : 5, bottom: 7 }
    : { left: 1, top: 2, right: 7, bottom: 5 } };
}
