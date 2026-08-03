import { performance } from "node:perf_hooks";
import { registerUser } from "../src/server/auth";
import { AppService } from "../src/server/app-service";
import {
  DENSE_DEMO_CITY_COUNT,
  DENSE_DEMO_DISTRICTS_PER_CITY,
  DENSE_DEMO_SEED,
  DENSE_DEMO_TASKS_PER_DISTRICT,
  seedDenseDemo,
} from "../src/server/fixtures/dense-demo";
import { createDb } from "../src/server/db";
import { auditWorld } from "../src/server/world/world-audit";

const databasePath = process.env.REVIEW_DATABASE_PATH ?? ":memory:";
const db = createDb(databasePath);
const registered = await registerUser(db, {
  email: "worldgen-review@tasktopia.local",
  name: "Worldgen Reviewer",
  password: "review-password-123",
});
db.prepare("UPDATE countries SET seed = ? WHERE id = ?").run(DENSE_DEMO_SEED, registered.user.countryId);
const service = new AppService(db);

const generationStartedAt = performance.now();
const fixture = seedDenseDemo(service, registered.user.countryId);
const generationMs = performance.now() - generationStartedAt;
const audit = auditWorld(db, service, registered.user.countryId);

const chunkStartedAt = performance.now();
let chunkCount = 0;
let terrainCells = 0;
for (const city of fixture.cities) {
  const center = service.chunkForCell(city.center);
  for (const [offsetX, offsetY] of [[0, 0], [1, 0], [0, 1], [-1, -1]] as const) {
    const chunk = service.getChunk(registered.user.countryId, center.chunkX + offsetX, center.chunkY + offsetY);
    terrainCells += chunk.terrain.length;
    chunkCount += 1;
  }
}
const chunkMs = performance.now() - chunkStartedAt;

const expectedCities = DENSE_DEMO_CITY_COUNT;
const expectedDistricts = expectedCities * DENSE_DEMO_DISTRICTS_PER_CITY;
const expectedTasks = expectedDistricts * DENSE_DEMO_TASKS_PER_DISTRICT;
if (audit.metrics.cities !== expectedCities) audit.violations.push({ code: "CITY_COUNT", message: `Ожидалось ${expectedCities}, получено ${audit.metrics.cities}` });
if (audit.metrics.districts !== expectedDistricts) audit.violations.push({ code: "DISTRICT_COUNT", message: `Ожидалось ${expectedDistricts}, получено ${audit.metrics.districts}` });
if (audit.metrics.tasks !== expectedTasks) audit.violations.push({ code: "TASK_COUNT", message: `Ожидалось ${expectedTasks}, получено ${audit.metrics.tasks}` });
for (const [city, count] of Object.entries(audit.metrics.districtsPerCity)) if (count !== 3) audit.violations.push({ code: "DISTRICTS_PER_CITY", message: `${city}: ${count} вместо 3` });
for (const [city, count] of Object.entries(audit.metrics.tasksPerCity)) if (count !== 30) audit.violations.push({ code: "TASKS_PER_CITY", message: `${city}: ${count} вместо 30` });
for (const [district, count] of Object.entries(audit.metrics.tasksPerDistrict)) if (count !== 10) audit.violations.push({ code: "TASKS_PER_DISTRICT", message: `${district}: ${count} вместо 10` });
for (const [city, count] of Object.entries(audit.metrics.uniqueBuildingTypesPerCity)) if (count < 10) audit.violations.push({ code: "LOW_BUILDING_DIVERSITY", message: `${city}: только ${count} типов зданий` });
for (const stage of ["1", "2", "3", "4", "5"]) if (!audit.metrics.taskStages[stage]) audit.violations.push({ code: "MISSING_STAGE", message: `Нет задач на стадии ${stage}` });
for (const [city, count] of Object.entries(audit.metrics.roadJunctionsPerCity)) if (count === 0) audit.violations.push({ code: "CITY_WITHOUT_JUNCTION", message: `${city}: нет дорожных развилок` });
if (generationMs > 30_000) audit.violations.push({ code: "GENERATION_BUDGET", message: `Генерация заняла ${Math.round(generationMs)} ms` });
if (chunkMs > 2_000) audit.violations.push({ code: "CHUNK_BUDGET", message: `12 чанков заняли ${Math.round(chunkMs)} ms` });

const memory = process.memoryUsage();
const result = {
  seed: DENSE_DEMO_SEED,
  ...audit.metrics,
  performance: {
    generationMs: Math.round(generationMs),
    chunkMs: Math.round(chunkMs),
    chunkCount,
    terrainCells,
    rssMb: Math.round(memory.rss / 1024 / 1024),
    heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
  },
  violations: audit.violations,
};

console.log(JSON.stringify(result, null, 2));
db.close();
if (audit.violations.length > 0) process.exitCode = 1;

