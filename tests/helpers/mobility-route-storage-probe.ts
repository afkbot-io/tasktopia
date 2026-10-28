import assert from "node:assert/strict";
import { createMobilityRouteSearch } from "../../src/client/mobility-route-search";
import type { Cell } from "../../src/shared/contracts";

assert.ok(global.gc, "This isolated memory probe requires --expose-gc");
const size = 256, graph = new Map<string, Cell>(), edges = new Map<string, Cell[]>();
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) graph.set(`${x},${y}`, { x, y });
for (const [id, cell] of graph) edges.set(id, [[0, -1], [1, 0], [0, 1], [-1, 0]].flatMap(([dx, dy]) => {
  const next = graph.get(`${cell.x + dx!},${cell.y + dy!}`); return next ? [next] : [];
}));
// Both source graphs stay live, so collecting them cannot disguise the cost
// of the compiled topology. Include typed-array backing stores in the budget.
Object.assign(globalThis, { mobilityProbeInputs: { graph, edges } });
for (let i = 0; i < 4; i++) global.gc();
const before = process.memoryUsage(), search = createMobilityRouteSearch(graph, edges);
Object.assign(globalThis, { mobilityProbeSearch: search });
for (let i = 0; i < 4; i++) global.gc();
const after = process.memoryUsage();
const reachable = search({ x: 0, y: 0 }, undefined, { x: 3, y: 0 }, 4).routeTo({ x: 3, y: 0 });
assert.deepEqual(reachable, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }]);
console.log(JSON.stringify({ nodes: graph.size, edges: [...edges.values()].reduce((sum, row) => sum + row.length, 0),
  heapBytes: after.heapUsed - before.heapUsed, bufferBytes: after.arrayBuffers - before.arrayBuffers,
  compiledBytes: after.heapUsed - before.heapUsed + after.arrayBuffers - before.arrayBuffers }));
