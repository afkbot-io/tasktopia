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
    await db.prepare("UPDATE countries SET seed = ? WHERE id = ?").run(424_242, countryId);
  }, 30_000);

  afterEach(async () => await db.close());

  it("автоматически создаёт один архив страны, не создавая город", async () => {
    const archive = await service.getArchive(countryId);

    expect(archive).toMatchObject({ countryId, name: "Государственный архив", stage: 1, recordCount: 0 });
    expect(await service.listCities(countryId)).toHaveLength(0);
    expect(await db.prepare("SELECT COUNT(*)::int AS count FROM country_archives_v1 WHERE country_id = ?").get(countryId))
      .toMatchObject({ count: 1 });
  });

  it("повышает стадию архива на порогах количества записей", async () => {
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

    expect(await service.listArchiveRecords(countryId)).toHaveLength(10);

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

  it("удаляет запись по точному названию и уменьшает стадию архива", async () => {
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
    expect(await service.listArchiveRecords(countryId)).toHaveLength(2);
  }, 15_000);
});
