import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";
import { auditWorld, type WorldAuditResult } from "../src/server/world/world-audit";
import { BUILDING_CATALOG, TASK_BUILDING_CATALOG } from "../src/shared/catalog";
import { greenAreaTarget } from "../src/server/green-area-planner";

// Regression for the reported incident: a NEW_BUILD district received 29
// identical 1-SP tasks and regeneration produced a sparse half-empty area —
// five full blocks planned upfront, 52% of lots vacant, orphaned footpaths
// around empty pads. V10 grows complexes on demand, so the same workload must
// stay dense before and after a regeneration replay.
describe.runIf(process.env.RUN_ORGANIC_GROWTH_TESTS === "1")("organic growth incident regression", () => {
  let db: Db;
  let service: AppService;
  let countryId: string;
  let districtId: string;
  let auditBefore: WorldAuditResult;
  let auditAfter: WorldAuditResult;
  let fillBefore: { total: number; occupied: number; rate: number };
  let fillAfter: { total: number; occupied: number; rate: number };
  let typesBefore: Map<string, string>;
  let typesAfter: Map<string, string>;
  let serviceRolesAfter: string[];
  let districtGreenBefore: number;
  let districtGreenAfter: number;
  let regeneratedSeed: number;

  const fillRate = async () => {
    const district = (await service.listDistricts(countryId)).find((item) => item.id === districtId)!;
    const total = district.lots.length;
    const occupied = district.lots.filter((lot) => lot.taskId).length;
    return { total, occupied, rate: total === 0 ? 0 : occupied / total };
  };

  beforeAll(async () => {
    db = await createTestDb();
    const registered = await registerUser(db, {
      email: "organic-growth@tasktopia.local",
      name: "Organic",
      password: "organic-growth-password",
    });
    countryId = registered.user.countryId;
    await db.prepare("UPDATE countries SET seed = ? WHERE id = ?").run(777_001, countryId);
    service = new AppService(db);
    const city = await service.createCity(countryId, { name: "Monotown", idempotencyKey: "city" });
    const district = await service.createDistrict(countryId, {
      cityId: city.id,
      name: "Спальный",
      archetype: "NEW_BUILD",
      capacitySp: 32,
      activate: true,
      idempotencyKey: "district",
    });
    districtId = district.id;
    for (let index = 0; index < 29; index += 1) {
      await service.createTask(countryId, {
        cityId: city.id,
        districtId,
        title: `Однотипная задача ${index + 1}`,
        estimate: 1,
        idempotencyKey: `task-${index}`,
      });
    }
    auditBefore = await auditWorld(db, service, countryId);
    fillBefore = await fillRate();
    typesBefore = new Map((await service.listTasks(countryId)).map((task) => [task.id, task.buildingType]));
    districtGreenBefore = (await service.listWorldFeatures(countryId))
      .filter((feature) => feature.districtId === districtId && (feature.kind === "PARK" || feature.kind === "GROVE")).length;
    regeneratedSeed = (await service.regenerateCountry(countryId, { confirmName: "Organic: страна", idempotencyKey: "regenerate" })).seed;
    auditAfter = await auditWorld(db, service, countryId);
    fillAfter = await fillRate();
    const tasksAfter = await service.listTasks(countryId);
    typesAfter = new Map(tasksAfter.map((task) => [task.id, task.buildingType]));
    serviceRolesAfter = [...new Set(tasksAfter
      .map((task) => BUILDING_CATALOG.find((entry) => entry.key === task.buildingType)?.serviceRole)
      .filter((role): role is string => Boolean(role)))];
    districtGreenAfter = (await service.listWorldFeatures(countryId))
      .filter((feature) => feature.districtId === districtId && (feature.kind === "PARK" || feature.kind === "GROVE")).length;
  }, 600_000);

  afterAll(async () => await db.close());

  it("packs 29 identical tasks into a dense district without audit violations", () => {
    expect(auditBefore.metrics.tasks).toBe(29);
    expect(auditBefore.violations).toEqual([]);
    expect(fillBefore.occupied).toBe(29);
    expect(fillBefore.rate).toBeGreaterThanOrEqual(0.8);
  });

  it("replays the same density after regeneration", () => {
    expect(regeneratedSeed).toBe(1_206_325_679);
    expect(auditAfter.metrics.tasks).toBe(29);
    expect(auditAfter.violations).toEqual([]);
    expect(fillAfter.occupied).toBe(29);
    // Regeneration rolls a fresh random seed each run, so the exact lot count
    // varies (a 12-seed scan lands between 0.8 and 1.0). The guard rails the
    // incident itself: no more sparse half-empty districts (that one was 0.48).
    expect(fillAfter.rate).toBeGreaterThanOrEqual(0.75);
  });

  it("varies building types instead of cloning one model for identical tasks", () => {
    // The incident district was 28 × house-small-apartments. The seeded,
    // repeat-penalised picker must spread identical tasks across the dense
    // residential family — a real residential complex reads as related but
    // different buildings.
    expect(new Set(typesBefore.values()).size).toBeGreaterThanOrEqual(5);
    expect(new Set(typesAfter.values()).size).toBeGreaterThanOrEqual(5);
  });

  it("re-picks buildings under the new seed instead of preserving the old set", () => {
    // Regeneration used to freeze the old building_type while re-siting the
    // task. Under a new seed the replay must genuinely re-pick: with 29 tasks
    // at least some assignments change.
    const changed = [...typesAfter].filter(([taskId, type]) => typesBefore.get(taskId) !== type);
    expect(changed.length).toBeGreaterThan(0);
  });

  it("keeps building_type consistent with the regenerated footprint", async () => {
    // The re-picked model and the copied geometry must describe the same
    // building, otherwise the map renders a sprite that does not match its pad.
    const tasks = await service.listTasks(countryId);
    for (const task of tasks) {
      const entry = BUILDING_CATALOG.find((item) => item.key === task.buildingType);
      expect(entry, `catalog entry for ${task.buildingType}`).toBeDefined();
      const xs = task.footprint.map((cell) => cell.x);
      const ys = task.footprint.map((cell) => cell.y);
      expect(Math.max(...xs) - Math.min(...xs) + 1).toBe(entry!.footprint.width);
      expect(Math.max(...ys) - Math.min(...ys) + 1).toBe(entry!.footprint.height);
    }
  });

  it("places the reviewed emergency-service facades on schedule", () => {
    expect(serviceRolesAfter.sort()).toEqual(["fire-service", "health-service"]);
    expect([...typesAfter.values()].every((key) =>
      TASK_BUILDING_CATALOG.some((entry) => entry.key === key))).toBe(true);
  });

  it("publishes the workload-driven green-area cadence before and after regeneration", () => {
    expect(districtGreenBefore).toBe(greenAreaTarget(29));
    expect(districtGreenAfter).toBe(greenAreaTarget(29));
  });
});
