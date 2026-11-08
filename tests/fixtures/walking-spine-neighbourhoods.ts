import type { Cell, RoadCellDto } from '../../src/shared/contracts';
import type { MobilityNetworkInput } from '../../src/client/city-mobility-network';

/** All eight neighbours can be missing independently. The outer pavement
 * stays connected and has protected real access, including a road crossing. */
export function walkingSpineNeighbourhood(mask: number, offset = 0): MobilityNetworkInput {
  const walkGraph = new Map<string, Cell>(), activityCells = new Set<string>();
  const key = (x: number, y: number) => `${x+offset},${y+offset}`;
  const ring = [[3,3],[4,3],[5,3],[5,4],[5,5],[4,5],[3,5],[3,4]];
  for (let y=0; y<9; y++) for (let x=0; x<9; x++) {
    const bit = ring.findIndex(([cx,cy]) => cx===x && cy===y);
    if (bit>=0 && !(mask & 1<<bit)) continue;
    walkGraph.set(key(x,y),{x:x+offset,y:y+offset});
    if (x===0 || y===0 || x===8 || y===8) activityCells.add(key(x,y));
  }
  const roads = new Map<string, RoadCellDto>([0,1].map(x => [key(x,0),{
    x:x+offset,y:offset,roadClass:'LOCAL',structure:'ROAD',mask:0,
  }]));
  return {walkGraph,roads,activityCells,crosswalks:new Set([key(1,0)]),
    buildingEntrances:new Set([key(0,4)]),transferCells:new Set([key(8,4)])};
}
