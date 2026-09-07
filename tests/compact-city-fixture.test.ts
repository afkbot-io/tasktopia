import { afterEach, describe, expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";
import { REPRESENTATIVE_SEED, seedDevelopmentCountry } from "../src/server/fixtures/representative-country";
import { readActiveBlockLayout } from "../src/server/world/active-block-layout";
import { auditWorld } from "../src/server/world/world-audit";
import { getBuilding } from "../src/shared/catalog";

describe("compact city development fixture", () => {
  let db: Db;
  afterEach(async () => await db?.close());

  it("uses real service placement for 40 tasks, three districts and every stage", async () => {
    db = await createTestDb();
    const service = new AppService(db);
    const { countryId } = (await registerUser(db, {
      email: "compact-fixture@test.local", name: "Fixture", password: "password123",
    })).user;
    await db.prepare("UPDATE countries SET seed = ? WHERE id = ?").run(REPRESENTATIVE_SEED, countryId);
    const fixture = await seedDevelopmentCountry(service, countryId);
    expect(fixture.cities).toHaveLength(1);
    expect(fixture.districts).toHaveLength(3);
    expect(fixture.tasks).toHaveLength(40);
    expect(fixture.tasks.filter((task) => task.visualKind === "PARK").length).toBeGreaterThanOrEqual(3);
    for (const district of fixture.districts) expect(fixture.tasks.filter(t => t.districtId === district.id).sort((a,b) => a.taskNumber-b.taskNumber)[1]!.visualKind).toBe("PARK");
    expect(new Set(fixture.tasks.map((task) => task.stage))).toEqual(new Set([1, 2, 3, 4, 5]));
    expect(new Set(fixture.districts.map((district) => district.status))).toEqual(new Set(["ACTIVE", "COMPLETED", "PLANNED"]));
    for (const task of fixture.tasks.filter((item) => item.visualKind === "BUILDING")) {
      const shape = getBuilding(task.buildingType).footprint;
      expect(shape).toBeDefined();
      expect(task.footprint).toHaveLength(shape.width * shape.height);
    }
    const firstTask = await service.getTask(countryId, fixture.tasks.find((task) => task.taskNumber === 1)!.id);
    expect(firstTask.status).toBe("IN_PROGRESS");
    expect(firstTask.checklist?.map((item) => item.done)).toEqual([true, true, false]);
    const layout = await readActiveBlockLayout(db, fixture.cities[0]!.id);
    expect(layout?.blocks.length).toBeGreaterThanOrEqual(3);
    expect(layout?.roadNetwork.segments.length).toBeGreaterThan(0);
    expect((await auditWorld(db, service, countryId)).violations).toEqual([]);
  }, 60_000);
});
