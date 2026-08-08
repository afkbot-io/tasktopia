import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";

describe("Государственный архив", () => {
  let db: Db;
  let service: AppService;
  let countryId: string;

  beforeEach(async () => {
    db = await createTestDb();
    service = new AppService(db);
    countryId = (await registerUser(db, {
      email: "archive@example.com", name: "Archivist", password: "password123",
    })).user.countryId;
  });

  afterEach(async () => await db.close());

  it("автоматически создаёт один архив страны, не создавая город", async () => {
    const archive = await service.getArchive(countryId);

    expect(archive).toMatchObject({ countryId, name: "Государственный архив", stage: 1, recordCount: 0 });
    expect(await service.listCities(countryId)).toHaveLength(0);
    expect(await db.prepare("SELECT COUNT(*)::int AS count FROM country_archives_v1 WHERE country_id = ?").get(countryId))
      .toMatchObject({ count: 1 });
  });

  it("публикует отдельный архивный комплекс возле первого рабочего города", async () => {
    const city = await service.createCity(countryId, { name: "Рабочий город", idempotencyKey: "archive-city" });
    const features = await db.prepare(`SELECT city_id, kind, asset_kind, asset_key FROM world_features_v6
      WHERE country_id = ? AND kind = 'COUNTRY_ARCHIVE' ORDER BY asset_kind, asset_key`).all<{
        city_id: string | null; kind: string; asset_kind: string; asset_key: string;
      }>(countryId);

    expect(city).not.toHaveProperty("kind");
    expect(features.some((feature) => feature.asset_kind === "AREA" && feature.asset_key === "state-archive-complex")).toBe(true);
    expect(features.filter((feature) => feature.asset_kind === "BUILDING").map((feature) => feature.asset_key))
      .toEqual(["state-archive-core"]);
    expect(features.every((feature) => feature.city_id === null)).toBe(true);
  });

  it("добавляет уникальные здания только на порогах роста архива", async () => {
    await service.createCity(countryId, { name: "Архивоград", idempotencyKey: "archive-growth-city" });
    for (let index = 1; index <= 10; index += 1) {
      await service.createArchiveRecord(countryId, {
        kind: index % 2 ? "CONVENTION" : "ARCHITECTURE",
        title: `Запись ${index}`,
        body: `Короткий контекст ${index}`,
        idempotencyKey: `archive-record-${index}`,
      });
      const expectedStage = index < 3 ? 1 : index < 6 ? 2 : index < 10 ? 3 : 4;
      expect((await service.getArchive(countryId)).stage).toBe(expectedStage);
    }

    const buildings = await db.prepare(`SELECT asset_key FROM world_features_v6
      WHERE country_id = ? AND kind = 'COUNTRY_ARCHIVE' AND asset_kind = 'BUILDING' ORDER BY asset_key`).all<{ asset_key: string }>(countryId);
    expect(buildings.map((row) => row.asset_key)).toEqual([
      "state-archive-core", "state-archive-tower", "state-archive-vault", "state-archive-wing",
    ]);
    expect(buildings.some((row) => row.asset_key.includes("operations") || row.asset_key.includes("hq"))).toBe(false);
  });

  it("сохраняет и обновляет jsonb-теги и ссылку записи", async () => {
    const created = await service.createArchiveRecord(countryId, {
      kind: "REPOSITORY", title: "Основной репозиторий", body: "Backend и frontend",
      sourceUrl: "https://github.com/example/tasktopia", tags: ["git", "main"], idempotencyKey: "archive-create",
    });
    expect(created).toMatchObject({ kind: "REPOSITORY", tags: ["git", "main"], sourceUrl: "https://github.com/example/tasktopia" });

    const updated = await service.updateArchiveRecord(countryId, {
      recordId: created.id, body: "Monorepo", tags: ["monorepo"], idempotencyKey: "archive-update",
    });
    expect(updated).toMatchObject({ body: "Monorepo", tags: ["monorepo"] });
    expect(await service.listArchiveRecords(countryId)).toEqual([updated]);
  });

  it("удаляет запись по точному названию и уменьшает стадию комплекса", async () => {
    await service.createCity(countryId, { name: "Город", idempotencyKey: "archive-delete-city" });
    const records = [];
    for (let index = 1; index <= 3; index += 1) {
      records.push(await service.createArchiveRecord(countryId, {
        kind: "PROJECT", title: `Документ ${index}`, idempotencyKey: `archive-delete-${index}`,
      }));
    }
    expect((await service.getArchive(countryId)).stage).toBe(2);

    await service.deleteArchiveRecord(countryId, {
      recordId: records[2]!.id, confirmTitle: records[2]!.title, idempotencyKey: "archive-delete-confirm",
    });
    expect((await service.getArchive(countryId)).stage).toBe(1);
    const buildings = await db.prepare(`SELECT asset_key FROM world_features_v6
      WHERE country_id = ? AND kind = 'COUNTRY_ARCHIVE' AND asset_kind = 'BUILDING'`).all<{ asset_key: string }>(countryId);
    expect(buildings.map((row) => row.asset_key)).toEqual(["state-archive-core"]);
  });
});
