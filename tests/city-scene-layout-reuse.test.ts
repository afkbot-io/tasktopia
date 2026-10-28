import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createTestDb, isTransactionActive, type Db } from "../src/server/db";
import * as hashes from "../src/server/world/chunk-payload-hash";
import type { ChunkPayloadV2Dto, TaskDto } from "../src/shared/contracts";
import type { CitySceneDto } from "../src/shared/city-scene-contract";
import { decodeCitySceneWire, encodeCitySceneWire } from "../src/shared/city-scene-wire";

const contentHash = hashes.chunkPayloadContentHash;
const stableHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

// Capture the canonical builder output, then independently apply the previous
// completed-district projection. This checks complete wire order and hashes,
// rather than only the task IDs left visible in the current scene.
function recordBuilderPages() {
  const pages = new Map<string, ChunkPayloadV2Dto>();
  const spy = vi.spyOn(hashes, "chunkPayloadContentHash").mockImplementation(content => {
    const hash = contentHash(content);
    const key = `${content.chunkX},${content.chunkY}`;
    if (!pages.has(key)) pages.set(key, { ...content, contentHash: hash });
    return hash;
  });
  return { pages, spy };
}

function expectPreviousWire(scene: CitySceneDto, pages: Map<string, ChunkPayloadV2Dto>) {
  const completed = new Set(scene.completedDistrictSnapshots.map(snapshot => snapshot.districtId));
  const chunks = [...pages.values()].map(chunk => {
    const { contentHash: previousHash, ...content } = chunk;
    void previousHash;
    const compact = { ...content, tasks: chunk.tasks.filter(task => !completed.has(task.districtId)) };
    return { ...compact, contentHash: contentHash(compact) };
  });
  const previous = { ...scene, chunks };
  expect(JSON.stringify(scene)).toBe(JSON.stringify(previous));
  expect(JSON.stringify(encodeCitySceneWire(scene))).toBe(JSON.stringify(encodeCitySceneWire(previous)));
  expect(decodeCitySceneWire(encodeCitySceneWire(scene))).toEqual(scene);
  expect(scene.sceneRevision).toBe(stableHash({
    schemaVersion: scene.schemaVersion, cityId: scene.city.id, bounds: scene.city.bounds,
    ports: scene.ports, airports: scene.airports, airportConnections: scene.airportConnections,
    railway: scene.railway, intercityRoads: scene.intercityRoads, roadContext: scene.roadContext,
    chunks: chunks.map(chunk => ({ x: chunk.chunkX, y: chunk.chunkY, hash: chunk.contentHash })),
  }));
}

describe("transaction-owned whole-city projection", () => {
  let db: Db, writer: AppService, countryId: string, userId: string, cityId: string, districtId: string;
  let done: TaskDto, active: TaskDto, foreign: TaskDto;

  beforeAll(async () => {
    db = await createTestDb(); writer = new AppService(db);
    const owner = await registerUser(db, { email: "scene-layout-reuse@example.test", name: "Scene", password: "password123" });
    countryId = owner.user.countryId; userId = owner.user.id;
    await db.prepare("UPDATE countries SET seed=424242 WHERE id=?").run(countryId);
    cityId = (await writer.createCity(countryId, { name: "Scene", idempotencyKey: "city" })).id;
    districtId = (await writer.createDistrict(countryId, { cityId, name: "First", activate: true, idempotencyKey: "district" })).id;
    done = await writer.createTask(countryId, { cityId, districtId, title: "First task", estimate: 1, idempotencyKey: "first-task" });
    const second = await writer.createDistrict(countryId, { cityId, name: "Next", idempotencyKey: "next-district" });
    active = await writer.createTask(countryId, { cityId, districtId: second.id, title: "Next task", estimate: 1, idempotencyKey: "next-task" });
    const neighbour = await writer.createCity(countryId, { name: "Neighbour", idempotencyKey: "neighbour" });
    const otherDistrict = await writer.createDistrict(countryId, { cityId: neighbour.id, name: "Other", activate: true, idempotencyKey: "other-district" });
    foreign = await writer.createTask(countryId, { cityId: neighbour.id, districtId: otherDistrict.id, title: "Other city", estimate: 1, idempotencyKey: "other-task" });
  }, 30_000);
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => { await db?.close(); });

  it("hashes each active-district page once and preserves the previous full and compact wire", async () => {
    const recorded = recordBuilderPages();
    const scene = await new AppService(db).getCityScene(countryId, cityId);
    expect(scene.completedDistrictSnapshots).toEqual([]);
    expect(new Set(scene.chunks.flatMap(chunk => chunk.tasks.map(task => task.id)))).toEqual(new Set([done.id, active.id]));
    expectPreviousWire(scene, recorded.pages);
    expect(recorded.spy).toHaveBeenCalledTimes(scene.chunks.length);
  });

  it("reads one active layout inside the authenticated repeatable-read snapshot", async () => {
    const prepare = db.prepare.bind(db), layoutReads: boolean[] = [];
    vi.spyOn(db, "prepare").mockImplementation(query => {
      if (query.includes("FROM city_layouts_v1 l WHERE city_id=ANY")) layoutReads.push(isTransactionActive());
      return prepare(query);
    });
    const reader = new AppService(db);
    const scene = await reader.getCitySceneForUser(userId, countryId, cityId);
    expect(layoutReads).toEqual([true]);
    expect(reader.runtimeStats().caches.layouts.bypasses).toBe(1);
    expect(new Set(scene.chunks.flatMap(chunk => chunk.tasks.map(task => task.id)))).not.toContain(foreign.id);
    const expectedTasks = await writer.listTasks(countryId, undefined, cityId);
    const rendered = new Map(scene.chunks.flatMap(chunk => chunk.tasks.map(task => [task.id, task] as const)));
    for (const task of expectedTasks) expect(rendered.get(task.id)).toMatchObject({
      footprint: task.footprint, accessPath: task.accessPath, siteBounds: task.siteBounds, stage: task.stage,
    });
    // The committed scene cache stays usable; it must not trigger another
    // layout read or retain an uncommitted process-wide layout entry.
    const readsBeforeHit = layoutReads.length;
    expect(await reader.getCitySceneForUser(userId, countryId, cityId)).toEqual(scene);
    expect(layoutReads).toHaveLength(readsBeforeHit);
    expect(reader.runtimeStats().caches.layouts.entries).toBe(0);
  });

  it("retains mixed completed/active districts, canonical task geometry and completed snapshots", async () => {
    for (const status of ["STARTED", "IN_PROGRESS", "TESTING", "COMPLETED"] as const) {
      await writer.updateTaskStatus(countryId, { taskId: done.id, status, idempotencyKey: `complete-task-${status}` });
    }
    await writer.completeDistrict(countryId, districtId, "complete-district");
    const recorded = recordBuilderPages();
    const prepare = db.prepare.bind(db), layoutReads: boolean[] = [];
    vi.spyOn(db, "prepare").mockImplementation(query => {
      if (query.includes("FROM city_layouts_v1 l WHERE city_id=ANY")) layoutReads.push(isTransactionActive());
      return prepare(query);
    });
    const scene = await new AppService(db).getCitySceneForUser(userId, countryId, cityId);
    expect(layoutReads).toEqual([true]);
    expect(scene.completedDistrictSnapshots).toHaveLength(1);
    const snapshot = scene.completedDistrictSnapshots[0]!;
    expect(snapshot.districtId).toBe(districtId);
    expect(snapshot.tasks.map(task => task.id)).toEqual([done.id]);
    expect(snapshot.revision).toBe(stableHash({ districtId, tasks: snapshot.tasks }));
    expect(new Set(scene.chunks.flatMap(chunk => chunk.tasks.map(task => task.id)))).toEqual(new Set([active.id]));
    expect(scene.chunks.some(chunk => chunk.decorationContext.tasks.some(task => task.id === done.id))).toBe(true);
    expectPreviousWire(scene, recorded.pages);
    expect(recorded.spy).toHaveBeenCalledTimes(scene.chunks.length * 2);
  }, 20_000);

  it("rejects a foreign viewer or country before reading the city's layout", async () => {
    const outsider = await registerUser(db, { email: "scene-layout-outsider@example.test", name: "Other", password: "password123" });
    const prepare = db.prepare.bind(db), layoutReads: string[] = [];
    vi.spyOn(db, "prepare").mockImplementation(query => {
      if (query.includes("FROM city_layouts_v1 l WHERE city_id=ANY")) layoutReads.push(query);
      return prepare(query);
    });
    const reader = new AppService(db);
    await expect(reader.getCitySceneForUser(outsider.user.id, countryId, cityId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(reader.getCitySceneForUser(outsider.user.id, outsider.user.countryId, cityId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(layoutReads).toEqual([]);
  });
});
