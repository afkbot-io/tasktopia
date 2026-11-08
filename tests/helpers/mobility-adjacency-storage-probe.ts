import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { createMobilityRouteSearch } from '../../src/client/mobility-route-search';
import type { Cell } from '../../src/shared/contracts';

assert.ok(global.gc, 'This owned memory probe requires --expose-gc');
const graph = new Map<string, Cell>(), size = 256;
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) graph.set(`${x},${y}`, { x, y });
const source: { edges: Map<string, Cell[]> | undefined } = { edges: new Map() };
for (const [id, cell] of graph) source.edges!.set(id, [[0,-1], [1,0], [0,1], [-1,0]].flatMap(([dx,dy]) => {
  const next = graph.get(`${cell.x+dx!},${cell.y+dy!}`);return next ? [next] : [];
}));
function digest(edges: ReadonlyMap<string, Cell[]>) {
  const hash = createHash('sha256');for (const row of edges) hash.update(JSON.stringify(row));return hash.digest('hex');
}
const expected = digest(source.edges!), search = createMobilityRouteSearch(graph, source.edges!);
assert.equal(search.adjacency.size, graph.size);assert.equal(digest(search.adjacency), expected);
Object.assign(globalThis, { mobilityAdjacencyProbe: { graph, search } });
for (let i = 0; i < 4; i++) global.gc();
const duplicated = process.memoryUsage();
source.edges = undefined;
await setImmediate();for (let i = 0; i < 4; i++) global.gc();
const shared = process.memoryUsage();
assert.equal(digest(search.adjacency), expected);
assert.deepEqual(search({ x: 0, y: 0 }, undefined, { x: 3, y: 0 }, 4).routeTo({ x: 3, y: 0 }),
  [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }]);
console.log(JSON.stringify({ nodes: graph.size, expectedHash: expected,
  savedHeapBytes: duplicated.heapUsed - shared.heapUsed,
  savedTotalBytes: duplicated.heapUsed + duplicated.arrayBuffers - shared.heapUsed - shared.arrayBuffers }));
