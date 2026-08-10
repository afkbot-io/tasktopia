import type { CardinalOrientation, Cell } from "../../shared/contracts";
import { rectangleFootprint } from "./grid";
import { centeredRoadOffsets } from "./road-geometry";

export type TransitRoadAxis = "HORIZONTAL" | "VERTICAL";
export type BusStopPlacement = {
  assetKey: "bus-stop-horizontal" | "bus-stop-vertical";
  origin: Cell;
  footprint: Cell[];
  orientation: CardinalOrientation;
};

/**
 * Produce offset pairs rather than unrelated single-stop candidates. Each
 * platform occupies two by two cells and touches, but never covers, the road
 * envelope. The stops are separated along the road so their shelters do not
 * read as one mirrored prop and buses can dwell independently.
 */
export function pairedBusStopCandidates(
  anchor: Cell,
  axis: TransitRoadAxis,
  roadWidth: number,
): Array<readonly [BusStopPlacement, BusStopPlacement]> {
  const offsets = centeredRoadOffsets(roadWidth);
  const roadMin = offsets[0]!;
  const roadMax = offsets.at(-1)!;
  const shifts = [0, -5, 5, -10, 10, -15, 15];
  return shifts.map((shift) => {
    if (axis === "HORIZONTAL") {
      const northOrigin = { x: anchor.x + shift - 3, y: anchor.y + roadMin - 2 };
      const southOrigin = { x: anchor.x + shift + 1, y: anchor.y + roadMax + 1 };
      return [{
        assetKey: "bus-stop-horizontal",
        origin: northOrigin,
        footprint: rectangleFootprint(northOrigin, 2, 2),
        orientation: "S",
      }, {
        assetKey: "bus-stop-horizontal",
        origin: southOrigin,
        footprint: rectangleFootprint(southOrigin, 2, 2),
        orientation: "N",
      }] as const;
    }
    const westOrigin = { x: anchor.x + roadMin - 2, y: anchor.y + shift - 3 };
    const eastOrigin = { x: anchor.x + roadMax + 1, y: anchor.y + shift + 1 };
    return [{
      assetKey: "bus-stop-vertical",
      origin: westOrigin,
      footprint: rectangleFootprint(westOrigin, 2, 2),
      orientation: "E",
    }, {
      assetKey: "bus-stop-vertical",
      origin: eastOrigin,
      footprint: rectangleFootprint(eastOrigin, 2, 2),
      orientation: "W",
    }] as const;
  });
}
