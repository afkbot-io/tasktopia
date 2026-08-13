import { constructionPadDepth } from "../shared/construction-stage";

const CELL_SIZE = 8;

export type ConstructionSiteFence = {
  bounds: { left: number; top: number; right: number; bottom: number };
  gate: { left: number; right: number };
};

/**
 * A temporary one-cell construction envelope around a building footprint.
 * Coordinates are local to the building's south-centre anchor.  The fence is
 * presentation infrastructure, never part of a stage PNG, and disappears as
 * soon as the fifth (completed) stage is reached.
 */
export function constructionSiteFence(
  footprint: { width: number; height: number },
  entranceOffset: number,
  stage: number,
): ConstructionSiteFence | null {
  if (stage >= 5) return null;
  const halfWidth = footprint.width * CELL_SIZE / 2;
  const padDepth = constructionPadDepth(footprint);
  const gateCenter = (entranceOffset - footprint.width / 2) * CELL_SIZE;
  return {
    bounds: {
      left: -halfWidth - CELL_SIZE,
      top: -padDepth * CELL_SIZE - CELL_SIZE,
      right: halfWidth + CELL_SIZE,
      bottom: CELL_SIZE,
    },
    gate: { left: gateCenter - CELL_SIZE, right: gateCenter + CELL_SIZE },
  };
}
