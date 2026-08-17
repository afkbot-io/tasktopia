import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { AppService } from "../src/server/app-service";
import { loginUser, registerUser, type AuthUser } from "../src/server/auth";
import { createDb, transaction } from "../src/server/db";
import { auditWorld } from "../src/server/world/world-audit";
import { taskBuildingCompatibleWithArchetype } from "../src/server/world/city-generation";
import { TASK_BUILDING_CATALOG, type BuildingCatalogEntry } from "../src/shared/catalog";
import type { DistrictArchetype, DistrictDto, TaskDto, TaskStatus } from "../src/shared/contracts";

const databaseUrl = process.env.DATABASE_URL
  ?? "postgres://tasktopia:tasktopia@127.0.0.1:55432/tasktopia_test";
const databaseHost = new URL(databaseUrl).hostname;
if (!["127.0.0.1", "localhost", "::1"].includes(databaseHost)) {
  throw new Error("Megacity validation seed is local-only");
}

export const MEGACITY_VALIDATION_LOGIN = {
  email: "megacity-validation@tasktopia.local",
  password: "tasktopia-megacity-validation",
} as const;

const CITY_NAME = "Большой Атлас";
const DISTRICTS: Array<{ name: string; archetype: DistrictArchetype }> = [
  { name: "Северные усадьбы", archetype: "PRIVATE" },
  { name: "Южные кварталы", archetype: "PRIVATE" },
  { name: "Новый центр", archetype: "NEW_BUILD" },
];

const STATUS_PATHS: Record<Exclude<TaskStatus, "PLANNING">, TaskStatus[]> = {
  STARTED: ["STARTED"],
  IN_PROGRESS: ["STARTED", "IN_PROGRESS"],
  TESTING: ["STARTED", "IN_PROGRESS", "TESTING"],
  COMPLETED: ["STARTED", "IN_PROGRESS", "TESTING", "COMPLETED"],
};
const TARGET_STATUSES: TaskStatus[] = ["PLANNING", "STARTED", "IN_PROGRESS", "TESTING", "COMPLETED"];

function uniqueLegalCatalog(): BuildingCatalogEntry[] {
  const chosenServiceRoles = new Set<string>();
  return TASK_BUILDING_CATALOG.filter((entry) => {
    if (!entry.serviceRole) return true;
    if (chosenServiceRoles.has(entry.serviceRole)) return false;
    chosenServiceRoles.add(entry.serviceRole);
    return true;
  });
}

function buildDistrictQueues(): Array<Array<BuildingCatalogEntry | undefined>> {
  const legal = uniqueLegalCatalog();
  const byLargestFootprint = (left: BuildingCatalogEntry, right: BuildingCatalogEntry) =>
    right.footprint.width * right.footprint.height - left.footprint.width * left.footprint.height
    || right.footprint.width - left.footprint.width
    || left.key.localeCompare(right.key);
  const privateHouses = legal
    .filter((entry) => entry.category === "HOUSE" && taskBuildingCompatibleWithArchetype(entry, "PRIVATE"))
    .sort(byLargestFootprint);
  const denseHouses = legal.filter((entry) => entry.category === "HOUSE" && !privateHouses.includes(entry))
    .sort((left, right) => right.footprint.width * right.footprint.height - left.footprint.width * left.footprint.height
      || left.key.localeCompare(right.key));
  const compactHighrises = legal.filter((entry) => entry.category === "HIGHRISE" && !entry.serviceRole)
    .sort((left, right) => left.footprint.width * left.footprint.height - right.footprint.width * right.footprint.height
      || left.key.localeCompare(right.key));
  if (legal.length !== 89 || privateHouses.length !== 36 || denseHouses.length !== 16) {
    throw new Error(`Unexpected task catalog shape: ${JSON.stringify({ legal: legal.length, privateHouses: privateHouses.length, denseHouses: denseHouses.length })}`);
  }

  const queues: Array<Array<BuildingCatalogEntry | undefined>> = [
    privateHouses.slice(0, 18),
    privateHouses.slice(18),
    [...denseHouses, ...compactHighrises.slice(0, 4)],
  ];
  while (queues[2]!.length < 64) queues[2]!.push(undefined);
  if (queues.reduce((sum, queue) => sum + queue.length, 0) !== 100) throw new Error("Megacity task queue must contain exactly 100 items");
  return queues;
}

async function advanceTask(
  service: AppService,
  countryId: string,
  task: TaskDto,
  target: TaskStatus,
  prefix: string,
): Promise<TaskDto> {
  if (target === "PLANNING") return task;
  let current = task;
  const statuses = STATUS_PATHS[target];
  const currentIndex = current.status === "PLANNING" ? -1 : statuses.indexOf(current.status);
  for (const status of statuses.slice(currentIndex + 1)) {
    current = await service.updateTaskStatus(countryId, {
      taskId: current.id,
      status,
      progress: { PLANNING: 0, STARTED: 10, IN_PROGRESS: 55, TESTING: 90, COMPLETED: 100 }[status],
      comment: `Мегаполис: проверочная стадия ${status}.`,
      actor: "Megacity validation agent",
      idempotencyKey: `${prefix}-${status.toLowerCase()}`,
    });
  }
  return current;
}

const db = await createDb(databaseUrl);
const service = new AppService(db);
let user: AuthUser;
try {
  user = (await registerUser(db, {
    email: MEGACITY_VALIDATION_LOGIN.email,
    password: MEGACITY_VALIDATION_LOGIN.password,
    name: "Инспектор мегаполиса",
    countryName: "Республика Атлас",
  })).user;
} catch {
  user = (await loginUser(db, MEGACITY_VALIDATION_LOGIN.email, MEGACITY_VALIDATION_LOGIN.password)).user;
}

await transaction(db, async () => {
  await db.prepare("UPDATE countries SET name = ?, seed = ?, world_version = 1 WHERE id = ?")
    .run("Республика Атлас", 777_001, user.countryId);
  await db.prepare("DELETE FROM world_features_v6 WHERE country_id = ?").run(user.countryId);
  await db.prepare("DELETE FROM roads_v3 WHERE country_id = ?").run(user.countryId);
  await db.prepare("DELETE FROM cities_v3 WHERE country_id = ?").run(user.countryId);
  await db.prepare("DELETE FROM events WHERE country_id = ?").run(user.countryId);
  await db.prepare("DELETE FROM idempotency WHERE country_id = ?").run(user.countryId);
});

const startedAt = performance.now();
const city = await service.createCity(user.countryId, {
  name: CITY_NAME,
  description: "Большой проверочный город: 100 задач, три района и максимальное законное покрытие каталога зданий задач.",
  morphology: "DENSE_CORE",
  idempotencyKey: "megacity-validation-city",
});

const queues = buildDistrictQueues();
const districts: DistrictDto[] = [];
const createValidationDistrict = async (districtIndex: number): Promise<DistrictDto> => {
  const spec = DISTRICTS[districtIndex]!;
  return service.createDistrict(user.countryId, {
    cityId: city.id,
    name: spec.name,
    description: "Район визуальной проверки полного каталога зданий задач.",
    goal: `Проверить геометрию, наклон и стадии зданий архетипа ${spec.archetype}.`,
    archetype: spec.archetype,
    capacitySp: 100,
    activate: false,
    idempotencyKey: `megacity-validation-district-${districtIndex}`,
  });
};

for (let districtIndex = 0; districtIndex < 3; districtIndex += 1) {
  districts.push(await createValidationDistrict(districtIndex));
}
let globalTaskIndex = 0;
const fillValidationDistrict = async (districtIndex: number): Promise<void> => {
  const district = districts[districtIndex]!;
  await service.activateDistrict(user.countryId, district.id, `megacity-validation-activate-${districtIndex}`);
  for (let localIndex = 0; localIndex < queues[districtIndex]!.length; localIndex += 1) {
    const entry = queues[districtIndex]![localIndex];
    // The final ten tasks exercise the task-driven park lifecycle instead of
    // forcing a 60th tower frontage into one already representative centre.
    // All 52 house families and the critical mixed-height rows are present by
    // this point; parks keep the requested 100-task world realistic and bound
    // the validation runtime.
    const validationPark = globalTaskIndex >= 90;
    const prefix = `megacity-validation-task-${globalTaskIndex}`;
    let task = await service.createTask(user.countryId, {
      cityId: city.id,
      districtId: district.id,
      title: entry
        ? `${String(globalTaskIndex + 1).padStart(3, "0")} · ${entry.label}`
        : `${String(globalTaskIndex + 1).padStart(3, "0")} · Новый городской корпус`,
      description: entry
        ? `Визуальная проверка типа ${entry.key}: пропорции, перспектива, вход и все стадии строительства.`
        : "Штатно подобранный городской корпус для проверки плотной застройки и разнообразия фасадов.",
      estimate: ([1, 2, 3, 6] as const)[globalTaskIndex % 4]!,
      buildingHint: validationPark ? "park:urban-central" : entry?.key,
      visualKind: validationPark ? "PARK" : undefined,
      parkVariant: validationPark ? "urban-central" : undefined,
      idempotencyKey: prefix,
    });
    const targetStatus = TARGET_STATUSES[globalTaskIndex % TARGET_STATUSES.length]!;
    task = await advanceTask(service, user.countryId, task, targetStatus, prefix);
    globalTaskIndex += 1;
    console.log(`[${globalTaskIndex}/100] ${DISTRICTS[districtIndex]!.name}: ${task.buildingType} -> stage ${task.stage}`);
  }
};
for (let districtIndex = 0; districtIndex < 3; districtIndex += 1) {
  await fillValidationDistrict(districtIndex);
}

for (let districtIndex = 0; districtIndex < 2; districtIndex += 1) {
  const district = districts[districtIndex]!;
  await service.activateDistrict(user.countryId, district.id, `megacity-validation-finalize-activate-${districtIndex}`);
  const districtTasks = (await service.listTasks(user.countryId)).filter((task) => task.districtId === district.id);
  for (const task of districtTasks) {
    await advanceTask(service, user.countryId, task, "COMPLETED", `megacity-validation-finalize-${task.id}`);
  }
  await service.completeDistrict(user.countryId, district.id, `megacity-validation-complete-${districtIndex}`);
}
await service.activateDistrict(user.countryId, districts[2]!.id, "megacity-validation-reactivate-center");
const repairedBridgeCells = await service.repairDanglingBridges(user.countryId);

const cityTasks = (await service.listTasks(user.countryId)).filter((task) => task.cityId === city.id);
const cityDistricts = await service.listDistricts(user.countryId, city.id);
const audit = await auditWorld(db, service, user.countryId);
const represented = new Set(cityTasks.map((task) => task.buildingType));
const uniqueLegal = uniqueLegalCatalog();
const missingLegal = uniqueLegal.filter((entry) => !represented.has(entry.key)).map((entry) => entry.key);
const excludedAlternatives = TASK_BUILDING_CATALOG.filter((entry) => !represented.has(entry.key)).map((entry) => ({
  key: entry.key,
  serviceRole: entry.serviceRole ?? null,
}));
const categoryCoverage = Object.fromEntries((["HOUSE", "HIGHRISE", "COMMERCIAL", "CIVIC"] as const).map((category) => [category, {
  represented: new Set(cityTasks.filter((task) => TASK_BUILDING_CATALOG.find((entry) => entry.key === task.buildingType)?.category === category).map((task) => task.buildingType)).size,
  catalog: TASK_BUILDING_CATALOG.filter((entry) => entry.category === category).length,
}]));
const missingHouseTypes = TASK_BUILDING_CATALOG.filter((entry) => entry.category === "HOUSE" && !represented.has(entry.key)).map((entry) => entry.key);
const visualRects = cityTasks.filter((task) => task.visualKind === "BUILDING" && task.stage >= 3).map((task) => {
  const entry = TASK_BUILDING_CATALOG.find((candidate) => candidate.key === task.buildingType)!;
  const opaque = entry.stageOpaqueBounds[task.stage - 1]!;
  const groundX = task.origin.x * 8 + entry.footprint.width * 4;
  const groundY = task.origin.y * 8 + entry.footprint.height * 8;
  return {
    taskNumber: task.taskNumber,
    key: task.buildingType,
    left: groundX + opaque.left - entry.anchor.x,
    right: groundX + opaque.right - entry.anchor.x,
    top: groundY + opaque.top - entry.anchor.y,
    bottom: groundY + opaque.bottom - entry.anchor.y,
  };
});
const visualBuildingOverlaps = visualRects.flatMap((left, leftIndex) => visualRects.slice(leftIndex + 1).flatMap((right) => {
  const width = Math.min(left.right, right.right) - Math.max(left.left, right.left);
  const height = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
  return width > 0 && height > 0 ? [{ left: left.taskNumber, leftKey: left.key, right: right.taskNumber, rightKey: right.key, width, height }] : [];
}));
const blockingVisualBuildingOverlaps = visualBuildingOverlaps.filter((overlap) => overlap.height > 32);
const output = {
  generatedAt: new Date().toISOString(),
  generationMs: Math.round(performance.now() - startedAt),
  login: { email: MEGACITY_VALIDATION_LOGIN.email },
  countryId: user.countryId,
  country: "Республика Атлас",
  city: { id: city.id, name: city.name, morphology: city.morphology },
  districts: cityDistricts.map((district) => ({
    id: district.id,
    name: district.name,
    archetype: district.archetype,
    status: district.status,
    tasks: cityTasks.filter((task) => task.districtId === district.id).length,
  })),
  tasks: cityTasks.length,
  taskStages: Object.fromEntries([1, 2, 3, 4, 5].map((stage) => [String(stage), cityTasks.filter((task) => task.stage === stage).length])),
  uniqueBuildingTypes: represented.size,
  maximumLegalUniqueTypes: uniqueLegal.length,
  taskCatalogSize: TASK_BUILDING_CATALOG.length,
  categoryCoverage,
  allHouseTypesCovered: missingHouseTypes.length === 0,
  missingHouseTypes,
  visualBuildingOverlaps,
  blockingVisualBuildingOverlaps,
  missingLegal,
  excludedAlternatives,
  roads: audit.metrics.roads,
  repairedBridgeCells,
  roadClasses: audit.metrics.roadClasses,
  violations: audit.violations,
};

if (cityTasks.length !== 100) throw new Error(`Expected 100 tasks, received ${cityTasks.length}`);
if (missingHouseTypes.length > 0) throw new Error(`House coverage failed: ${JSON.stringify(missingHouseTypes)}`);
if (blockingVisualBuildingOverlaps.length > 0) throw new Error(`Blocking visual building overlap failed:\n${JSON.stringify(blockingVisualBuildingOverlaps, null, 2)}`);
if (audit.violations.length > 0) throw new Error(`World audit failed:\n${JSON.stringify(audit.violations, null, 2)}`);
await mkdir("screenshots/megacity-validation", { recursive: true });
await writeFile("screenshots/megacity-validation/report.json", `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify(output, null, 2));
await db.close();
