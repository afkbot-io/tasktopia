import { AppService } from "../src/server/app-service";
import { loginUser, registerUser, type AuthUser } from "../src/server/auth";
import { createDb, transaction } from "../src/server/db";
import { GROWTH_DEMO_SEED, seedGrowthDemo } from "../src/server/fixtures/growth-demo";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://tasktopia:tasktopia@127.0.0.1:55432/tasktopia_test";
const databaseHost = new URL(databaseUrl).hostname;
const isLoopbackDatabase = databaseHost === "127.0.0.1" || databaseHost === "localhost" || databaseHost === "::1";
if (!isLoopbackDatabase && process.env.ALLOW_SHOWCASE_SEED !== "1") {
  throw new Error("README showcase seed is local-only; set ALLOW_SHOWCASE_SEED=1 only for an isolated disposable database");
}
const email = "showcase@tasktopia.local";
const password = "tasktopia-showcase";
const db = await createDb(databaseUrl);
const service = new AppService(db);

let user: AuthUser;
try {
  user = (await registerUser(db, { email, password, name: "Президент Авроры" })).user;
} catch {
  user = (await loginUser(db, email, password)).user;
}

// The README showcase is deliberately rebuildable. It owns only this local
// account and never touches countries created by developers or production.
await transaction(db, async () => {
  await db.prepare("UPDATE users SET name = ? WHERE id = ?").run("Президент Авроры", user.id);
  await db.prepare("UPDATE countries SET name = ?, seed = ?, world_version = 1 WHERE id = ?")
    .run("Республика Аврора", GROWTH_DEMO_SEED, user.countryId);
  await db.prepare("DELETE FROM world_features_v6 WHERE country_id = ?").run(user.countryId);
  await db.prepare("DELETE FROM roads_v3 WHERE country_id = ?").run(user.countryId);
  await db.prepare("DELETE FROM cities_v3 WHERE country_id = ?").run(user.countryId);
  await db.prepare("DELETE FROM events WHERE country_id = ?").run(user.countryId);
  await db.prepare("DELETE FROM idempotency WHERE country_id = ?").run(user.countryId);
});

// Four compact districts keep the complete city readable in a single 16:9
// README frame while still exercising every district archetype and task stage.
const fixture = await seedGrowthDemo(service, user.countryId, 4);
const activeDistrict = fixture.districts.find((district) => district.status === "ACTIVE");
if (!activeDistrict) throw new Error("Showcase fixture did not create an active district");
const activeTasks = fixture.tasks.filter((task) => task.districtId === activeDistrict.id);
const hotfixTask = activeTasks.find((task) => task.status === "IN_PROGRESS");
const burningTask = activeTasks.find((task) => task.status === "TESTING");
const smokeTask = activeTasks.find((task) => task.status === "STARTED");
if (!hotfixTask || !burningTask || !smokeTask) throw new Error("Showcase fixture is missing incident candidates");

await service.updateTaskFields(user.countryId, {
  taskId: hotfixTask.id,
  workItemType: "HOTFIX",
  priority: "CRITICAL",
  actor: "Showcase AI agent",
  idempotencyKey: "readme-showcase-hotfix",
});

async function addDefects(taskId: string, count: number, prefix: string): Promise<void> {
  for (let index = 1; index <= count; index += 1) {
    await service.createTaskDefect(user.countryId, {
      taskId,
      title: `${prefix} ${index}`,
      description: "Демонстрационный дефект для визуализации состояния города.",
      reproductionSteps: "Открыть сценарий и повторить критический пользовательский путь.",
      actualResult: "Сценарий завершается ошибкой.",
      expectedResult: "Сценарий завершается успешно.",
      actor: "Showcase QA agent",
      idempotencyKey: `readme-showcase-${prefix.toLowerCase().replaceAll(" ", "-")}-${index}`,
    });
  }
}

await addDefects(burningTask.id, 6, "Критический дефект");
await addDefects(smokeTask.id, 3, "Наблюдение QA");

console.log(JSON.stringify({
  login: { email, password },
  country: "Республика Аврора",
  city: fixture.city.name,
  districts: fixture.districts.length,
  tasks: fixture.tasks.length,
  incidents: { hotfix: 1, burningBuildingDefects: 6, smokingBuildingDefects: 3 },
}, null, 2));
await db.close();
