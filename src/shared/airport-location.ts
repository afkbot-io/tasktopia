import type { BlockSlot } from "./block-templates";
import type { Cell } from "./contracts";

/** One world-space endpoint shared by CITY, COUNTRY and PLANET flight routes. */
export function blockSlotAirportPoint(slot: Pick<BlockSlot, "footprintBounds">): Cell {
  const bounds = slot.footprintBounds;
  return { x: (bounds.minX + bounds.maxX + 1) / 2, y: (bounds.minY + bounds.maxY + 1) / 2 };
}
