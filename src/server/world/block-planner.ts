import type {
  BlockPattern,
  Cell,
  DistrictArchetype,
  PlannedLotDto,
  PlannedLotRole,
} from "../../shared/contracts";
import { cellKey, rectangleFootprint } from "./grid";

export type BlockDistrictPlan = {
  main: Cell[];
  branches: Cell[][];
  lots: PlannedLotDto[];
  pattern: BlockPattern;
};

type PlanInput = {
  districtId: string;
  origin: Cell;
  width: number;
  height: number;
  cells: Cell[];
  archetype: DistrictArchetype;
  groupOffset?: number;
};

type Slot = {
  x: number;
  baseline: number;
  width: number;
  height: number;
  rowIndex: number;
  role: PlannedLotRole;
};

function horizontalLine(fromX: number, toX: number, y: number): Cell[] {
  return Array.from({ length: Math.max(0, toX - fromX + 1) }, (_, index) => ({ x: fromX + index, y }));
}

function verticalLine(x: number, fromY: number, toY: number): Cell[] {
  return Array.from({ length: Math.max(0, toY - fromY + 1) }, (_, index) => ({ x, y: fromY + index }));
}

function uniqueCells(cells: Cell[]): Cell[] {
  return [...new Map(cells.map((cell) => [cellKey(cell), cell])).values()];
}

function denseSlots(origin: Cell, width: number, sidewalkY: number): { slots: Slot[]; access: Map<number, Cell[]> } {
  const startX = origin.x + 6;
  const spineX = startX - 1;
  const baselines = [origin.y + 6, origin.y + 13, Math.min(origin.y + 20, sidewalkY - 2)];
  const slots: Slot[] = [];
  const access = new Map<number, Cell[]>();
  let index = 0;
  for (let rowIndex = 0; rowIndex < baselines.length; rowIndex += 1) {
    const baseline = baselines[rowIndex]!;
    for (let column = 0; column < 3; column += 1) {
      const slotX = startX + column * 6;
      slots.push({ x: slotX, baseline, width: 6, height: 5, rowIndex, role: "PRIMARY" });
      access.set(index, uniqueCells([
        ...horizontalLine(spineX, slotX + 5, baseline),
        ...verticalLine(spineX, baseline, sidewalkY),
      ]));
      index += 1;
    }
  }

  const supportX = startX + 20;
  const supportSpineX = supportX - 1;
  for (const [supportIndex, baseline] of baselines.entries()) {
    slots.push({ x: supportX, baseline, width: 8, height: 5, rowIndex: baselines.length + supportIndex, role: "SUPPORT" });
    access.set(index, uniqueCells([
      ...horizontalLine(supportSpineX, supportX + 7, baseline),
      ...verticalLine(supportSpineX, baseline, sidewalkY),
    ]));
    index += 1;
  }
  return { slots, access };
}

function privateSlots(origin: Cell, width: number, sidewalkY: number): { slots: Slot[]; access: Map<number, Cell[]> } {
  const startX = origin.x + 6;
  const spineX = startX - 1;
  const baselines = [origin.y + 7, origin.y + 13, Math.min(origin.y + 20, sidewalkY - 2)];
  const slots: Slot[] = [];
  const access = new Map<number, Cell[]>();
  let index = 0;
  for (let rowIndex = 0; rowIndex < baselines.length; rowIndex += 1) {
    const baseline = baselines[rowIndex]!;
    for (let column = 0; column < 3; column += 1) {
      const slotX = startX + column * 6;
      slots.push({ x: slotX, baseline, width: 6, height: 4, rowIndex, role: "PRIMARY" });
      access.set(index, uniqueCells([
        ...horizontalLine(spineX, slotX + 5, baseline),
        ...verticalLine(spineX, baseline, sidewalkY),
      ]));
      index += 1;
    }
  }
  const supportX = startX + 20;
  const supportSpineX = supportX - 1;
  for (const [supportIndex, baseline] of baselines.entries()) {
    slots.push({ x: supportX, baseline, width: 8, height: 5, rowIndex: baselines.length + supportIndex, role: "SUPPORT" });
    access.set(index, uniqueCells([
      ...horizontalLine(supportSpineX, supportX + 7, baseline),
      ...verticalLine(supportSpineX, baseline, sidewalkY),
    ]));
    index += 1;
  }
  return { slots, access };
}

function stripSlots(origin: Cell, width: number, sidewalkY: number, archetype: DistrictArchetype): { slots: Slot[]; access: Map<number, Cell[]> } {
  const startX = origin.x + 5;
  const spineX = startX - 1;
  const baselines = [origin.y + 7, origin.y + 14, Math.min(origin.y + 21, sidewalkY - 1)];
  const slots: Slot[] = [];
  const access = new Map<number, Cell[]>();
  let index = 0;
  for (let rowIndex = 0; rowIndex < baselines.length; rowIndex += 1) {
    const baseline = baselines[rowIndex]!;
    for (let column = 0; column < 4; column += 1) {
      const role: PlannedLotRole = archetype === "MIXED_URBAN" || rowIndex < 2 ? "PRIMARY" : "SUPPORT";
      const slotX = startX + column * 8;
      slots.push({ x: slotX, baseline, width: 8, height: 6, rowIndex, role });
      access.set(index, uniqueCells([
        ...horizontalLine(spineX, Math.min(origin.x + width - 3, slotX + 7), baseline),
        ...verticalLine(spineX, baseline, sidewalkY),
      ]));
      index += 1;
    }
  }
  return { slots, access };
}

/**
 * Plans one complete urban block without reading or mutating persistence.
 * Roads describe frontage; shared pedestrian paths make rear rows accessible.
 */
export function planBlockDistrict(input: PlanInput): BlockDistrictPlan {
  const allowed = new Set(input.cells.map(cellKey));
  const roadY = input.origin.y + input.height - 4;
  const sidewalkY = roadY - 2;
  const groupIndex = input.groupOffset ?? 0;
  const flipVertical = groupIndex % 2 === 1;
  const flipHorizontal = groupIndex % 4 >= 2;
  const mirror = (cell: Cell): Cell => ({
    x: flipHorizontal ? input.origin.x + input.width - 1 - (cell.x - input.origin.x) : cell.x,
    y: flipVertical ? input.origin.y + input.height - 1 - (cell.y - input.origin.y) : cell.y,
  });
  const main = horizontalLine(input.origin.x + 2, input.origin.x + input.width - 3, roadY).map(mirror);
  const pattern: BlockPattern = input.archetype === "NEW_BUILD"
    ? "DENSE_SUPERBLOCK_3X3"
    : input.archetype === "PRIVATE"
      ? "PRIVATE_STREET_ROW"
      : input.archetype === "CIVIC"
        ? "CIVIC_CLUSTER"
        : "COMMERCIAL_STRIP";
  const template = input.archetype === "NEW_BUILD"
    ? denseSlots(input.origin, input.width, sidewalkY)
    : input.archetype === "PRIVATE"
      ? privateSlots(input.origin, input.width, sidewalkY)
      : stripSlots(input.origin, input.width, sidewalkY, input.archetype);
  const groupId = `${input.districtId}:block:${String(groupIndex).padStart(3, "0")}`;
  const facadeFamily = input.archetype === "NEW_BUILD"
    ? `dense-${groupIndex % 4}`
    : input.archetype === "PRIVATE"
      ? `private-${groupIndex % 5}`
      : `${input.archetype.toLocaleLowerCase()}-${groupIndex % 3}`;
  const validSlots = template.slots.filter((slot) => rectangleFootprint(
    { x: slot.x, y: slot.baseline - slot.height }, slot.width, slot.height,
  ).every((cell) => allowed.has(cellKey(cell))));
  const slotCount = validSlots.length;
  const lots = validSlots.map((slot, slotIndex): PlannedLotDto => {
    const originalIndex = template.slots.indexOf(slot);
    const canonicalOrigin = { x: slot.x, y: slot.baseline - slot.height };
    const mirroredCorners = [canonicalOrigin, { x: canonicalOrigin.x + slot.width - 1, y: canonicalOrigin.y + slot.height - 1 }].map(mirror);
    const lotOrigin = {
      x: Math.min(...mirroredCorners.map((cell) => cell.x)),
      y: Math.min(...mirroredCorners.map((cell) => cell.y)),
    };
    return {
      id: `${groupId}:lot:${String(slotIndex).padStart(2, "0")}`,
      origin: lotOrigin,
      width: slot.width,
      height: slot.height,
      taskId: null,
      layoutVersion: "block-v2",
      groupId,
      pattern,
      slotIndex,
      slotCount,
      rowIndex: slot.rowIndex,
      role: slot.role,
      frontageSide: flipVertical ? "N" : "S",
      facadeFamily,
      alignmentX: "START",
      alignmentY: "END",
      // Front-row private homes receive their own short entrance path during
      // placement instead of extending the same shared trail past every yard.
      sharedAccess: input.archetype === "PRIVATE" && slot.rowIndex === 2
        ? []
        : (template.access.get(originalIndex) ?? []).map(mirror).filter((cell) => allowed.has(cellKey(cell))),
    };
  });
  return { main, branches: [], lots, pattern };
}
