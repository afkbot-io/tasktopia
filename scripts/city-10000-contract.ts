/** Local benchmark contract; no application or database work at import time. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { CitySceneDto } from "../src/shared/city-scene-contract";

export const CITY_10000_TASKS = 10_000;
export const CITY_10000_SCENE_BYTES = 48 * 1024 * 1024;
export const CITY_10000_PROFILES = {
  desktop: { viewport: { width: 1440, height: 1000 }, dpr: 1, touch: false, cpu: 1, network: false },
  tall: { viewport: { width: 1600, height: 2800 }, dpr: 1, touch: false, cpu: 1, network: false },
  mobile: { viewport: { width: 393, height: 851 }, dpr: 2.75, touch: true, cpu: 4, network: true },
} as const;
export type City10000Profile = keyof typeof CITY_10000_PROFILES;
export type City10000Target = { id: string; taskNumber: number; title: string; origin: { x: number; y: number } };
export type City10000Prepared = {
  schemaVersion: 1; status: "ROWS_PREPARED_NOT_GEOMETRY"; tasks: 10000; seed: 424242;
  userId: string; countryId: string; cityId: string; districtId: string; email: string;
  sourceRevision: string; sourceHashes: Record<string, string>; createdAt: string;
};
export type City10000Fixture = Omit<City10000Prepared, "status"> & {
  status: "REAL_GEOMETRY_READY"; geometryHash: string; chunks: number; chunkLimit: number;
  bounds: CitySceneDto["city"]["bounds"]; statusCounts: Record<string, number>; auditViolations: 0;
  rawSceneBytes: number; gzipSceneBytes: number; buildOrFinalizeWallMs: number; farTarget: City10000Target;
  legacyRawSceneBytes: number; legacyGzipSceneBytes: number; compactAccept: string;
  existingGeometryReused: boolean; nativeEvidence?: { readbackSha256: string; resultSha256: string;
    layoutChecksum: string; historicalCompilerMs: number; generationSourceHashes: Record<string, string> };
  phaseMs: { compiler: number; authenticatedScene: number; audit: number }; targets: City10000Target[]; builtAt: string;
};

export function city10000Size(value: unknown): 10000 {
  assert.equal(Number(value), CITY_10000_TASKS, "Use exactly 10000 tasks in one city");
  return CITY_10000_TASKS;
}
export function city10000Database(value: string): URL {
  const url = new URL(value);
  assert.equal(url.protocol, "postgres:", "PostgreSQL required");
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "Loopback database only");
  assert.match(url.pathname, /^\/city_10000_\d{8}_test$/, "Dedicated city-10000 database required");
  assert.equal(url.search, ""); assert.equal(url.hash, "");
  return url;
}
export function city10000FixtureRows(userId: string) {
  return Array.from({ length: 9999 }, (_, i) => {
    const n = i + 2, text = createHash("sha256").update(`tasktopia-city-10000:${n}`).digest("hex").slice(0, 32);
    const id = `${text.slice(0, 8)}-${text.slice(8, 12)}-5${text.slice(13, 16)}-8${text.slice(17, 20)}-${text.slice(20)}`;
    const status = n <= 8000 ? "COMPLETED" : n <= 9500 ? "IN_PROGRESS" : "PLANNING";
    return { id, task_number: 0, title: `Нагрузка ${n}`, description: `Локальная задача ${n}.`, status,
      progress: status === "COMPLETED" ? 100 : status === "IN_PROGRESS" ? 50 : 0,
      assignee_user_id: n % 3 === 0 ? userId : null,
      service_role_assigned: false, service_role: null, service_trigger: null };
  });
}
export function city10000Budgets(profile: City10000Profile) {
  const mobile = profile === "mobile";
  return { coldCityMs: mobile ? 30_000 : 5_000, warmCityMs: mobile ? 750 : 500,
    inputP95Ms: mobile ? 200 : 100, frameP95Ms: mobile ? 34 : 20, livingCpuP95Ms: 8,
    cardMs: mobile ? 2_000 : 1_000, retainedHeapBytes: 8 * 1024 * 1024,
    residentHeapTargetBytes: 256 * 1024 * 1024, rawSceneBytes: CITY_10000_SCENE_BYTES };
}
export function city10000Tasks(scene: CitySceneDto) {
  return [...new Map([...scene.chunks.flatMap(chunk => chunk.tasks),
    ...scene.completedDistrictSnapshots.flatMap(snapshot => snapshot.tasks)].map(task => [task.id, task])).values()]
    .sort((a, b) => a.taskNumber - b.taskNumber);
}
export function city10000GeometryHash(scene: CitySceneDto): string {
  return createHash("sha256").update(JSON.stringify({ city: scene.city, roads: scene.roadContext,
    tasks: city10000Tasks(scene).map(task => ({ id: task.id, stage: task.stage, buildingType: task.buildingType,
      origin: task.origin, footprint: task.footprint, accessPath: task.accessPath })),
    chunks: scene.chunks.map(chunk => ({ x: chunk.chunkX, y: chunk.chunkY, roads: chunk.roadRuns,
      surfaces: chunk.surfaceRuns, districts: chunk.districts })) })).digest("hex");
}
export function assertCity10000Scene(scene: CitySceneDto, cityId: string, chunkLimit: number): void {
  assert.equal(scene.city.id, cityId);
  assert.ok(Number.isInteger(chunkLimit) && chunkLimit > 256, "Explicit finite expanded chunk policy required");
  assert.ok(scene.chunks.length > 256 && scene.chunks.length <= chunkLimit, "Real scene must exceed the old 256-chunk limit");
  assert.equal(new Set(scene.chunks.map(chunk => `${chunk.chunkX}:${chunk.chunkY}`)).size, scene.chunks.length);
  const tasks = city10000Tasks(scene); assert.equal(tasks.length, CITY_10000_TASKS);
  assert.deepEqual(tasks.map(task => task.taskNumber), Array.from({ length: CITY_10000_TASKS }, (_, n) => n + 1));
  assert.equal(new Set(tasks.map(task => task.districtId)).size, 1, "One active district workload required");
}
export function city10000Metric(values: readonly number[], minimum: number) {
  assert.ok(values.length >= minimum, "Missing measurement window or samples");
  assert.ok(values.every(value => Number.isFinite(value) && value >= 0), "Finite nonnegative measurements required");
  const ordered = [...values].sort((a, b) => a - b);
  return { count: ordered.length, p50: ordered[Math.ceil(ordered.length * .5) - 1]!,
    p95: ordered.length >= 20 ? ordered[Math.ceil(ordered.length * .95) - 1]! : null, max: ordered.at(-1)! };
}
