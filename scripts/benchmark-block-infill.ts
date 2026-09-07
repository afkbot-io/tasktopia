import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { blockSlots, createBlockSitePlan, BLOCK_TEMPLATE_VERSION } from "../src/shared/block-templates";
import type { CityBlockV1 } from "../src/shared/block-world";
import { compileBlockLayout } from "../src/server/world/block-layout-compiler";
import { generateWorldDecorations } from "../src/shared/world-decorations";
import type { TerrainCellDto } from "../src/shared/contracts";

// Pure CPU workload: no database/network/provider writes. Budgets are local
// regression ceilings, not client frame-rate or production latency promises.
assert.ok(Number(process.versions.node.split(".")[0]) >= 24);
const block: CityBlockV1 = { id: "benchmark", districtLayoutId: "d", sequence: 0, kind: "RESIDENTIAL",
  templateKey: "residential-court", templateVersion: 2, variant: "south", seed: 17,
  origin: { x: 0, y: 0 }, width: 32, height: 32, parameters: {}, summary: {} };
const samples = (run: () => unknown, count: number) => {
  for (let i = 0; i < 3; i++) run();
  const times: number[] = [];
  for (let i = 0; i < count; i++) { const start = performance.now(); run(); times.push(performance.now() - start); }
  times.sort((a, b) => a - b);
  return { samples: count, p50Ms: times[Math.floor(count / 2)]!, p95Ms: times[Math.ceil(count * .95) - 1]!, maxMs: times.at(-1)! };
};
const oldPacking = samples(() => blockSlots(block), 40);
const infillPacking = samples(() => blockSlots({ ...block, parameters: { packingCorner: "SE", infill: true } }), 40);
const newBlock = { ...block, templateVersion: BLOCK_TEMPLATE_VERSION, parameters: { packingCorner: "SE", infill: true } };
const sitePlan = createBlockSitePlan(newBlock);
const planned = { ...newBlock, parameters: { ...newBlock.parameters, sitePlan } };
assert.deepEqual(blockSlots(planned), blockSlots({ ...block, parameters: newBlock.parameters }));
const planCreation = samples(() => createBlockSitePlan(newBlock), 40);
const storedPlanRead = samples(() => blockSlots(planned), 40);
const input = { countryId: "benchmark", cityId: "benchmark", seed: 17, revision: 1,
  districts: Array.from({ length: 20 }, (_, d) => ({ id: `d${d}`, archetype: "MIXED_URBAN", sequence: d,
    tasks: Array.from({ length: 50 }, (_, i) => ({ id: `t${d * 50 + i}`, taskNumber: d * 50 + i + 1,
      autoVisualKind: true, buildingFamily: "compact-apartment-v1", facadeVariant: "south", constructionStage: 5 as const })) })) };
const compile1000 = samples(() => compileBlockLayout(input), 5);
const terrain: TerrainCellDto[] = Array.from({ length: 4096 }, (_, i) => ({ x: i % 64, y: Math.floor(i / 64), terrain: "FOREST", variant: 0 }));
const forest64 = samples(() => generateWorldDecorations(91357, terrain, new Set(), [], [], [], []), 30);
const budgetsMs = { infillPackingP95: 10, planCreationP95: 10, storedPlanReadP95: 10, compile1000P95: 1500, forest64P95: 50 };
const failures = [infillPacking.p95Ms > budgetsMs.infillPackingP95 && "infillPacking",
  planCreation.p95Ms > budgetsMs.planCreationP95 && "planCreation", storedPlanRead.p95Ms > budgetsMs.storedPlanReadP95 && "storedPlanRead",
  compile1000.p95Ms > budgetsMs.compile1000P95 && "compile1000", forest64.p95Ms > budgetsMs.forest64P95 && "forest64"].filter(Boolean);
console.log(JSON.stringify({ node: process.version, platform: process.platform, budgetsMs, oldPacking, infillPacking,
  planCreation, storedPlanRead, planJsonBytes: Buffer.byteLength(JSON.stringify(sitePlan)), compile1000, forest64, failures }, null, 2));
if (failures.length) process.exitCode = 1;
