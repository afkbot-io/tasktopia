import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createTestDb } from "../src/server/db";
import { auditWorld } from "../src/server/world/world-audit";
import { BUILDING_CATALOG } from "../src/shared/catalog";

// Seed scanner for the V10 worldgen tuning: replays the reported incident
// workload (29 identical 1-SP tasks into a NEW_BUILD district) across many
// country seeds and reports density, building variety, city services and
// green-area counts. Run: npx tsx scripts/scan-seeds.ts [count]
const runs = Number(process.argv[2] ?? 12);

interface Report {
  seed: number;
  violations: string[];
  fillRate: number;
  lots: number;
  distinctTypes: number;
  services: string[];
  districtGreen: number;
  types: Record<string, number>;
}

for (let index = 0; index < runs; index += 1) {
  const db = await createTestDb();
  try {
    const registered = await registerUser(db, {
      email: `scan-${index}@tasktopia.local`,
      name: "Scan",
      password: "scan-password",
    });
    const countryId = registered.user.countryId;
    const seed = 100_003 + index * 77_711;
    await db.prepare("UPDATE countries SET seed = ? WHERE id = ?").run(seed, countryId);
    const service = new AppService(db);
    const city = await service.createCity(countryId, { name: "Scantown", idempotencyKey: "city" });
    const district = await service.createDistrict(countryId, {
      cityId: city.id,
      name: "Спальный",
      archetype: "NEW_BUILD",
      capacitySp: 32,
      activate: true,
      idempotencyKey: "district",
    });
    for (let taskIndex = 0; taskIndex < 29; taskIndex += 1) {
      await service.createTask(countryId, {
        cityId: city.id,
        districtId: district.id,
        title: `Однотипная задача ${taskIndex + 1}`,
        estimate: 1,
        idempotencyKey: `task-${taskIndex}`,
      });
    }
    const audit = await auditWorld(db, service, countryId);
    const grown = (await service.listDistricts(countryId)).find((item) => item.id === district.id)!;
    const tasks = await service.listTasks(countryId);
    const types: Record<string, number> = {};
    for (const task of tasks) types[task.buildingType] = (types[task.buildingType] ?? 0) + 1;
    const services = [...new Set(tasks
      .map((task) => BUILDING_CATALOG.find((entry) => entry.key === task.buildingType)?.serviceRole)
      .filter((role): role is string => Boolean(role)))];
    const green = (await service.listWorldFeatures(countryId))
      .filter((feature) => feature.districtId === district.id && (feature.kind === "PARK" || feature.kind === "GROVE"));
    const report: Report = {
      seed,
      violations: audit.violations.map((violation) => violation.code),
      fillRate: grown.lots.length === 0 ? 1 : grown.lots.filter((lot) => lot.taskId).length / grown.lots.length,
      lots: grown.lots.length,
      distinctTypes: Object.keys(types).length,
      services,
      districtGreen: green.length,
      types,
    };
    console.log(JSON.stringify(report));
  } finally {
    await db.close();
  }
}
