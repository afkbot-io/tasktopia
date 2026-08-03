import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createDb, type Db } from "../src/server/db";
import {
  METROPOLIS_TASKS,
  REPRESENTATIVE_CITIES,
  REPRESENTATIVE_SEED,
  TASKS_PER_DISTRICT,
  seedRepresentativeCountry,
} from "../src/server/fixtures/representative-country";
import { auditWorld, type WorldAuditResult } from "../src/server/world/world-audit";

describe("representative country fixture", () => {
  let db: Db;
  let service: AppService;
  let countryId: string;
  let audit: WorldAuditResult;

  beforeAll(async () => {
    db = createDb(":memory:");
    const registered = await registerUser(db, {
      email: "representative-test@tasktopia.local",
      name: "Representative Test",
      password: "representative-password-123",
    });
    countryId = registered.user.countryId;
    db.prepare("UPDATE countries SET seed = ? WHERE id = ?").run(REPRESENTATIVE_SEED, countryId);
    service = new AppService(db);
    seedRepresentativeCountry(service, countryId);
    audit = auditWorld(db, service, countryId);
  }, 120_000);

  afterAll(() => db.close());

  it("creates one 200-task metropolis and three smaller cities", () => {
    expect(audit.metrics.cities).toBe(REPRESENTATIVE_CITIES.length);
    expect(audit.metrics.tasksPerCity).toEqual({ Riverside: METROPOLIS_TASKS, Pinegate: 60, Harborview: 50, Stonebridge: 40 });
    expect(audit.metrics.districtsPerCity).toEqual({ Riverside: 20, Pinegate: 6, Harborview: 5, Stonebridge: 4 });
    expect(Object.values(audit.metrics.tasksPerDistrict).every((count) => count === TASKS_PER_DISTRICT)).toBe(true);
  });

  it("keeps exactly one active and one planned district in every city", () => {
    const cities = service.listCities(countryId);
    const districts = service.listDistricts(countryId);
    const tasks = service.listTasks(countryId);
    for (const city of cities) {
      const cityDistricts = districts.filter((district) => district.cityId === city.id);
      expect(cityDistricts.filter((district) => district.status === "ACTIVE")).toHaveLength(1);
      expect(cityDistricts.filter((district) => district.status === "PLANNED")).toHaveLength(1);
      expect(cityDistricts.filter((district) => district.status === "COMPLETED")).toHaveLength(cityDistricts.length - 2);
      for (const district of cityDistricts) {
        const districtTasks = tasks.filter((task) => task.districtId === district.id);
        if (district.status === "PLANNED") expect(districtTasks.every((task) => task.status === "PLANNING")).toBe(true);
        if (district.status === "COMPLETED") expect(districtTasks.every((task) => task.status === "COMPLETED")).toBe(true);
      }
    }
  });

  it("passes spatial, road, access, service and zoning invariants", () => {
    expect(audit.violations).toEqual([]);
    expect(audit.metrics.zoningCompliance).toBe(1);
    expect(audit.metrics.maximumEntranceAccessLength).toBeLessThanOrEqual(6);
    expect(audit.metrics.crosswalkCells).toBeGreaterThan(0);
    expect(audit.metrics.bridges).toBeGreaterThan(0);
    expect(Object.values(audit.metrics.roadJunctionsPerCity).every((count) => count > 0)).toBe(true);
    expect(Object.values(audit.metrics.greenAreasPerCity).every((count) => count > 0)).toBe(true);
    expect(Object.values(audit.metrics.serviceRolesPerCity).every((roles) =>
      ["police-service", "fire-service", "health-service"].every((role) => roles.includes(role)),
    )).toBe(true);
  });
});
