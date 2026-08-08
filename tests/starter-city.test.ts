import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";

describe("Starter city (TEMPLATE kind)", () => {
  let db: Db;
  let service: AppService;
  let countryId: string;

  beforeEach(async () => {
    db = await createTestDb();
    service = new AppService(db);
    countryId = (await registerUser(db, { email: "test@example.com", name: "Tester", password: "password123" })).user.countryId;
  });

  afterEach(async () => await db.close());

  it("creates a TEMPLATE city with generated world geometry like a WORK city", async () => {
    const city = await service.createCity(countryId, { name: "Стартовый город", kind: "TEMPLATE", idempotencyKey: "template-city" });
    expect(city.kind).toBe("TEMPLATE");
    expect(city.bounds.maxX - city.bounds.minX + 1).toBe(100);

    const roads = await db.prepare("SELECT x, y FROM roads_v3 WHERE country_id = ? AND x BETWEEN ? AND ? AND y BETWEEN ? AND ?")
      .all(countryId, city.bounds.minX, city.bounds.maxX, city.bounds.minY, city.bounds.maxY) as Array<{ x: number; y: number }>;
    expect(roads.length).toBeGreaterThan(0);

    const landmark = await db.prepare("SELECT * FROM world_features_v6 WHERE country_id = ? AND city_id = ? AND kind = 'LANDMARK'")
      .get(countryId, city.id) as { id: string; asset_key: string; origin_x: number; origin_y: number } | undefined;
    expect(landmark).toBeDefined();
    expect(landmark?.asset_key).toBe("highrise-landmark");
    expect(Math.abs(landmark!.origin_x - city.center.x)).toBeLessThanOrEqual(7);
    expect(Math.abs(landmark!.origin_y - city.center.y)).toBeLessThanOrEqual(7);
  });

  it("rejects creating more than one TEMPLATE city per country", async () => {
    await service.createCity(countryId, { name: "Стартовый город", kind: "TEMPLATE", idempotencyKey: "template-city-1" });
    await expect(service.createCity(countryId, { name: "Второй стартовый", kind: "TEMPLATE", idempotencyKey: "template-city-2" }))
      .rejects.toThrowError(/стартовый город/);
  });

  it("rejects districts and tasks in a TEMPLATE city", async () => {
    const city = await service.createCity(countryId, { name: "Стартовый город", kind: "TEMPLATE", idempotencyKey: "template-city" });
    await expect(service.createDistrict(countryId, { cityId: city.id, name: "Район", idempotencyKey: "template-district" }))
      .rejects.toThrowError(/старто/);
    await expect(service.createTask(countryId, { cityId: city.id, title: "Задача", estimate: 1, idempotencyKey: "template-task" }))
      .rejects.toThrowError(/старто/);
  });

  it("CRUDs reference cards inside a TEMPLATE city", async () => {
    const city = await service.createCity(countryId, { name: "Стартовый город", kind: "TEMPLATE", idempotencyKey: "template-city" });

    const created = await service.createReferenceCard(countryId, { cityId: city.id, kind: "CONTEXT", title: "Архитектура эпика Atuta", body: "## Контекст\n\nPWA + Django", tags: ["arch", "atuta"], idempotencyKey: "ref-create" });
    expect(created.kind).toBe("CONTEXT");
    expect(created.title).toBe("Архитектура эпика Atuta");

    const listed = await service.listReferenceCards(countryId, city.id);
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(created.id);

    const updated = await service.updateReferenceCard(countryId, { cardId: created.id, title: "Архитектура эпика Atuta (v2)", body: "Обновлённый контекст", idempotencyKey: "ref-update" });
    expect(updated.title).toBe("Архитектура эпика Atuta (v2)");

    await service.deleteReferenceCard(countryId, { cardId: created.id, confirmTitle: updated.title, idempotencyKey: "ref-delete" });
    expect(await service.listReferenceCards(countryId, city.id)).toHaveLength(0);
  });

  it("seeds a new TEMPLATE city with default reference cards", async () => {
    const city = await service.createCity(countryId, { name: "Стартовый город", kind: "TEMPLATE", idempotencyKey: "template-seed" });
    const cards = await service.listReferenceCards(countryId, city.id);
    expect(cards.length).toBeGreaterThanOrEqual(8);
    const kinds = new Set(cards.map((card) => card.kind));
    expect(kinds).toContain("CONTEXT");
    expect(kinds).toContain("TEMPLATE");
    expect(kinds).toContain("CONVENTION");
    expect(cards.some((card) => card.kind === "CONTEXT" && card.title.toLowerCase().includes("архитектура"))).toBe(true);
    expect(cards.some((card) => card.kind === "CONVENTION" && card.title.toLowerCase().includes("definition of done"))).toBe(true);
  });

  it("rejects reference cards in a WORK city", async () => {
    const city = await service.createCity(countryId, { name: "Рабочий город", kind: "WORK", idempotencyKey: "work-city" });
    await expect(service.createReferenceCard(countryId, { cityId: city.id, kind: "TEMPLATE", title: "Bad", body: "", idempotencyKey: "ref-bad" }))
      .rejects.toThrowError(/старто/);
  });
});
