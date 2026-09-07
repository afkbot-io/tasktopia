import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { AppService } from "../src/server/app-service";
import { loginUser, registerUser, type AuthUser } from "../src/server/auth";
import { createDb, transaction } from "../src/server/db";
import { seedCompactCity } from "../src/server/fixtures/representative-country";
import { auditWorld } from "../src/server/world/world-audit";
import { TASK_BUILDING_CATALOG } from "../src/shared/catalog";

const databaseUrl = process.env.DATABASE_URL
  ?? "postgres://tasktopia:tasktopia@127.0.0.1:55432/tasktopia_test";
if (!["127.0.0.1", "localhost", "::1"].includes(new URL(databaseUrl).hostname)) {
  throw new Error("Megacity validation seed is local-only");
}
export const MEGACITY_VALIDATION_LOGIN = {
  email: "megacity-validation@tasktopia.local", password: "tasktopia-megacity-validation",
} as const;

const db = await createDb(databaseUrl);
try {
  const service = new AppService(db);
  let user: AuthUser;
  try {
    user = (await registerUser(db, { ...MEGACITY_VALIDATION_LOGIN, name: "Инспектор Атласа", countryName: "Республика Атлас" })).user;
  } catch {
    user = (await loginUser(db, MEGACITY_VALIDATION_LOGIN.email, MEGACITY_VALIDATION_LOGIN.password)).user;
  }
  // Reset only the dedicated fixture country. Spatial rows cascade from cities;
  // compact blocks and road segments are rebuilt solely by AppService.
  await transaction(db, async () => {
    await db.prepare("DELETE FROM cities_v3 WHERE country_id = ?").run(user.countryId);
    await db.prepare("DELETE FROM country_overview_snapshots_v1 WHERE country_id = ?").run(user.countryId);
    await db.prepare("DELETE FROM events WHERE country_id = ?").run(user.countryId);
    await db.prepare("DELETE FROM idempotency WHERE country_id = ?").run(user.countryId);
    await db.prepare("UPDATE countries SET name = ?, seed = ?, world_version = 1 WHERE id = ?")
      .run("Республика Атлас", 987_321, user.countryId);
  });
  const startedAt = performance.now();
  const city = await seedCompactCity(service, user.countryId, {
    key: "megacity", name: "Большой Атлас", morphology: "DENSE_CORE", taskCount: 100, districtCount: 6,
  });
  const cityTasks = (await service.listTasks(user.countryId)).filter((task) => task.cityId === city.id);
  const districts = await service.listDistricts(user.countryId, city.id);
  const audit = await auditWorld(db, service, user.countryId);
  const unsupported = cityTasks.filter((task) => task.visualKind === "BUILDING"
    && !TASK_BUILDING_CATALOG.some((entry) => entry.key === task.buildingType));
  if (cityTasks.length !== 100) throw new Error(`Expected 100 tasks, received ${cityTasks.length}`);
  if (unsupported.length) throw new Error("Fixture contains an unsupported building family.");
  if (audit.violations.length) throw new Error(`World audit failed:\n${JSON.stringify(audit.violations, null, 2)}`);
  const output = {
    generatedAt: new Date().toISOString(), generationMs: Math.round(performance.now() - startedAt),
    login: { email: MEGACITY_VALIDATION_LOGIN.email }, countryId: user.countryId, country: "Республика Атлас",
    city: { id: city.id, name: city.name, morphology: city.morphology },
    districts: districts.map((district) => ({ id: district.id, name: district.name, status: district.status,
      tasks: cityTasks.filter((task) => task.districtId === district.id).length })),
    tasks: cityTasks.length,
    taskStages: Object.fromEntries([1, 2, 3, 4, 5].map((stage) => [String(stage), cityTasks.filter((task) => task.stage === stage).length])),
    taskCatalogSize: TASK_BUILDING_CATALOG.length,
    metrics: audit.metrics, violations: audit.violations,
  };
  await mkdir("screenshots/megacity-validation", { recursive: true });
  await writeFile("screenshots/megacity-validation/report.json", `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(output, null, 2));
} finally {
  await db.close();
}
