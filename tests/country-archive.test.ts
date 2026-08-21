import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppService, CHUNK_SIZE } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";
import { boundsOf, cellKey, contains, expandRect, intersects, rectangleFootprint } from "../src/server/world/grid";

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
  }, 15_000);

  afterEach(async () => await db.close());

  it("автоматически создаёт один архив страны, не создавая город", async () => {
    const archive = await service.getArchive(countryId);

    expect(archive).toMatchObject({ countryId, name: "Государственный архив", stage: 1, recordCount: 0 });
    expect(await service.listCities(countryId)).toHaveLength(0);
    expect(await db.prepare("SELECT COUNT(*)::int AS count FROM country_archives_v1 WHERE country_id = ?").get(countryId))
      .toMatchObject({ count: 1 });
  });

  it("публикует отдельный архивный комплекс возле первого рабочего города", async () => {
    let affectedBounds: Parameters<typeof contains>[0] | undefined;
    service = new AppService(db, (event) => {
      if (event.type === "city.created") affectedBounds = event.payload.affectedBounds as Parameters<typeof contains>[0];
    });
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
    const compound = (await service.listWorldFeatures(countryId))
      .find((feature) => feature.kind === "COUNTRY_ARCHIVE" && feature.assetKind === "AREA")!;
    expect(affectedBounds).toBeDefined();
    expect(contains(affectedBounds!, city.center)).toBe(true);
    expect(compound.footprint.every((cell) => contains(affectedBounds!, cell))).toBe(true);
  });

  it("держит охраняемый архив за пределами городской застройки", async () => {
    const city = await service.createCity(countryId, { name: "Столица", idempotencyKey: "archive-separated-city" });
    const compound = (await service.listWorldFeatures(countryId))
      .find((feature) => feature.kind === "COUNTRY_ARCHIVE" && feature.assetKind === "AREA");

    expect(compound).toBeDefined();
    expect(intersects(expandRect(city.bounds, 24), boundsOf(compound!.footprint))).toBe(false);
  });

  it("переносит близкий архив старого мира при синхронизации инфраструктуры", async () => {
    const city = await service.createCity(countryId, { name: "Старый город", idempotencyKey: "archive-legacy-city" });
    const oldCompound = (await service.listWorldFeatures(countryId))
      .find((feature) => feature.kind === "COUNTRY_ARCHIVE" && feature.assetKind === "AREA")!;
    const legacyOrigin = { x: city.center.x + 18, y: city.center.y + 12 };
    await db.prepare("UPDATE world_features_v6 SET origin_x = ?, origin_y = ?, footprint_json = ? WHERE id = ?").run(
      legacyOrigin.x, legacyOrigin.y, JSON.stringify(rectangleFootprint(legacyOrigin, 18, 12)), oldCompound.id,
    );

    expect(await service.upgradeCountryArchiveInfrastructure()).toBe(1);

    const relocated = (await service.listWorldFeatures(countryId))
      .find((feature) => feature.kind === "COUNTRY_ARCHIVE" && feature.assetKind === "AREA")!;
    expect(relocated.id).not.toBe(oldCompound.id);
    expect(intersects(expandRect(city.bounds, 24), boundsOf(relocated.footprint))).toBe(false);
  });

  it("соединяет ограждённый архив с дорожной сетью через единственный шлагбаум", async () => {
    await service.createCity(countryId, { name: "Столица", idempotencyKey: "archive-secure-city" });
    const features = await service.listWorldFeatures(countryId);
    const compound = features.find((feature) => feature.kind === "COUNTRY_ARCHIVE" && feature.assetKind === "AREA");
    expect(compound).toBeDefined();

    const infrastructure = features.filter((feature) => feature.parentFeatureId === compound!.id && feature.assetKind === "PROP");
    const fences = infrastructure.filter((feature) => feature.assetKey.startsWith("archive-fence-"));
    const barriers = infrastructure.filter((feature) => feature.assetKey === "archive-security-barrier");
    expect(fences).toHaveLength(70);
    expect(barriers).toHaveLength(1);
    expect(barriers[0]!.footprint).toHaveLength(3);
    expect(compound!.accessPath.length).toBeGreaterThanOrEqual(4);

    const compoundBounds = boundsOf(compound!.footprint);
    const core = features.find((feature) => feature.parentFeatureId === compound!.id && feature.assetKey === "state-archive-core")!;
    const gateY = compoundBounds.maxY + 1;
    const gateCells = new Set([
      cellKey({ x: core.origin.x + 8, y: gateY }),
      cellKey({ x: core.origin.x + 9, y: gateY }),
      cellKey({ x: core.origin.x + 10, y: gateY }),
    ]);
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
    expect(compound!.accessPath.some((cell) => cell.y > compoundBounds.maxY + 1)).toBe(true);
  });

  it("пробует доступную дорогу после изолированных ближайших целей", async () => {
    const city = await service.createCity(countryId, { name: "Столица", idempotencyKey: "archive-road-candidates-city" });
    const compound = (await service.listWorldFeatures(countryId))
      .find((feature) => feature.kind === "COUNTRY_ARCHIVE" && feature.assetKind === "AREA")!;
    const horizontal = Math.abs(compound.origin.x - city.center.x) >= Math.abs(compound.origin.y - city.center.y);
    const direction = horizontal
      ? Math.sign(compound.origin.x - city.center.x) || 1
      : Math.sign(compound.origin.y - city.center.y) || 1;
    const decoys = Array.from({ length: 24 }, (_, index) => horizontal
      ? { x: compound.origin.x + direction * (30 + Math.floor(index / 8) * 8), y: compound.origin.y - 16 + index % 8 * 5 }
      : { x: compound.origin.x - 16 + index % 8 * 5, y: compound.origin.y + direction * (30 + Math.floor(index / 8) * 8) });
    const reachable = horizontal
      ? { x: compound.origin.x + direction * 110, y: compound.origin.y + 6 }
      : { x: compound.origin.x + 22, y: compound.origin.y + direction * 110 };

    await db.prepare("DELETE FROM roads_v3 WHERE country_id = ?").run(countryId);
    await db.prepare("DELETE FROM world_features_v6 WHERE parent_feature_id = ? AND asset_kind = 'PROP'").run(compound.id);
    await db.prepare("UPDATE world_features_v6 SET access_json = ? WHERE id = ?").run(JSON.stringify([]), compound.id);
    const createdAt = new Date().toISOString();
    for (const [index, cell] of decoys.entries()) {
      await db.prepare("INSERT INTO roads_v3 (country_id, x, y) VALUES (?, ?, ?)").run(countryId, cell.x, cell.y);
      // The road cell itself is a legal route endpoint, but its occupied halo
      // makes it unreachable. This reproduces stale/fragmented imported maps
      // where the closest indexed road cells are not part of the live network.
      await db.prepare(`INSERT INTO world_features_v6
        (id, country_id, city_id, district_id, parent_feature_id, kind, asset_kind, asset_key,
          origin_x, origin_y, footprint_json, orientation, access_json, development_stage, created_at)
        VALUES (?, ?, NULL, NULL, NULL, 'TEST_BLOCKER', 'AREA', 'route-blocker', ?, ?, ?, 'S', ?, 5, ?)`).run(
        `route-blocker-${index}`, countryId, cell.x, cell.y, JSON.stringify([cell]), JSON.stringify([]), createdAt,
      );
    }
    await db.prepare("INSERT INTO roads_v3 (country_id, x, y) VALUES (?, ?, ?)").run(countryId, reachable.x, reachable.y);

    service = new AppService(db);
    await expect(service.upgradeCountryArchiveInfrastructure()).resolves.toBe(1);
    const restored = (await service.listWorldFeatures(countryId)).find((feature) => feature.id === compound.id)!;
    expect(restored.accessPath).toContainEqual(reachable);
  }, 20_000);

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
    expect(infrastructure.filter((feature) => feature.assetKey.startsWith("archive-fence-"))).toHaveLength(70);
    const barriers = infrastructure.filter((feature) => feature.assetKey === "archive-security-barrier");
    expect(barriers).toHaveLength(1);
    expect(barriers[0]!.footprint).toHaveLength(3);
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

    const features = await service.listWorldFeatures(countryId);
    const compound = features.find((feature) => feature.kind === "COUNTRY_ARCHIVE" && feature.assetKind === "AREA")!;
    const children = features.filter((feature) => feature.parentFeatureId === compound.id && feature.assetKind === "BUILDING");
    expect(compound.footprint).toHaveLength(136);
    const compoundBounds = boundsOf(compound.footprint);
    expect(children.every((building) => building.footprint.every((cell) => contains(compoundBounds, cell)))).toBe(true);
    for (let left = 0; left < children.length; left += 1) {
      for (let right = left + 1; right < children.length; right += 1) {
        expect(intersects(boundsOf(children[left]!.footprint), boundsOf(children[right]!.footprint))).toBe(false);
      }
    }
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
