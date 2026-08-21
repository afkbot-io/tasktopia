import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { registerUser } from "../src/server/auth";
import { AppService } from "../src/server/app-service";
import { createTestDb } from "../src/server/db";
import { cellKey, connected, intersects } from "../src/server/world/grid";
import { materializeChunkPayload } from "../src/shared/world-chunk-payload";
import { expandCellRuns } from "../src/shared/world-cell-runs";

const cityCount = Number(process.env.SCALE_CITIES ?? 1);
const districtsPerCity = Number(process.env.SCALE_DISTRICTS ?? 10);
const tasksPerCity = Number(process.env.SCALE_TASKS ?? 25);
const generationBudgetMs = Number(process.env.SCALE_GENERATION_BUDGET_MS ?? 15_000);
const chunkBudgetMs = Number(process.env.SCALE_CHUNK_BUDGET_MS ?? 1_500);
const rssBudgetMb = Number(process.env.SCALE_RSS_BUDGET_MB ?? 512);
const db = await createTestDb();
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
                              // The opt-in scale workload uses low-rise apartments so catalog uniqueness
                              // limits do not become an accidental performance-test dependency.
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
                              buildingHint: taskIndex === 0 ? "house-lowrise-gallery" : undefined,
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
          lots: activeDistrict.lots.map((lot) => ({
            id: lot.id, groupId: lot.groupId, role: lot.role, taskId: lot.taskId,
            origin: lot.origin, width: lot.width, height: lot.height,
          })),
        } : null,
      }, null, 2));
      throw error;
    }
    taskGenerationMs += performance.now() - taskStartedAt;
    if (taskIndex === 0) committedTaskFootprints.set(task.id, JSON.stringify(task.footprint));
  }
}
const generationMs = performance.now() - startedAt;

const roads = await db.prepare("SELECT x, y FROM roads_v3 WHERE country_id = ?").all(registered.user.countryId) as Array<{ x: number; y: number }>;
assert.equal(connected(roads), true, "national road network must be connected");
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
  assert.equal(connected(district.cells), true, `${district.name} must be connected`);
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
const cachedChunksStartedAt = performance.now();
for (const city of cities) {
  const center = await service.chunkForCell(city.center);
  for (let chunkY = center.chunkY - 1; chunkY <= center.chunkY + 1; chunkY += 1) {
    for (let chunkX = center.chunkX - 1; chunkX <= center.chunkX + 1; chunkX += 1) {
      await service.getChunk(registered.user.countryId, chunkX, chunkY);
    }
  }
}
const cachedChunkMs = performance.now() - cachedChunksStartedAt;
const memory = process.memoryUsage();
const rssMb = Math.round(memory.rss / 1024 / 1024);
// Compare equivalent v1/v2 wire representations after the runtime memory
// snapshot. Expanding and stringifying the synthetic legacy payload is a
// benchmark-only allocation and must not pollute the server RSS gate.
let compactWireBytes = 0;
let legacyWireBytes = 0;
for (const city of cities) {
  const center = await service.chunkForCell(city.center);
  for (let chunkY = center.chunkY - 1; chunkY <= center.chunkY + 1; chunkY += 1) {
    for (let chunkX = center.chunkX - 1; chunkX <= center.chunkX + 1; chunkX += 1) {
      const payload = await service.getChunkPayload(registered.user.countryId, chunkX, chunkY);
      const materialized = materializeChunkPayload(payload);
      compactWireBytes += Buffer.byteLength(JSON.stringify(payload));
      const { terrain: _terrain, decorations: _decorations, worldVersion: _worldVersion, ...legacyWorld } = materialized;
      void _terrain; void _decorations; void _worldVersion;
      const decorationDistricts = payload.payloadVersion === 2
        ? payload.decorationContext.districts.map(({ cellRuns, ...district }) => ({ ...district, cells: expandCellRuns(cellRuns) }))
        : payload.decorationContext.districts;
      legacyWireBytes += Buffer.byteLength(JSON.stringify({
        ...legacyWorld,
        payloadVersion: 1,
        generatorVersion: "square-v7",
        contentHash: payload.contentHash,
        terrainSeed: payload.terrainSeed,
        publishedVersion: payload.publishedVersion,
        lod: payload.lod,
        decorationContext: { ...payload.decorationContext, districts: decorationDistricts },
      }));
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
  chunks: cities.length * 9,
  terrainCells,
  compactWireBytes,
  legacyWireBytes,
  wireReductionPercent: Number(((1 - compactWireBytes / legacyWireBytes) * 100).toFixed(1)),
  generationMs: Math.round(generationMs),
  cityGenerationMs: Math.round(cityGenerationMs),
  districtGenerationMs: Math.round(districtGenerationMs),
  taskGenerationMs: Math.round(taskGenerationMs),
  generationBudgetMs,
  chunkMs: Math.round(chunkMs),
  cachedChunkMs: Math.round(cachedChunkMs),
  chunkBudgetMs,
  rssMb,
  rssBudgetMb,
  heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
};
console.log(JSON.stringify(report, null, 2));
assert.ok(generationMs <= generationBudgetMs, `generation ${Math.round(generationMs)}ms exceeded ${generationBudgetMs}ms budget`);
assert.ok(chunkMs <= chunkBudgetMs, `chunk materialization ${Math.round(chunkMs)}ms exceeded ${chunkBudgetMs}ms budget`);
assert.ok(cachedChunkMs <= 50, `cached chunk revisit ${Math.round(cachedChunkMs)}ms exceeded 50ms budget`);
assert.ok(rssMb <= rssBudgetMb, `resident memory ${rssMb}MB exceeded ${rssBudgetMb}MB budget`);
await db.close();
