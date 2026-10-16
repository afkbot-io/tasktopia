/** Read-only local service/SQL evidence. Run against the matching immutable
 * source directory; no fixture seeding, status writes or geometry regeneration. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { AppService } from "../src/server/app-service";
import { createDb, type Db, type Row } from "../src/server/db";
import { cityScaleDatabase, distribution, type CityScaleFixture } from "./city-scale-benchmark-contract";

assert.ok(process.env.CITY_SCALE_FIXTURE && process.env.CITY_SCALE_DATABASE_FILE);
const fixture = JSON.parse(await readFile(process.env.CITY_SCALE_FIXTURE, "utf8")) as CityScaleFixture;
const url = cityScaleDatabase((await readFile(process.env.CITY_SCALE_DATABASE_FILE, "utf8")).trim(), fixture.tasks);
const output = process.env.CITY_SCALE_SERVER_OUTPUT ?? `.builder/world-perf-20261016/server-${fixture.tasks}.json`;
const repetitions = Number(process.env.CITY_SCALE_SERVER_SAMPLES ?? 20);
assert.ok(Number.isInteger(repetitions) && repetitions >= 1 && repetitions <= 50);
const db = await createDb(url.toString(), { migrate: false });
let traces: { hash: string; kind: string; ms: number }[] = [];
const measured: Db = {
  prepare(query) {
    const statement = db.prepare(query);
    const run = async <T>(operation: () => Promise<T>) => {
      const start = performance.now();
      try { return await operation(); }
      finally { traces.push({ hash: createHash("sha256").update(query).digest("hex"), kind: query.trim().split(/\s/, 1)[0]!, ms: performance.now() - start }); }
    };
    return { all: <T extends Row>(...params: unknown[]) => run(() => statement.all<T>(...params)),
      get: <T extends Row>(...params: unknown[]) => run(() => statement.get<T>(...params)),
      run: (...params: unknown[]) => run(() => statement.run(...params)) };
  },
  exec: query => db.exec(query), transaction: callback => db.transaction(callback), close: async () => undefined,
};
try {
  assert.equal((await db.prepare("SELECT count(*)::int AS count FROM tasks_v3").get<{ count: number }>())?.count, fixture.tasks);
  const service = new AppService(measured);
  const samples: { kind: string; totalMs: number; queries: number; sqlMs: number; queryDurations: typeof traces; rawBytes: number; gzipBytes: number }[] = [];
  for (let index = 0; index <= repetitions; index++) {
    traces = []; const started = performance.now();
    const scene = await service.getCityScene(fixture.countryId, fixture.cityId);
    const totalMs = performance.now() - started;
    const ids = new Set([...scene.chunks.flatMap(chunk => chunk.tasks), ...scene.completedDistrictSnapshots.flatMap(snapshot => snapshot.tasks)].map(task => task.id));
    assert.equal(ids.size, fixture.tasks);
    const wire = JSON.stringify(scene);
    samples.push({ kind: index === 0 ? "process-cold" : "warm", totalMs, queries: traces.length,
      sqlMs: traces.reduce((sum, query) => sum + query.ms, 0), queryDurations: traces,
      rawBytes: Buffer.byteLength(wire), gzipBytes: gzipSync(wire).length });
  }
  const report = { fixture, sourceRevision: process.env.CITY_SCALE_SOURCE_REVISION ?? "unrecorded",
    fingerprints: Object.fromEntries(await Promise.all(["src/server/app-service.ts", "src/server/task-detail-read.ts", "src/server/db.ts"]
      .map(async path => [path, createHash("sha256").update(await readFile(path)).digest("hex")]))),
    samples, warm: { timeMs: distribution(samples.slice(1).map(sample => sample.totalMs)),
      queries: distribution(samples.slice(1).map(sample => sample.queries)), sqlMs: distribution(samples.slice(1).map(sample => sample.sqlMs)) },
    limits: "Local read service; SQL round-trip durations include client overhead; first read has cold process caches but PostgreSQL/OS cache need not be cold. No concurrent throughput/load claim.",
    generatedAt: new Date().toISOString() };
  await mkdir(output.substring(0, output.lastIndexOf("/")) || ".", { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ tasks: fixture.tasks, cold: samples[0], warm: report.warm }));
} finally { await db.close(); }
