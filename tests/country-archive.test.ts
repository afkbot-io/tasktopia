import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppService, CHUNK_SIZE } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";
import { cellKey } from "../src/server/world/grid";

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

  it("соединяет ограждённый архив с дорожной сетью через единственный шлагбаум", async () => {
    await service.createCity(countryId, { name: "Столица", idempotencyKey: "archive-secure-city" });
    const features = await service.listWorldFeatures(countryId);
    const compound = features.find((feature) => feature.kind === "COUNTRY_ARCHIVE" && feature.assetKind === "AREA");
    expect(compound).toBeDefined();

    const infrastructure = features.filter((feature) => feature.parentFeatureId === compound!.id && feature.assetKind === "PROP");
    const fences = infrastructure.filter((feature) => feature.assetKey.startsWith("archive-fence-"));
    const barriers = infrastructure.filter((feature) => feature.assetKey === "archive-security-barrier");
    expect(fences).toHaveLength(31);
    expect(barriers).toHaveLength(1);
    expect(compound!.accessPath.length).toBeGreaterThanOrEqual(4);

    const origin = compound!.origin;
    const gateCells = new Set([cellKey({ x: origin.x + 9, y: origin.y + 12 }), cellKey({ x: origin.x + 10, y: origin.y + 12 })]);
    const fenceCells = new Set(fences.flatMap((feature) => feature.footprint).map(cellKey));
    expect([...gateCells].every((key) => !fenceCells.has(key))).toBe(true);
    expect(new Set(barriers[0]!.footprint.map(cellKey))).toEqual(gateCells);

    const relevantCells = [...compound!.footprint, ...compound!.accessPath, ...barriers[0]!.footprint];
    const chunkKeys = new Set(relevantCells.map((cell) => `${Math.floor(cell.x / CHUNK_SIZE)},${Math.floor(cell.y / CHUNK_SIZE)}`));
    const roads = new Set<string>();
    for (const chunkKey of chunkKeys) {
      const [chunkX, chunkY] = chunkKey.split(",").map(Number);
      const chunk = await service.getChunk(countryId, chunkX!, chunkY!, "DETAIL");
      for (const road of chunk.roads) roads.add(cellKey(road));
    }
    expect(compound!.accessPath.every((cell) => roads.has(cellKey(cell)))).toBe(true);
    expect(compound!.accessPath.some((cell) => cell.y > origin.y + 13)).toBe(true);
  });

  it("достраивает периметр и въезд существующего архива при запуске", async () => {
    await service.createCity(countryId, { name: "Старый мир", idempotencyKey: "archive-upgrade-city" });
    const compound = (await service.listWorldFeatures(countryId))
      .find((feature) => feature.kind === "COUNTRY_ARCHIVE" && feature.assetKind === "AREA");
    expect(compound).toBeDefined();
    await db.prepare("DELETE FROM world_features_v6 WHERE parent_feature_id = ? AND asset_kind = 'PROP'").run(compound!.id);
    await db.prepare("UPDATE world_features_v6 SET access_json = ? WHERE id = ?").run(JSON.stringify([]), compound!.id);

    expect(await service.upgradeCountryArchiveInfrastructure()).toBe(1);
    expect(await service.upgradeCountryArchiveInfrastructure()).toBe(1);

    const restored = await service.listWorldFeatures(countryId);
    const restoredCompound = restored.find((feature) => feature.id === compound!.id);
    const infrastructure = restored.filter((feature) => feature.parentFeatureId === compound!.id && feature.assetKind === "PROP");
    expect(restoredCompound!.accessPath.length).toBeGreaterThanOrEqual(4);
    expect(infrastructure.filter((feature) => feature.assetKey.startsWith("archive-fence-"))).toHaveLength(31);
    expect(infrastructure.filter((feature) => feature.assetKey === "archive-security-barrier")).toHaveLength(1);
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
