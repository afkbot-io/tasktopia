import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { AppService, DomainError } from "../src/server/app-service";
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
  ...Array.from({ length: 10 }, (_, index) => ({ name: `Малоэтажный квартал ${index + 1}`, archetype: "PRIVATE" as const })),
  ...Array.from({ length: 10 }, (_, index) => ({ name: `Средне-высотный квартал ${index + 1}`, archetype: "NEW_BUILD" as const })),
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
  const lowRise = legal
    .filter((entry) => entry.tags.includes("low-rise-residential") && taskBuildingCompatibleWithArchetype(entry, "PRIVATE"))
    .sort(byLargestFootprint);
  const midRise = legal
    .filter((entry) => entry.tags.includes("mid-rise-residential") && !entry.serviceRole)
    .sort(byLargestFootprint);
  const highRises = legal.filter((entry) => entry.category === "HIGHRISE" && !entry.serviceRole)
    .sort((left, right) => right.spriteSize.height - left.spriteSize.height
      || right.footprint.width * right.footprint.height - left.footprint.width * left.footprint.height
      || left.key.localeCompare(right.key));
  if (legal.length !== 63 || lowRise.length !== 10 || midRise.length !== 16 || highRises.length !== 32) {
    throw new Error(`Unexpected task catalog shape: ${JSON.stringify({ legal: legal.length, lowRise: lowRise.length, midRise: midRise.length, highRises: highRises.length })}`);
  }
  const compactMidRise = [...midRise].sort((left, right) =>
    left.footprint.width * left.footprint.height - right.footprint.width * right.footprint.height
    || left.key.localeCompare(right.key));

  const privateQueues: Array<Array<BuildingCatalogEntry | undefined>> = Array.from({ length: 10 }, () => []);
  lowRise.forEach((entry, index) => privateQueues[index % privateQueues.length]!.push(entry));
  const denseQueues: Array<Array<BuildingCatalogEntry | undefined>> = Array.from({ length: 10 }, () => []);
  const appendToShortestQueue = (entry: BuildingCatalogEntry) => {
    const shortestQueue = denseQueues.reduce((shortest, queue) => queue.length < shortest.length ? queue : shortest);
    shortestQueue.push(entry);
  };
  // Place the tallest screen-space reservations first while each base
  // district is still empty. Compact mid-rises then fill the remaining slots;
  // otherwise a 256px tower can arrive behind two blocks and exhaust several
  // continuation districts despite being valid on a fresh frontage.
  highRises.forEach(appendToShortestQueue);
  compactMidRise.forEach(appendToShortestQueue);
  const queues = [...privateQueues, ...denseQueues];
  for (const queue of queues) while (queue.length < 5) queue.push(undefined);
  (["health-service", "fire-service", "police-service"] as const).forEach((serviceRole, index) => {
    const serviceEntry = legal.find((entry) => entry.serviceRole === serviceRole);
    if (!serviceEntry) throw new Error(`Missing required ${serviceRole} building`);
    queues[index]![queues[index]!.length - 1] = serviceEntry;
  });
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
  description: "Большой проверочный город: 100 задач, двадцать базовых компактных кварталов с автоматическими продолжениями и полное покрытие мало-/среднеэтажного каталога.",
  morphology: "DENSE_CORE",
  idempotencyKey: "megacity-validation-city",
});

const queues = buildDistrictQueues();
const districts: DistrictDto[] = [];
const createValidationDistrict = async (districtIndex: number, continuation = 0): Promise<DistrictDto> => {
  const spec = DISTRICTS[districtIndex]!;
  return service.createDistrict(user.countryId, {
    cityId: city.id,
    name: continuation === 0 ? spec.name : `${spec.name} · продолжение ${continuation}`,
    description: "Район визуальной проверки полного каталога зданий задач.",
    goal: `Проверить геометрию, наклон и стадии зданий архетипа ${spec.archetype}.`,
    archetype: spec.archetype,
    capacitySp: 100,
    activate: false,
    idempotencyKey: `megacity-validation-district-${districtIndex}-${continuation}`,
  });
};

let globalTaskIndex = 0;
const finalizeValidationDistrict = async (district: DistrictDto): Promise<void> => {
  const districtTasks = (await service.listTasks(user.countryId)).filter((task) => task.districtId === district.id);
  for (const task of districtTasks) {
    await advanceTask(service, user.countryId, task, "COMPLETED", `megacity-validation-finalize-${task.id}`);
  }
  await service.completeDistrict(user.countryId, district.id, `megacity-validation-complete-${district.id}`);
};

const fillValidationDistrict = async (districtIndex: number, initialDistrict: DistrictDto): Promise<DistrictDto> => {
  let district = initialDistrict;
  let continuation = 0;
  await service.activateDistrict(user.countryId, district.id, `megacity-validation-activate-${districtIndex}`);
  for (let localIndex = 0; localIndex < queues[districtIndex]!.length; localIndex += 1) {
    const entry = queues[districtIndex]![localIndex];
    // Every explicit queue slot is one unique active HOUSE family. Remaining
    // tasks exercise the task-driven park lifecycle instead of filling the
    // validation city with duplicate facades; this keeps the requested
    // 100-task world realistic and bounds the geometry gate runtime.
    const validationPark = !entry;
    const prefix = `megacity-validation-task-${globalTaskIndex}`;
    const createTask = () => service.createTask(user.countryId, {
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
        visualKind: validationPark ? "PARK" as const : "BUILDING" as const,
        parkVariant: validationPark ? "urban-central" : undefined,
        idempotencyKey: prefix,
      });
    let task: TaskDto | undefined;
    while (!task) {
      try {
        task = await createTask();
      } catch (error) {
        if (!(error instanceof DomainError) || error.code !== "PLACEMENT_BLOCKED" || continuation >= 8) throw error;
        await finalizeValidationDistrict(district);
        continuation += 1;
        district = await createValidationDistrict(districtIndex, continuation);
        districts.push(district);
        await service.activateDistrict(user.countryId, district.id, `megacity-validation-activate-${districtIndex}-${continuation}`);
      }
    }
    const targetStatus = TARGET_STATUSES[globalTaskIndex % TARGET_STATUSES.length]!;
    task = await advanceTask(service, user.countryId, task, targetStatus, prefix);
    globalTaskIndex += 1;
    console.log(`[${globalTaskIndex}/100] ${DISTRICTS[districtIndex]!.name}: ${task.buildingType} -> stage ${task.stage}`);
  }
  return district;
};
// Build the height-sensitive half first, before planned low-rise territories
// can box in the road network. Districts are created just in time instead of
// reserving all twenty territories up front; compact low-rise blocks remain
// easy to place after the tower skyline is established.
const districtFillOrder = [
  ...Array.from({ length: 10 }, (_, index) => index + 10),
  ...Array.from({ length: 10 }, (_, index) => index),
];
for (const [fillIndex, districtIndex] of districtFillOrder.entries()) {
  const initialDistrict = await createValidationDistrict(districtIndex);
  districts.push(initialDistrict);
  const finalDistrict = await fillValidationDistrict(districtIndex, initialDistrict);
  if (fillIndex < districtFillOrder.length - 1) {
    await finalizeValidationDistrict(finalDistrict);
  }
}
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
const missingResidentialTypes = TASK_BUILDING_CATALOG.filter((entry) => (
  !entry.serviceRole
  && entry.tags.some((tag) => ["low-rise-residential", "mid-rise-residential", "high-rise-residential"].includes(tag))
  && !represented.has(entry.key)
)).map((entry) => entry.key);
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
  allResidentialTypesCovered: missingResidentialTypes.length === 0,
  missingResidentialTypes,
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
if (missingResidentialTypes.length > 0) throw new Error(`Residential coverage failed: ${JSON.stringify(missingResidentialTypes)}`);
if (blockingVisualBuildingOverlaps.length > 0) throw new Error(`Blocking visual building overlap failed:\n${JSON.stringify(blockingVisualBuildingOverlaps, null, 2)}`);
if (audit.violations.length > 0) throw new Error(`World audit failed:\n${JSON.stringify(audit.violations, null, 2)}`);
await mkdir("screenshots/megacity-validation", { recursive: true });
await writeFile("screenshots/megacity-validation/report.json", `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify(output, null, 2));
await db.close();
