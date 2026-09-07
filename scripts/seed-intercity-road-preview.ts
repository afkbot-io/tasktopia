import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { createDb } from "../src/server/db";
import { registerUser } from "../src/server/auth";
import { AppService } from "../src/server/app-service";
import { readCountryRoads } from "../src/server/world/intercity-road-store";
import { auditWorld } from "../src/server/world/world-audit";
import { CityRoadPadding } from "../src/client/city-road-padding";
import { isBuildableTerrain, terrainAt } from "../src/shared/world-terrain";
import { intercityRoadCorridors } from "../src/shared/intercity-roads";
import type { TaskDto, TaskStatus } from "../src/shared/contracts";
import type { CitySceneDto } from "../src/shared/city-scene-contract";

function paddingExits(scenes: CitySceneDto[]) {
  return scenes.flatMap(scene => {
    const padding = new CityRoadPadding(scene, cell => isBuildableTerrain(terrainAt(1, cell.x, cell.y).terrain));
    const candidates = new Set<string>();
    for (const bounds of intercityRoadCorridors(scene.intercityRoads)) {
      for (let y = Math.floor(bounds.minY / 64); y <= Math.floor(bounds.maxY / 64); y++) {
        for (let x = Math.floor(bounds.minX / 64); x <= Math.floor(bounds.maxX / 64); x++) candidates.add(`${x},${y}`);
      }
    }
    return [...candidates].flatMap(id => {
      const [x, y] = id.split(",").map(Number) as [number, number];
      const chunk = padding.get(x, y);
      return chunk?.roads.length ? [{ cityId: scene.city.id, chunkX: x, chunkY: y, roadCells: chunk.roads.length, surfaceCells: chunk.surfaces.length }] : [];
    });
  });
}

// This command creates a new isolated namespace only. It cannot select, wipe,
// regenerate or reuse an existing world, including any production database.
assert.equal(process.env.SEED_INTERCITY_PREVIEW, "true", "Explicit SEED_INTERCITY_PREVIEW=true is required");
const databaseUrl = process.env.TEST_DATABASE_URL ?? "postgres://tasktopia:tasktopia@127.0.0.1:5432/tasktopia_test";
const url = new URL(databaseUrl);
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  && url.pathname === "/tasktopia_test" && !url.searchParams.has("options"), "Only the local base test database is allowed");
const schema = `intercity_road_preview_${randomUUID().replaceAll("-", "")}`;
const admin = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
try { await admin.unsafe(`CREATE SCHEMA "${schema}"`); } finally { await admin.end(); }
console.error(`Preview schema: ${schema}`);
const db = await createDb(databaseUrl, { schema });
try {
  const startedAt = performance.now();
  const { user } = await registerUser(db, { email: "demo@tasktopia.local", password: "tasktopia-demo", name: "Связанные города" });
  await db.prepare("UPDATE countries SET seed=? WHERE id=?").run(1, user.countryId);
  const service = new AppService(db);
  const a = await service.createCity(user.countryId, { name: "Город Альфа", idempotencyKey: "city-a" });
  const b = await service.createCity(user.countryId, { name: "Город Бета", idempotencyKey: "city-b" });
  assert.deepEqual(a.center, { x: 192, y: 96 });
  assert.deepEqual(b.center, { x: 224, y: 160 });
  const da = await service.createDistrict(user.countryId, { cityId: a.id, name: "Спринт Альфа", activate: true, capacitySp: 120, idempotencyKey: "district-a" });
  const dbeta = await service.createDistrict(user.countryId, { cityId: b.id, name: "Спринт Бета", activate: true, capacitySp: 120, idempotencyKey: "district-b" });
  const statuses: TaskStatus[] = ["STARTED", "IN_PROGRESS", "TESTING", "COMPLETED"];
  const tasks: TaskDto[] = [];
  const add = async (cityId: string, districtId: string, index: number) => {
    const task = await service.createTask(user.countryId, { cityId, districtId, title: `Участок ${index + 1}`, estimate: 1, idempotencyKey: `task-${index}` });
    for (let stage = 0; stage < index % 5; stage++) await service.updateTaskStatus(user.countryId, { taskId: task.id, status: statuses[stage]!, idempotencyKey: `task-${index}-stage-${stage}` });
    tasks.push(await service.getTask(user.countryId, task.id));
  };
  await add(a.id, da.id, 0);
  await add(b.id, dbeta.id, 1);
  const accepted = (await readCountryRoads(db, user.countryId))!;
  assert.equal(accepted.plan.routes.length, 1);
  for (let i = 2; i < 37; i++) await add(a.id, da.id, i);
  for (let i = 37; i < 49; i++) await add(b.id, dbeta.id, i);
  const beforeThird = (await readCountryRoads(db, user.countryId))!;
  assert.deepEqual(beforeThird.plan.routes, accepted.plan.routes);
  const cities = [a, b];
  let scenes = await Promise.all(cities.map(city => new AppService(db).getCityScene(user.countryId, city.id)));
  let exits = paddingExits(scenes);
  for (const name of ["Гамма", "Дельта", "Эпсилон", "Дзета", "Эта", "Тета"]) {
    if (exits.some(exit => exit.roadCells >= 24)) break;
    const city = await service.createCity(user.countryId, { name: `Город ${name}`, idempotencyKey: `city-${name}` });
    const district = await service.createDistrict(user.countryId, { cityId: city.id, name: `Спринт ${name}`, activate: true, capacitySp: 120, idempotencyKey: `district-${name}` });
    await add(city.id, district.id, tasks.length);
    cities.push(city);
    scenes = await Promise.all(cities.map(item => new AppService(db).getCityScene(user.countryId, item.id)));
    exits = paddingExits(scenes);
    console.error(`${cities.length} real cities; maximum padding road cells ${Math.max(0, ...exits.map(exit => exit.roadCells))}`);
  }
  const snapshot = (await readCountryRoads(db, user.countryId))!;
  for (const route of accepted.plan.routes) assert.deepEqual(snapshot.plan.routes.find(item => item.id === route.id), route);
  for (const scene of scenes) {
    assert.deepEqual(scene.intercityRoads, snapshot.plan.routes.filter(route => route.fromCityId === scene.city.id || route.toCityId === scene.city.id));
  }
  const audit = await auditWorld(db, service, user.countryId);
  assert.deepEqual(audit.violations, []);
  console.log(JSON.stringify({ schema, seed: 1, countryId: user.countryId,
    cities: scenes.map(scene => ({ ...scene.city, sceneRevision: scene.sceneRevision, chunks: scene.chunks.map(chunk => [chunk.chunkX, chunk.chunkY]),
      taskCount: tasks.filter(task => task.cityId === scene.city.id).length })),
    routes: snapshot.plan.routes, unreachable: snapshot.plan.unreachable, exits, elapsedMs: performance.now() - startedAt, audit }, null, 2));
} finally { await db.close(); }
