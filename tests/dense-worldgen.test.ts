import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";
import type { DistrictArchetype } from "../src/shared/contracts";
import { auditWorld, type WorldAuditResult } from "../src/server/world/world-audit";

describe("one-city world generation gate", () => {
  let db: Db;
  let audit: WorldAuditResult;

  beforeAll(async () => {
    db = await createTestDb();
    const registered = await registerUser(db, {
      email: "small-world@tasktopia.local",
      name: "Small World",
      password: "small-world-password",
    });
    await db.prepare("UPDATE countries SET seed = ? WHERE id = ?").run(424_242, registered.user.countryId);
    const service = new AppService(db);
    const city = await service.createCity(registered.user.countryId, { name: "Riverside", idempotencyKey: "city" });
    const archetypes: DistrictArchetype[] = ["NEW_BUILD", "PRIVATE", "MIXED_URBAN", "COMMERCIAL", "CIVIC"];
    for (let districtIndex = 0; districtIndex < 10; districtIndex += 1) {
      const archetype = archetypes[districtIndex % archetypes.length]!;
      const district = await service.createDistrict(registered.user.countryId, {
                                cityId: city.id,
                                name: `Район ${districtIndex + 1}`,
                                archetype,
                                capacitySp: 26,
                                activate: districtIndex === 0,
                                idempotencyKey: `district-${districtIndex}`,
                              });
      for (let taskIndex = 0; taskIndex < 2; taskIndex += 1) {
        await service.createTask(registered.user.countryId, {
                                                  cityId: city.id,
                                                  districtId: district.id,
                                                  title: `Задача ${districtIndex + 1}.${taskIndex + 1}`,
                                                  estimate: archetype === "PRIVATE" ? 1 : 2,
                                                  idempotencyKey: `task-${districtIndex}-${taskIndex}`,
                                                });
      }
    }
    audit = await auditWorld(db, service, registered.user.countryId);
  // Coverage instrumentation and parallel database suites can roughly double
  // the bounded 1-city/10-district fixture time on CI runners.
  }, 60_000);

  afterAll(async () => await db.close());

  it("keeps the default fixture bounded to one city and ten districts", () => {
    expect(audit.metrics.cities).toBe(1);
    expect(audit.metrics.districts).toBe(10);
    expect(audit.metrics.tasks).toBe(20);
    expect(Object.values(audit.metrics.tasksPerDistrict)).toEqual(Array.from({ length: 10 }, () => 2));
  });

  it("passes spatial, access, zoning and asphalt invariants", () => {
    expect(audit.violations).toEqual([]);
    expect(audit.metrics.zoningCompliance).toBe(1);
    expect(audit.metrics.maximumEntranceAccessLength).toBeLessThanOrEqual(6);
    expect(audit.metrics.maximumResidentialAsphaltShare).toBeLessThanOrEqual(0.2);
    expect(audit.metrics.surfaceCells).toBeGreaterThan(0);
    expect(audit.metrics.roadJunctionsPerCity.Riverside).toBeGreaterThan(0);
  });
});
