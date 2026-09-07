import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";
import { AppService, DomainError } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createDb } from "../src/server/db";
import { auditWorld } from "../src/server/world/world-audit";
import { ASSET_REVISION, getBuilding } from "../src/shared/catalog";
import type { TaskDto, TaskStatus } from "../src/shared/contracts";
import { materializeChunkPayload } from "../src/shared/world-chunk-payload";
import { taskParkDecorLayout } from "../src/shared/task-park";
import { COURTYARD_FURNITURE } from "../src/shared/courtyard-furniture";
import { COURTYARD_ART_CITY, COURTYARD_ART_COUNTRY, COURTYARD_ART_PLAN, COURTYARD_ART_SERVICE_LIMIT, createCourtyardArtWithRetries } from "../tests/fixtures/courtyard-art-plan";

// Explicit opt-in plus a newly generated local schema: no reuse, reset, fallback
// to public, or changes to the preserved traffic/large-scale worlds are allowed.
assert.equal(process.env.SEED_COURTYARD_ART_PREVIEW, "true", "Set SEED_COURTYARD_ART_PREVIEW=true for a new disposable local world");
const databaseUrl = process.env.TEST_DATABASE_URL ?? "postgres://tasktopia:tasktopia@127.0.0.1:5432/tasktopia_test";
const url = new URL(databaseUrl);
assert.ok(["postgres:", "postgresql:"].includes(url.protocol)
  && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  && ["", "5432"].includes(url.port) && url.pathname === "/tasktopia_test"
  && !url.search && !url.hash, "Only the unscoped local tasktopia_test URL is accepted");
for (const example of COURTYARD_ART_PLAN) if (example.family) getBuilding(example.family);
const schema = `courtyard_art_preview_${randomUUID().replaceAll("-", "")}`;
const admin = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
try { await admin.unsafe(`CREATE SCHEMA "${schema}"`); } finally { await admin.end(); }
console.error(`New courtyard art schema: ${schema}`);
const db = await createDb(databaseUrl, { schema, maxConnections: 1 });
const started = performance.now();
try {
  // Each public mutation owns its normal transaction. An outer transaction
  // would keep a rejected explicit placement alive while consuming the next
  // service reservation, defeating the public command's rollback boundary.
  const summary = await (async () => {
    const { user } = await registerUser(db, { email: "demo@tasktopia.local", password: "tasktopia-demo",
      name: "Courtyard art QA", countryName: COURTYARD_ART_COUNTRY });
    // The seed is the sole fixture-owned country update. All placement, role
    // reservation, infrastructure and stages use normal public domain methods.
    await db.prepare("UPDATE countries SET seed=? WHERE id=?").run(424242, user.countryId);
    const service = new AppService(db);
    const city = await service.createCity(user.countryId, { name: COURTYARD_ART_CITY, idempotencyKey: "courtyard-art-city" });
    const districts = new Map<number, string>();
    for (const stage of [3, 4, 5]) {
      const district = await service.createDistrict(user.countryId, { cityId: city.id,
        name: `Дворы · стадия ${stage}`, activate: false, idempotencyKey: `courtyard-art-district-${stage}` });
      districts.set(stage, district.id);
    }
    const statuses: TaskStatus[] = ["PLANNING", "STARTED", "IN_PROGRESS", "TESTING", "COMPLETED"];
    const advance = async (task: TaskDto, target: number) => {
      for (let stage = 2; stage <= target; stage++) task = await service.updateTaskStatus(user.countryId, {
        taskId: task.id, status: statuses[stage - 1]!, idempotencyKey: `courtyard-art-${task.id}-stage-${stage}`,
        comment: "Штатная стадия отдельного локального визуального стенда.", actor: "Courtyard art QA",
      });
      return task;
    };
    const tasks: Array<{ key: string; task: TaskDto }> = [];
    const connectors: TaskDto[] = [];
    let activeStage = 0;
    for (const example of COURTYARD_ART_PLAN) {
      const districtId = districts.get(example.stage)!;
      if (activeStage !== example.stage) {
        await service.activateDistrict(user.countryId, districtId, `courtyard-art-activate-${example.stage}`);
        activeStage = example.stage;
      }
      let task = await createCourtyardArtWithRetries(
        () => service.createTask(user.countryId, { cityId: city.id, districtId, title: example.title,
            description: "Явное опубликованное семейство, геометрия только штатного планировщика.",
            estimate: example.family ? getBuilding(example.family).estimates[0]! : 1,
            ...(example.family ? { visualKind: "BUILDING" as const, buildingHint: example.family }
              : { visualKind: "PARK" as const, parkVariant: example.parkVariant }),
            idempotencyKey: `courtyard-art-${example.key}` }),
        error => error instanceof DomainError && error.code === "INFRASTRUCTURE_RESERVATION_CONFLICT",
        async retry => {
          assert.ok(connectors.length < COURTYARD_ART_SERVICE_LIMIT, "Stop instead of bypassing or endlessly consuming infrastructure reservations");
          const connector = await service.createTask(user.countryId, { cityId: city.id, districtId,
            title: `Штатная инфраструктура ${connectors.length + 1}`, visualKind: "BUILDING", estimate: 1,
            idempotencyKey: `courtyard-art-service-${connectors.length}` });
          assert.ok(connector.serviceRole, "A conflict filler must consume an actual service reservation, not add arbitrary work");
          console.error(JSON.stringify({ event: "courtyard-art.reservation-consumed", case: example.key,
            retry, taskId: connector.id, number: connector.taskNumber, role: connector.serviceRole }));
          connectors.push(await advance(connector, example.stage));
        },
      );
      task = await advance(task, example.stage);
      assert.equal(task.stage, example.stage);
      if (example.family) {
        assert.equal(task.buildingType, example.family);
        const shape = getBuilding(example.family).footprint;
        assert.equal(task.footprint.length, shape.width * shape.height);
        assert.equal(new Set(task.footprint.map(c => c.x)).size, shape.width);
        assert.equal(new Set(task.footprint.map(c => c.y)).size, shape.height);
      } else assert.equal(task.visualAssetKey, example.parkVariant);
      tasks.push({ key: example.key, task });
    }
    const scene = await new AppService(db).getCityScene(user.countryId, city.id);
    const actual = new Map([...scene.chunks.flatMap(c => c.tasks),
      ...scene.completedDistrictSnapshots.flatMap(snapshot => snapshot.tasks)].map(t => [t.id, t]));
    assert.equal(tasks.length, 48);
    assert.equal(actual.size, tasks.length + connectors.length, "No phantom or omitted tasks");
    assert.equal((await service.listTasks(user.countryId)).length, actual.size);
    assert.equal((await service.listDistricts(user.countryId)).length, 3);
    for (const { task } of tasks) assert.deepEqual(actual.get(task.id)?.footprint, task.footprint);
    const decorations = [...new Map(scene.chunks.flatMap(c => materializeChunkPayload(c).decorations).map(p => [p.id, p])).values()];
    const furniture = [
      ...decorations.filter(p => Object.hasOwn(COURTYARD_FURNITURE, p.kind)).map(p => ({ ...p, owner: "frontage" })),
      ...tasks.filter(({ task }) => task.visualKind === "PARK").flatMap(({ task }) =>
        taskParkDecorLayout(task.footprint, task.stage as 3 | 4 | 5, task.visualAssetKey, task.taskNumber)
          .filter(p => Object.hasOwn(COURTYARD_FURNITURE, p.kind)).map(p => ({ ...p, owner: task.id }))),
    ];
    assert.deepEqual([...new Set(furniture.map(p => p.kind))].sort(), Object.keys(COURTYARD_FURNITURE).sort(),
      "The actual finished fixture must provide all three accepted furniture kinds");
    const audit = await auditWorld(db, new AppService(db), user.countryId);
    assert.deepEqual(audit.violations, []);
    return { schema, seed: 424242, assetRevision: ASSET_REVISION, countryId: user.countryId, cityId: city.id,
      sceneRevision: scene.sceneRevision, bounds: scene.city.bounds, taskCount: actual.size, caseCount: tasks.length,
      tasks: tasks.map(({ key, task }) => ({ key, id: task.id, number: task.taskNumber, title: task.title,
        stage: task.stage, family: task.buildingType, visualKind: task.visualKind, variant: task.visualAssetKey,
        role: task.serviceRole ?? null, origin: task.origin, footprint: task.footprint })),
      connectors: connectors.map(task => ({ id: task.id, number: task.taskNumber, role: task.serviceRole,
        family: task.buildingType, stage: task.stage })), furniture, audit };
  })();
  const output = { ...summary, elapsedMs: performance.now() - started, createdAt: new Date().toISOString() };
  await mkdir("tmp", { recursive: true });
  const artifact = join("tmp", `${schema}.json`);
  await writeFile(artifact, `${JSON.stringify(output, null, 2)}\n`);
  console.error(`Fixture evidence: ${artifact}`);
  console.log(JSON.stringify(output, null, 2));
} finally { await db.close(); }
