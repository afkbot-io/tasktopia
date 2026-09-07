import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { registerUser } from "../src/server/auth";
import { AppService } from "../src/server/app-service";
import { createTestDb } from "../src/server/db";
import { cellKey, connected, intersects } from "../src/server/world/grid";
import { readActiveBlockLayout } from "../src/server/world/active-block-layout";
import { rasterizeBlockRoads } from "../src/server/world/block-layout-compiler";
import { auditWorld } from "../src/server/world/world-audit";

const cityCount = Number(process.env.SCALE_CITIES ?? 1);
const districtsPerCity = Number(process.env.SCALE_DISTRICTS ?? 10);
const tasksPerCity = Number(process.env.SCALE_TASKS ?? 25);
// macOS developer runs have wider scheduler/virtualization variance than the
// production Linux host. The release host keeps the original 15 s ceiling;
// local Darwin runs use 20 s while still reporting every phase for comparison.
const platformGenerationBudgetMs = process.platform === "darwin" ? 20_000 : 15_000;
const generationBudgetMs = Number(process.env.SCALE_GENERATION_BUDGET_MS ?? platformGenerationBudgetMs);
const chunkBudgetMs = Number(process.env.SCALE_CHUNK_BUDGET_MS ?? 1_500);
// The revisit workload is nine chunks per city. Keep the same 50ms per
// nine-chunk budget when the caller increases SCALE_CITIES.
const cachedChunkBudgetMs = Number(process.env.SCALE_CACHED_CHUNK_BUDGET_MS ?? 50 * cityCount);
// Node 24 on macOS keeps substantially more native/V8 address-space resident
// than the Linux production image (the clean 1.19.9 baseline is ~790 MB while
// using only 147 MB heap). Keep the Linux release ceiling strict and make the
// local macOS gate detect a real regression instead of failing every baseline.
const platformRssBudgetMb = process.platform === "darwin" ? 850 : 512;
const rssBudgetMb = Number(process.env.SCALE_RSS_BUDGET_MB ?? platformRssBudgetMb);
const db = await createTestDb();
try {
const registered = await registerUser(db, { email: "scale@tasktopia.local", name: "Scale Mayor", password: "scale-password-123" });
await db.prepare("UPDATE countries SET seed = ? WHERE id = ?").run(424_242, registered.user.countryId);
const service = new AppService(db);
const startedAt = performance.now();
let cityGenerationMs = 0;
let districtGenerationMs = 0;
let taskGenerationMs = 0;

const cities = [];
const committedTaskFootprints = new Map<string, string>();
for (let cityIndex = 0; cityIndex < cityCount; cityIndex += 1) {
  const cityStartedAt = performance.now();
  const city = await service.createCity(registered.user.countryId, {
            name: `Scale City ${cityIndex + 1}`,
            idempotencyKey: `scale-city-${cityIndex}`,
          });
  cityGenerationMs += performance.now() - cityStartedAt;
  cities.push(city);
  for (let districtIndex = 0; districtIndex < districtsPerCity; districtIndex += 1) {
    const districtStartedAt = performance.now();
    await service.createDistrict(registered.user.countryId, {
                              cityId: city.id,
                              name: `District ${districtIndex + 1}`,
                              archetype: districtIndex === 0 ? "PRIVATE" : undefined,
                              capacitySp: 26,
                              activate: districtIndex === 0,
                              idempotencyKey: `scale-district-${cityIndex}-${districtIndex}`,
                            });
    districtGenerationMs += performance.now() - districtStartedAt;
  }
  for (let taskIndex = 0; taskIndex < tasksPerCity; taskIndex += 1) {
    const taskStartedAt = performance.now();
    let task;
    try {
      task = await service.createTask(registered.user.countryId, {
                              cityId: city.id,
                              title: `Home task ${taskIndex + 1}`,
                              estimate: 1,
                              idempotencyKey: `scale-task-${cityIndex}-${taskIndex}`,
                            });
    } catch (error) {
      const activeDistrict = (await service.listDistricts(registered.user.countryId, city.id))
        .find((district) => district.status === "ACTIVE");
      console.error(JSON.stringify({
        failedTaskIndex: taskIndex,
        activeDistrict: activeDistrict ? {
          id: activeDistrict.id,
          archetype: activeDistrict.archetype,
          cells: activeDistrict.cells.length,
          plannedSlots: activeDistrict.lots.length,
          vacantSlots: activeDistrict.lots.filter(lot => lot.vacant).length,
        } : null,
      }, null, 2));
      throw error;
    }
    taskGenerationMs += performance.now() - taskStartedAt;
    if (taskIndex === 0) committedTaskFootprints.set(task.id, JSON.stringify(task.footprint));
  }
}
const generationMs = performance.now() - startedAt;

const layouts = await Promise.all(cities.map(city => readActiveBlockLayout(db, city.id)));
assert.ok(layouts.every(Boolean), "all cities must have a canonical layout");
const roads = layouts.flatMap(layout => rasterizeBlockRoads(layout!.roadNetwork));
for (const layout of layouts) {
  const cityRoads = rasterizeBlockRoads(layout!.roadNetwork);
  if (cityRoads.length > 0) assert.equal(connected(cityRoads), true, "each city road network must be connected");
}
assert.deepEqual((await auditWorld(db, service, registered.user.countryId)).violations, []);
const districts = await service.listDistricts(registered.user.countryId);
const tasks = await service.listTasks(registered.user.countryId);
assert.equal(districts.length, cityCount * districtsPerCity);
assert.equal(tasks.length, cityCount * tasksPerCity);
for (const [taskId, footprint] of committedTaskFootprints) {
  const task = tasks.find((candidate) => candidate.id === taskId);
  assert.ok(task, `committed task ${taskId} must still exist`);
  assert.equal(JSON.stringify(task.footprint), footprint, `committed task ${taskId} must not move during growth`);
}
const districtCells = new Set<string>();
for (const district of districts) {
  // Streets separate block interiors. Connectivity belongs to the city's road
  // graph, not to the set of buildable ground cells across those streets.
  for (const cell of district.cells) {
    const key = cellKey(cell);
    assert.equal(districtCells.has(key), false, `district overlap at ${key}`);
    districtCells.add(key);
  }
}
const finalCities = await service.listCities(registered.user.countryId);
for (let left = 0; left < finalCities.length; left += 1) {
  for (let right = left + 1; right < finalCities.length; right += 1) {
    assert.equal(intersects(finalCities[left]!.bounds, finalCities[right]!.bounds), false, `${finalCities[left]!.name} overlaps ${finalCities[right]!.name}`);
  }
}

const occupied = new Set<string>();
for (const task of tasks) {
  const district = districts.find((candidate) => candidate.id === task.districtId)!;
  const allowed = new Set(district.cells.map(cellKey));
  for (const cell of task.footprint) {
    const key = cellKey(cell);
    assert.equal(allowed.has(key), true, `${task.title} must stay inside its district`);
    assert.equal(occupied.has(key), false, `${task.title} overlaps another task at ${key}`);
    occupied.add(key);
  }
}

const chunksStartedAt = performance.now();
let terrainCells = 0;
for (const city of cities) {
  const center = await service.chunkForCell(city.center);
  for (let chunkY = center.chunkY - 1; chunkY <= center.chunkY + 1; chunkY += 1) {
    for (let chunkX = center.chunkX - 1; chunkX <= center.chunkX + 1; chunkX += 1) {
      terrainCells += (await service.getChunk(registered.user.countryId, chunkX, chunkY)).terrain.length;
    }
  }
}
const chunkMs = performance.now() - chunksStartedAt;
const cachedSamples: number[] = [];
for (let sample = 0; sample < 5; sample += 1) {
  const cachedChunksStartedAt = performance.now();
  for (const city of cities) {
    const center = await service.chunkForCell(city.center);
    for (let chunkY = center.chunkY - 1; chunkY <= center.chunkY + 1; chunkY += 1) {
      for (let chunkX = center.chunkX - 1; chunkX <= center.chunkX + 1; chunkX += 1) {
        await service.getChunk(registered.user.countryId, chunkX, chunkY);
      }
    }
  }
  cachedSamples.push(performance.now() - cachedChunksStartedAt);
}
const cachedChunkMs = Math.max(...cachedSamples);
const memory = process.memoryUsage();
const rssMb = Math.round(memory.rss / 1024 / 1024);
// Measure the actual compact contract; there is no synthetic old runtime
// baseline. Storage counts distinguish canonical rows from derived road cells.
let compactWireBytes = 0;
for (const city of cities) {
  const center = await service.chunkForCell(city.center);
  for (let chunkY = center.chunkY - 1; chunkY <= center.chunkY + 1; chunkY += 1) {
    for (let chunkX = center.chunkX - 1; chunkX <= center.chunkX + 1; chunkX += 1) {
      const payload = await service.getChunkPayload(registered.user.countryId, chunkX, chunkY);
      compactWireBytes += Buffer.byteLength(JSON.stringify(payload));
    }
  }
}
const report = {
  seed: 424_242,
  cities: cities.length,
  districts: districts.length,
  tasks: tasks.length,
  buildingTypes: Object.fromEntries(Object.entries(tasks.reduce<Record<string, number>>((counts, task) => {
    counts[task.buildingType] = (counts[task.buildingType] ?? 0) + 1;
    return counts;
  }, {})).sort(([left], [right]) => left.localeCompare(right))),
  roads: roads.length,
  canonicalBlocks: layouts.reduce((sum, layout) => sum + layout!.blocks.length, 0),
  occupiedPlacementRows: layouts.reduce((sum, layout) => sum + layout!.placements.length, 0),
  roadNetworkRows: layouts.length,
  roadSegments: layouts.reduce((sum, layout) => sum + layout!.roadNetwork.segments.length, 0),
  chunks: cities.length * 9,
  terrainCells,
  compactWireBytes,
  generationMs: Math.round(generationMs),
  cityGenerationMs: Math.round(cityGenerationMs),
  districtGenerationMs: Math.round(districtGenerationMs),
  taskGenerationMs: Math.round(taskGenerationMs),
  generationBudgetMs,
  chunkMs: Math.round(chunkMs),
  cachedChunkMs: Math.round(cachedChunkMs),
  cachedSamplesMs: cachedSamples.map(sample => Number(sample.toFixed(2))),
  cachedChunkBudgetMs,
  chunkBudgetMs,
  rssMb,
  rssBudgetMb,
  platform: process.platform,
  heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
};
console.log(JSON.stringify(report, null, 2));
assert.ok(generationMs <= generationBudgetMs, `generation ${Math.round(generationMs)}ms exceeded ${generationBudgetMs}ms budget`);
assert.ok(chunkMs <= chunkBudgetMs, `chunk materialization ${Math.round(chunkMs)}ms exceeded ${chunkBudgetMs}ms budget`);
assert.ok(cachedChunkMs <= cachedChunkBudgetMs, `cached chunk revisit ${Math.round(cachedChunkMs)}ms exceeded ${cachedChunkBudgetMs}ms budget`);
assert.ok(rssMb <= rssBudgetMb, `resident memory ${rssMb}MB exceeded ${rssBudgetMb}MB budget`);
} finally {
  await db.close();
}
