import type { EntranceSide } from "./catalog";
import type { Cell } from "./contracts";

export type BuildingEntrance = { side: EntranceSide; offset: number };
export const ENTRANCE_NORMAL: Readonly<Record<EntranceSide, Cell>> = {
  N: { x: 0, y: -1 }, E: { x: 1, y: 0 }, S: { x: 0, y: 1 }, W: { x: -1, y: 0 },
};

export function validBuildingEntrance(footprint: { width: number; height: number }, entrance: BuildingEntrance): boolean {
  return Object.hasOwn(ENTRANCE_NORMAL, entrance.side) && Number.isSafeInteger(entrance.offset)
    && entrance.offset >= 0 && entrance.offset < (entrance.side === "N" || entrance.side === "S" ? footprint.width : footprint.height);
}

/** Offsets run west to east on N/S walls, north to south on E/W walls. */
export function buildingEntranceCell(origin: Cell, footprint: { width: number; height: number }, entrance: BuildingEntrance): Cell {
  if (!validBuildingEntrance(footprint, entrance)) throw new Error("Invalid building entrance");
  switch (entrance.side) {
    case "N": return { x: origin.x + entrance.offset, y: origin.y };
    case "S": return { x: origin.x + entrance.offset, y: origin.y + footprint.height - 1 };
    case "W": return { x: origin.x, y: origin.y + entrance.offset };
    case "E": return { x: origin.x + footprint.width - 1, y: origin.y + entrance.offset };
  }
}
