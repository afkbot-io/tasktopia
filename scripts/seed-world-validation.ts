import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { AppService } from "../src/server/app-service";
import { loginUser, registerUser, type AuthUser } from "../src/server/auth";
import { createDb, transaction } from "../src/server/db";
import { auditWorld } from "../src/server/world/world-audit";
import { TASK_BUILDING_CATALOG } from "../src/shared/catalog";
import type { CityMorphology, DistrictDto, TaskDto, TaskStatus } from "../src/shared/contracts";

const databaseUrl = process.env.DATABASE_URL
  ?? "postgres://tasktopia:tasktopia@127.0.0.1:55432/tasktopia_test";
const databaseHost = new URL(databaseUrl).hostname;
if (!["127.0.0.1", "localhost", "::1"].includes(databaseHost)) {
  throw new Error("World validation seed is local-only");
}

export const WORLD_VALIDATION_LOGIN = {
  email: "world-validation@tasktopia.local",
  password: "tasktopia-world-validation",
} as const;

const CITY_SPECS: Array<{ name: string; morphology: CityMorphology; seedOffset: number }> = [
  { name: "Янтарный Берег", morphology: "BALANCED", seedOffset: 11 },
  { name: "Северные Ворота", morphology: "DENSE_CORE", seedOffset: 23 },
  { name: "Озероград", morphology: "GARDEN_CITY", seedOffset: 37 },
  { name: "Каменный Мост", morphology: "POLYCENTRIC", seedOffset: 41 },
  { name: "Лазурная Долина", morphology: "GARDEN_CITY", seedOffset: 53 },
  { name: "Новый Горизонт", morphology: "DENSE_CORE", seedOffset: 67 },
  { name: "Речной Порт", morphology: "BALANCED", seedOffset: 79 },
  { name: "Зелёный Квартал", morphology: "GARDEN_CITY", seedOffset: 83 },
  { name: "Стальные Башни", morphology: "POLYCENTRIC", seedOffset: 97 },
  { name: "Город Будущего", morphology: "DENSE_CORE", seedOffset: 109 },
];

const BUILDING_KEYS = TASK_BUILDING_CATALOG
  .filter((entry) => !entry.maxPerCity && !entry.maxPerDistrict && entry.ruleIds.every((rule) => rule === "STANDARD"))
  .map((entry) => entry.key);
const COMPACT_BUILDING_KEYS = TASK_BUILDING_CATALOG
  .filter((entry) => !entry.maxPerCity && !entry.maxPerDistrict && entry.ruleIds.every((rule) => rule === "STANDARD")
    && entry.footprint.width <= 14 && entry.footprint.height <= 12)
  .map((entry) => entry.key);

const STATUS_PATHS: Record<Exclude<TaskStatus, "PLANNING">, TaskStatus[]> = {
  STARTED: ["STARTED"],
  IN_PROGRESS: ["STARTED", "IN_PROGRESS"],
  TESTING: ["STARTED", "IN_PROGRESS", "TESTING"],
  COMPLETED: ["STARTED", "IN_PROGRESS", "TESTING", "COMPLETED"],
};

type CityValidationReport = {
  index: number;
  id: string;
  name: string;
  morphology: CityMorphology;
  districts: number;
  tasks: number;
  taskStages: Record<string, number>;
  uniqueBuildingTypes: number;
  roads: number;
  roadClasses: Record<string, number>;
  generationMs: number;
  violations: Array<{ code: string; message: string }>;
};

async function advanceTask(service: AppService, countryId: string, task: TaskDto, target: TaskStatus, prefix: string): Promise<TaskDto> {
  if (target === "PLANNING") return task;
  let current = task;
  for (const status of STATUS_PATHS[target]) {
    current = await service.updateTaskStatus(countryId, {
      taskId: current.id,
      status,
      progress: { PLANNING: 0, STARTED: 8, IN_PROGRESS: 56, TESTING: 91, COMPLETED: 100 }[status],
      comment: `Проверочный сценарий: стадия ${status}.`,
      actor: "World validation agent",
      idempotencyKey: `${prefix}-${status.toLowerCase()}`,
    });
  }
  return current;
}

async function addDistrict(input: {
  service: AppService;
  countryId: string;
  cityId: string;
  cityIndex: number;
  districtIndex: number;
  taskCount: number;
  targets: TaskStatus[];
  activate: boolean;
  complete: boolean;
  district?: DistrictDto;
  buildingKeys?: string[];
}): Promise<{ district: DistrictDto; tasks: TaskDto[] }> {
  const prefix = `world-validation-${input.cityIndex}-${input.districtIndex}`;
  let district = input.district ?? await input.service.createDistrict(input.countryId, {
    cityId: input.cityId,
    name: input.cityIndex === 9
      ? ["Завершённый центр", "Завершённая набережная", "Строящийся квартал", "Район будущего"][input.districtIndex]!
      : `Квартал ${input.districtIndex + 1}`,
    description: "Проверочный район новой плотной застройки.",
    goal: "Проверить дороги шириной 2–3 клетки, плитку и разные стадии новостроек.",
    archetype: "NEW_BUILD",
    capacitySp: 32,
    activate: input.activate,
    idempotencyKey: `${prefix}-district`,
  });
  if (input.activate && district.status === "PLANNED") {
    district = await input.service.activateDistrict(input.countryId, district.id, `${prefix}-activate`);
  }
  const tasks: TaskDto[] = [];
  for (let taskIndex = 0; taskIndex < input.taskCount; taskIndex += 1) {
    const buildingKeys = input.buildingKeys ?? BUILDING_KEYS;
    const catalogIndex = (input.cityIndex * 11 + input.districtIndex * 7 + taskIndex) % buildingKeys.length;
    const target = input.targets[taskIndex % input.targets.length]!;
    let task = await input.service.createTask(input.countryId, {
      cityId: input.cityId,
      districtId: district.id,
      title: `Новостройка ${input.cityIndex + 1}.${input.districtIndex + 1}.${taskIndex + 1}`,
      description: "Жилой комплекс проверочного города: авторская V5-графика и каменная площадь под зданием.",
      estimate: ([1, 2, 3, 6] as const)[(input.cityIndex + input.districtIndex + taskIndex) % 4]!,
      buildingHint: buildingKeys[catalogIndex]!,
      idempotencyKey: `${prefix}-task-${taskIndex}`,
    });
    task = await advanceTask(input.service, input.countryId, task, target, `${prefix}-task-${taskIndex}`);
    tasks.push(task);
  }
  if (input.complete) await input.service.completeDistrict(input.countryId, district.id, `${prefix}-complete`);
  return { district, tasks };
}

const db = await createDb(databaseUrl);
const service = new AppService(db);
let user: AuthUser;
try {
  user = (await registerUser(db, {
    email: WORLD_VALIDATION_LOGIN.email,
    password: WORLD_VALIDATION_LOGIN.password,
    name: "Инспектор городов",
    countryName: "Федерация Новостроек",
  })).user;
} catch {
  user = (await loginUser(db, WORLD_VALIDATION_LOGIN.email, WORLD_VALIDATION_LOGIN.password)).user;
}

await transaction(db, async () => {
  await db.prepare("UPDATE countries SET name = ?, seed = ?, world_version = 1 WHERE id = ?")
    .run("Федерация Новостроек", 915_731, user.countryId);
  await db.prepare("DELETE FROM world_features_v6 WHERE country_id = ?").run(user.countryId);
  await db.prepare("DELETE FROM roads_v3 WHERE country_id = ?").run(user.countryId);
  await db.prepare("DELETE FROM cities_v3 WHERE country_id = ?").run(user.countryId);
  await db.prepare("DELETE FROM events WHERE country_id = ?").run(user.countryId);
  await db.prepare("DELETE FROM idempotency WHERE country_id = ?").run(user.countryId);
});

const reports: CityValidationReport[] = [];
for (let cityIndex = 0; cityIndex < CITY_SPECS.length; cityIndex += 1) {
  const spec = CITY_SPECS[cityIndex]!;
  const startedAt = performance.now();
  const city = await service.createCity(user.countryId, {
    name: spec.name,
    description: `Проверочный город №${cityIndex + 1}: только новостройки, морфология ${spec.morphology}.`,
    morphology: spec.morphology,
    idempotencyKey: `world-validation-city-${cityIndex}-${spec.seedOffset}`,
  });

  if (cityIndex === 9) {
    // Reserve the full urban plan before any district grows. Trying to place
    // the planned fourth district after three six-building districts have
    // annexed land does not represent how the product is used and needlessly
    // turns a planning-only district into an intercity search problem.
    const reserved: DistrictDto[] = [];
    for (let districtIndex = 0; districtIndex < 4; districtIndex += 1) {
      reserved.push((await addDistrict({
        service, countryId: user.countryId, cityId: city.id, cityIndex, districtIndex,
        taskCount: 0, targets: ["PLANNING"], activate: false, complete: false,
      })).district);
    }
    await addDistrict({ service, countryId: user.countryId, cityId: city.id, cityIndex, districtIndex: 0, taskCount: 4, targets: ["COMPLETED"], activate: true, complete: true, district: reserved[0], buildingKeys: COMPACT_BUILDING_KEYS });
    await addDistrict({ service, countryId: user.countryId, cityId: city.id, cityIndex, districtIndex: 1, taskCount: 4, targets: ["COMPLETED"], activate: true, complete: true, district: reserved[1], buildingKeys: COMPACT_BUILDING_KEYS });
    await addDistrict({ service, countryId: user.countryId, cityId: city.id, cityIndex, districtIndex: 2, taskCount: 4, targets: ["COMPLETED", "IN_PROGRESS"], activate: true, complete: false, district: reserved[2], buildingKeys: COMPACT_BUILDING_KEYS });
    await addDistrict({ service, countryId: user.countryId, cityId: city.id, cityIndex, districtIndex: 3, taskCount: 4, targets: ["PLANNING"], activate: false, complete: false, district: reserved[3], buildingKeys: COMPACT_BUILDING_KEYS });
  } else {
    const progressiveTargets: TaskStatus[][] = [
      ["PLANNING", "STARTED", "IN_PROGRESS", "TESTING"],
      ["STARTED", "IN_PROGRESS", "TESTING", "COMPLETED"],
      ["IN_PROGRESS", "TESTING", "COMPLETED", "STARTED"],
    ];
    await addDistrict({
      service,
      countryId: user.countryId,
      cityId: city.id,
      cityIndex,
      districtIndex: 0,
      taskCount: 4,
      targets: progressiveTargets[cityIndex % progressiveTargets.length]!,
      activate: true,
      complete: false,
    });
    await addDistrict({
      service,
      countryId: user.countryId,
      cityId: city.id,
      cityIndex,
      districtIndex: 1,
      taskCount: 4,
      targets: ["PLANNING"],
      activate: false,
      complete: false,
    });
  }

  const cityTasks = (await service.listTasks(user.countryId)).filter((task) => task.cityId === city.id);
  const cityDistricts = await service.listDistricts(user.countryId, city.id);
  const unexpectedBuildings = cityTasks.filter((task) => !TASK_BUILDING_CATALOG.some((entry) => entry.key === task.buildingType));
  const wrongPlatforms = cityTasks.filter((task) => task.platformType !== "STONE");
  if (unexpectedBuildings.length > 0) throw new Error(`${spec.name}: non-new-build task building detected`);
  if (wrongPlatforms.length > 0) throw new Error(`${spec.name}: task without STONE platform detected`);
  if (cityDistricts.some((district) => district.archetype !== "NEW_BUILD")) throw new Error(`${spec.name}: non-new-build district detected`);

  const audit = await auditWorld(db, service, user.countryId);
  if (audit.violations.length > 0) {
    throw new Error(`${spec.name}: world audit failed\n${JSON.stringify(audit.violations, null, 2)}`);
  }
  const taskStages = Object.fromEntries([1, 2, 3, 4, 5].map((stage) => [String(stage), cityTasks.filter((task) => task.stage === stage).length]));
  reports.push({
    index: cityIndex + 1,
    id: city.id,
    name: city.name,
    morphology: city.morphology,
    districts: cityDistricts.length,
    tasks: cityTasks.length,
    taskStages,
    uniqueBuildingTypes: new Set(cityTasks.map((task) => task.buildingType)).size,
    roads: audit.metrics.roads,
    roadClasses: audit.metrics.roadClasses,
    generationMs: Math.round(performance.now() - startedAt),
    violations: audit.violations,
  });
  console.log(`[${cityIndex + 1}/${CITY_SPECS.length}] ${spec.name}: ${cityDistricts.length} districts, ${cityTasks.length} tasks, audit clean`);
}

const finalCity = reports.at(-1)!;
const finalDistricts = await service.listDistricts(user.countryId, finalCity.id);
const finalTasks = (await service.listTasks(user.countryId)).filter((task) => task.cityId === finalCity.id);
const finalShape = finalDistricts.map((district) => ({
  name: district.name,
  status: district.status,
  tasks: finalTasks.filter((task) => task.districtId === district.id).reduce<Record<string, number>>((counts, task) => {
    counts[task.status] = (counts[task.status] ?? 0) + 1;
    return counts;
  }, {}),
}));
if (finalShape.filter((district) => district.status === "COMPLETED").length !== 2
  || finalShape.filter((district) => district.status === "ACTIVE").length !== 1
  || finalShape.filter((district) => district.status === "PLANNED").length !== 1) {
  throw new Error(`Final city district contract failed: ${JSON.stringify(finalShape)}`);
}

const output = {
  generatedAt: new Date().toISOString(),
  login: { email: WORLD_VALIDATION_LOGIN.email },
  countryId: user.countryId,
  country: "Федерация Новостроек",
  newBuildCatalogSize: TASK_BUILDING_CATALOG.length,
  cities: reports,
  finalCity: { ...finalCity, districts: finalShape },
};
await mkdir("screenshots/world-validation", { recursive: true });
await writeFile("screenshots/world-validation/report.json", `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify(output, null, 2));
await db.close();
