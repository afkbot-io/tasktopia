import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { registerUser } from "../src/server/auth";
import { AppService } from "../src/server/app-service";
import { createTestDb } from "../src/server/db";
import { cellKey, connected, intersects } from "../src/server/world/grid";

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

const cities = [];
const committedTaskFootprints = new Map<string, string>();
for (let cityIndex = 0; cityIndex < cityCount; cityIndex += 1) {
  const city = await service.createCity(registered.user.countryId, {
            name: `Scale City ${cityIndex + 1}`,
            idempotencyKey: `scale-city-${cityIndex}`,
          });
  cities.push(city);
  for (let districtIndex = 0; districtIndex < districtsPerCity; districtIndex += 1) {
    await service.createDistrict(registered.user.countryId, {
                              cityId: city.id,
                              name: `District ${districtIndex + 1}`,
                              // The opt-in scale workload uses ordinary homes so catalog uniqueness
                              // limits do not become an accidental performance-test dependency.
                              archetype: districtIndex === 0 ? "PRIVATE" : undefined,
                              capacitySp: 26,
                              activate: districtIndex === 0,
                              idempotencyKey: `scale-district-${cityIndex}-${districtIndex}`,
                            });
  }
  for (let taskIndex = 0; taskIndex < tasksPerCity; taskIndex += 1) {
    const task = await service.createTask(registered.user.countryId, {
                              cityId: city.id,
                              title: `Home task ${taskIndex + 1}`,
                              buildingHint: taskIndex === 0 ? "house-cottage" : undefined,
                              estimate: 1,
                              idempotencyKey: `scale-task-${cityIndex}-${taskIndex}`,
                            });
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
const report = {
  seed: 424_242,
  cities: cities.length,
  districts: districts.length,
  tasks: tasks.length,
  roads: roads.length,
  chunks: cities.length * 9,
  terrainCells,
  generationMs: Math.round(generationMs),
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
