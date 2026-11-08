import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { buildMobilityNetworkAsync, buildWalkingSpine } from '../src/client/city-mobility-network';
import type { Cell } from '../src/shared/contracts';
import { walkingSpineNeighbourhood } from './fixtures/walking-spine-neighbourhoods';

it('reads each authored coordinate a bounded number of times while reducing broad pavement', () => {
  let coordinateReads=0;
  const walkGraph = new Map<string, Cell>();
  for (let y=-16; y<16; y++) for (let x=-16; x<16; x++) walkGraph.set(`${x},${y}`,{
    get x() {coordinateReads++;return x;},get y() {coordinateReads++;return y;},
  });
  const spine=buildWalkingSpine({walkGraph,roads:new Map(),activityCells:new Set(),crosswalks:new Set()});
  expect(coordinateReads).toBeLessThanOrEqual(walkGraph.size*8);
  expect(spine.size).toBeGreaterThan(0);expect(spine.size).toBeLessThan(walkGraph.size);
  for(const [id,cell] of spine)expect(cell).toBe(walkGraph.get(id));
  expect(walkGraph.size).toBe(1024);
});

it('cancels during numeric neighbourhood preparation within one cell batch without publishing a result', async () => {
  const controller=new AbortController(),reason=new Error('superseded numeric topology');
  let reads=0,abortedAt=0,published=false;
  const walkGraph=new Map<string,Cell>();
  const read=()=>{reads++;if(reads===34){abortedAt=reads;controller.abort(reason);}};
  for(let x=0;x<512;x++)walkGraph.set(`${x},0`,{
    get x(){read();return x;},get y(){read();return 0;},
  });
  await expect(buildMobilityNetworkAsync({walkGraph,roads:new Map(),activityCells:new Set(),crosswalks:new Set()},
    {signal:controller.signal,now:()=>0,yieldTask:async()=>{}}).then(result=>{published=true;return result;})).rejects.toBe(reason);
  expect(abortedAt).toBe(34);expect(reads-abortedAt).toBeLessThanOrEqual(32);
  expect(reads).toBeLessThan(walkGraph.size);expect(published).toBe(false);
});

it.each([
  [0,'6b2148dfe56cf1883b75a21db73b01c6fa277882757e22cb33dc5500b46d43f9'],[2**40,'74f89793865ebc233616e14cd9d8d1bb512cb0ade773e2d9c33ec3ad01abb6c8'],[-(2**40),'71fbefc44c72f8062d5f68d8ed38912dd01b18f55d2600f771e3584967cf7fd7'],
] as const)('preserves every neighbourhood mask and deterministic order at offset%s', (offset,expected) => {
  const hash=createHash('sha256');
  for(let mask=0;mask<256;mask++){
    const input=walkingSpineNeighbourhood(mask,offset),before=[...input.walkGraph];
    const result=buildWalkingSpine(input);
    hash.update(JSON.stringify([...result]));
    const reversed=buildWalkingSpine({...input,walkGraph:new Map([...input.walkGraph].reverse())});
    expect([...reversed]).toEqual([...result]);expect([...input.walkGraph]).toEqual(before);
    for(const id of [...input.buildingEntrances!,...input.transferCells!,...input.crosswalks])expect(result.has(id),id).toBe(true);
  }
  // Full ordered results recorded from5042f0e9 before the algorithm changed.
  expect(hash.digest('hex')).toBe(expected);
});
