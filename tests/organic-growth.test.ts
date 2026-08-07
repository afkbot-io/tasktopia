import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";
import { auditWorld, type WorldAuditResult } from "../src/server/world/world-audit";

// Regression for the reported incident: a NEW_BUILD district received 29
// identical 1-SP tasks and regeneration produced a sparse half-empty area —
// five full blocks planned upfront, 52% of lots vacant, orphaned footpaths
// around empty pads. V10 grows complexes on demand, so the same workload must
// stay dense before and after a regeneration replay.
describe("organic growth incident regression", () => {
  let db: Db;
  let service: AppService;
  let countryId: string;
  let districtId: string;
  let auditBefore: WorldAuditResult;
  let auditAfter: WorldAuditResult;
  let fillBefore: { total: number; occupied: number; rate: number };
  let fillAfter: { total: number; occupied: number; rate: number };

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
    await service.regenerateCountry(countryId, { confirmName: "Organic: страна", idempotencyKey: "regenerate" });
    auditAfter = await auditWorld(db, service, countryId);
    fillAfter = await fillRate();
  }, 120_000);

  afterAll(async () => await db.close());

  it("packs 29 identical tasks into a dense district without audit violations", () => {
    expect(auditBefore.metrics.tasks).toBe(29);
    expect(auditBefore.violations).toEqual([]);
    expect(fillBefore.occupied).toBe(29);
    expect(fillBefore.rate).toBeGreaterThanOrEqual(0.8);
  });

  it("replays the same density after regeneration", () => {
    expect(auditAfter.metrics.tasks).toBe(29);
    expect(auditAfter.violations).toEqual([]);
    expect(fillAfter.occupied).toBe(29);
    expect(fillAfter.rate).toBeGreaterThanOrEqual(0.8);
  });
});
