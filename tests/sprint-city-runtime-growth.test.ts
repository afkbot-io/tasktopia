import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createTestDb } from "../src/server/db";
import type { ChunkTaskDto, TaskDto } from "../src/shared/contracts";
import type { CitySceneDto } from "../src/shared/city-scene-contract";
import { expandRoadRuns } from "../src/shared/world-cell-runs";

const physicalTask = (task: TaskDto | ChunkTaskDto) => ({ id: task.id, taskNumber: task.taskNumber,
  cityId: task.cityId, districtId: task.districtId, origin: task.origin, footprint: task.footprint,
  accessPath: task.accessPath, buildingType: task.buildingType, visualKind: task.visualKind,
  visualAssetKey: task.visualAssetKey, serviceRole: task.serviceRole, stage: task.stage });
const sceneTasks = (scene: CitySceneDto) => new Map([
  ...scene.chunks.flatMap(chunk => chunk.tasks),
  ...scene.completedDistrictSnapshots.flatMap(snapshot => snapshot.tasks),
].map(task => [task.id, task]));
const percentile = (values: number[], fraction: number) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1]!;

/**
 * Isolated PostgreSQL integration, not a replacement for the pure 1,000-task
 * proof. Workload: seed424242, twenty pre-existing sprint IDs, 240 PLANNING
 * tasks submitted round-robin with normal automatic visual selection.
 * Provisional local regression budgets: last20 creation p95<250ms; cold scene
 * <2s. Record distributions and source hashes, never extrapolate throughput.
 */
it("appends task221–240 through real storage and serves every preserved parcel in a fresh complete city scene", { timeout: 90_000 }, async context => {
  const sourcePaths = ["src/server/app-service.ts", "src/server/world/block-layout-compiler.ts",
    "src/server/world/active-block-layout.ts", "src/shared/block-templates.ts"];
  const sourceSha256 = Object.fromEntries(await Promise.all(sourcePaths.map(async path =>
    [path, createHash("sha256").update(await readFile(path)).digest("hex")])));
  const db = await createTestDb();
  try {
    const service = new AppService(db);
    const { countryId } = (await registerUser(db, {
      email: "twenty-sprint-growth@example.test", name: "Sprint growth QA", password: "password123",
    })).user;
    await db.prepare("UPDATE countries SET seed = ? WHERE id = ?").run(424242, countryId);
    const city = await service.createCity(countryId, { name: "Twenty real sprints", idempotencyKey: "growth-city" });
    const districts = [];
    for (let index = 0; index < 20; index++) districts.push(await service.createDistrict(countryId, {
      cityId: city.id, name: `Sprint ${index + 1}`, activate: index === 0, idempotencyKey: `growth-sprint-${index}`,
    }));
    const created = new Map<string, ReturnType<typeof physicalTask>>();
    const timings: number[] = [];
    let before: CitySceneDto | undefined;
    const start = performance.now();
    for (let number = 1; number <= 240; number++) {
      const district = districts[(number - 1) % districts.length]!;
      const taskStart = performance.now();
      const task = await service.createTask(countryId, {
        cityId: city.id, districtId: district.id, title: `Ordered work ${number}`, estimate: 1,
        idempotencyKey: `growth-work-${number}`,
      });
      timings.push(performance.now() - taskStart);
      expect(task.taskNumber).toBe(number);
      expect(task.districtId).toBe(district.id);
      created.set(task.id, physicalTask(task));
      if (number === 220) before = await new AppService(db).getCityScene(countryId, city.id);
    }
    const appendElapsedMs = performance.now() - start;
    const fresh = new AppService(db);
    const readStart = performance.now();
    const scene = await fresh.getCityScene(countryId, city.id);
    const coldSceneMs = performance.now() - readStart;
    const tasks = sceneTasks(scene);
    expect(tasks.size).toBe(240);
    for (const [id, snapshot] of created) assert.deepEqual(physicalTask(tasks.get(id)!), snapshot);
    const preserved = sceneTasks(before!);
    expect(preserved.size).toBe(220);
    for (const [id, task] of preserved) assert.deepEqual(physicalTask(tasks.get(id)!), physicalTask(task));
    const roads = new Set(scene.chunks.flatMap(chunk => expandRoadRuns(chunk.roadRuns)).map(point => `${point.x}:${point.y}`));
    for (const point of before!.chunks.flatMap(chunk => expandRoadRuns(chunk.roadRuns))) {
      expect(roads.has(`${point.x}:${point.y}`)).toBe(true);
    }
    const chunks = new Set(scene.chunks.map(chunk => `${chunk.chunkX}:${chunk.chunkY}`));
    const bounds = scene.city.bounds;
    for (let y = Math.floor(bounds.minY / scene.chunkSize); y <= Math.floor(bounds.maxY / scene.chunkSize); y++) {
      for (let x = Math.floor(bounds.minX / scene.chunkSize); x <= Math.floor(bounds.maxX / scene.chunkSize); x++) {
        expect(chunks.has(`${x}:${y}`)).toBe(true);
      }
    }
    const storedDistricts = await fresh.listDistricts(countryId, city.id);
    expect(storedDistricts.map(district => district.id)).toEqual(districts.map(district => district.id));
    expect((await fresh.listTasks(countryId)).map(task => task.id).sort()).toEqual([...created.keys()].sort());
    expect(await fresh.listCities(countryId)).toHaveLength(1);
    expect([...tasks.values()].every(task => task.stage === 1)).toBe(true);
    const last20 = timings.slice(-20);
    const p50 = percentile(last20, .5), p95 = percentile(last20, .95);
    const measurement = { workload: "one-city/20-precreated-sprints/240-automatic-planning-tasks", seed: 424242,
      node: process.version, sourceSha256, taskCount: 240, sprintCount: 20, preservedTasks: preserved.size,
      chunks: chunks.size, sceneRevision: scene.sceneRevision, bounds, appendElapsedMs, coldSceneMs,
      creationLast20Ms: { samples: last20, p50, p95, maximum: Math.max(...last20) },
      budgets: { creationP95Ms: 250, coldSceneMs: 2000 }, databaseWorkloadIsNot1000Tasks: true };
    Object.assign(context.task.meta, { sprintRuntimeGrowth: measurement });
    expect(p95, JSON.stringify(measurement)).toBeLessThan(250);
    expect(coldSceneMs, JSON.stringify(measurement)).toBeLessThan(2000);
  } finally { await db.close(); }
});
