import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createDb, type Db } from "../src/server/db";
import {
  DENSE_DEMO_CITY_COUNT,
  DENSE_DEMO_DISTRICTS_PER_CITY,
  DENSE_DEMO_SEED,
  DENSE_DEMO_TASKS_PER_DISTRICT,
  seedDenseDemo,
} from "../src/server/fixtures/dense-demo";
import { auditWorld, type WorldAuditResult } from "../src/server/world/world-audit";

describe("dense 30-task city fixture", () => {
  let db: Db;
  let audit: WorldAuditResult;

  beforeAll(async () => {
    db = createDb(":memory:");
    const registered = await registerUser(db, {
      email: "dense-test@tasktopia.local",
      name: "Dense Test",
      password: "dense-password-123",
    });
    db.prepare("UPDATE countries SET seed = ? WHERE id = ?").run(DENSE_DEMO_SEED, registered.user.countryId);
    const service = new AppService(db);
    seedDenseDemo(service, registered.user.countryId);
    audit = auditWorld(db, service, registered.user.countryId);
  }, 15_000);

  afterAll(() => db.close());

  it("creates three cities with three districts and thirty tasks each", () => {
    expect(audit.metrics.cities).toBe(DENSE_DEMO_CITY_COUNT);
    expect(audit.metrics.districts).toBe(DENSE_DEMO_CITY_COUNT * DENSE_DEMO_DISTRICTS_PER_CITY);
    expect(audit.metrics.tasks).toBe(DENSE_DEMO_CITY_COUNT * DENSE_DEMO_DISTRICTS_PER_CITY * DENSE_DEMO_TASKS_PER_DISTRICT);
    expect(Object.values(audit.metrics.districtsPerCity)).toEqual([3, 3, 3]);
    expect(Object.values(audit.metrics.tasksPerCity)).toEqual([30, 30, 30]);
    expect(Object.values(audit.metrics.tasksPerDistrict)).toEqual(Array.from({ length: 9 }, () => 10));
    for (const city of audit.metrics.tasksPerCity ? Object.keys(audit.metrics.tasksPerCity) : []) {
      expect(city.length).toBeGreaterThan(0);
    }
  });

  it("keeps roads, districts and task footprints spatially valid", () => {
    expect(audit.violations).toEqual([]);
    expect(audit.metrics.maximumTaskRoadDistance).toBeLessThanOrEqual(8);
    expect(audit.metrics.maximumEntranceAccessLength).toBeLessThanOrEqual(6);
    expect(audit.metrics.surfaceCells).toBeGreaterThan(0);
    expect(audit.metrics.worldFeatures).toBeGreaterThanOrEqual(DENSE_DEMO_CITY_COUNT * 2);
    expect(Object.values(audit.metrics.serviceRolesPerCity).every((roles) =>
      ["police-service", "fire-service", "health-service"].every((role) => roles.includes(role)),
    )).toBe(true);
    expect(audit.metrics.bridges).toBeGreaterThan(0);
    expect(Object.values(audit.metrics.roadJunctionsPerCity).every((count) => count > 0)).toBe(true);
  });

  it("creates accessible green spaces with grid-aligned urban furniture", () => {
    expect(audit.metrics.greenAreas).toBeGreaterThanOrEqual(DENSE_DEMO_CITY_COUNT);
    expect(audit.metrics.parkDecor).toBeGreaterThanOrEqual(audit.metrics.greenAreas * 5);
    expect(Object.values(audit.metrics.greenAreasPerCity).every((count) => count >= 1)).toBe(true);
  });

  it("produces varied buildings and a valid completed/active/planned lifecycle", () => {
    expect(audit.metrics.uniqueBuildingTypes).toBeGreaterThanOrEqual(20);
    expect(Object.values(audit.metrics.uniqueBuildingTypesPerCity).every((count) => count >= 10)).toBe(true);
    expect(Object.values(audit.metrics.taskStages)).toEqual([36, 6, 6, 6, 36]);
    expect(audit.metrics.zoningCompliance).toBe(1);
  });
});
