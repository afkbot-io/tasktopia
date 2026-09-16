import { afterEach, expect, it } from "vitest";
import { createTestDb, type Db } from "../src/server/db";
import { createCountry, registerUser } from "../src/server/auth";
import { AppService } from "../src/server/app-service";
import type { PersonalPlanetGeography } from "../src/shared/planet-geography";
import { countryPortReservations } from "../src/server/world/port-reservations";
import { readActiveBlockLayout } from "../src/server/world/active-block-layout";
let db: Db | undefined;
afterEach(async () => { await db?.close(); });
it("creates a real port from a coastal country and saved owner geography", async () => {
  db = await createTestDb();
  const { user } = await registerUser(db, { email: "port-live@example.test", name: "Port", password: "password123" });
  const countryId = await createCountry(db, user.id, "Приморье", { version: 1, kind: "EAST_COAST", coastX: 128 });
  await db.prepare("UPDATE countries SET seed=123 WHERE id=?").run(countryId);
  const service = new AppService(db);
  const city = await service.createCity(countryId, { name: "Приморск", idempotencyKey: "city" });
  const district = await service.createDistrict(countryId, { cityId: city.id, name: "Портовый", activate: true, idempotencyKey: "district" });
  await expect(service.createTask(countryId, { cityId: city.id, districtId: district.id, title: "Без карты", estimate: 1,
    buildingHint: "compact-port-v1", idempotencyKey: "no-geography" })).rejects.toThrow(/подтверждённый/);
  await service.getPlanetAtlas(user.id);
  // Pin this fixture's private coast: random user IDs choose different
  // continents, including correctly unavailable inland/shared-coast cases.
  const stored = (await db.prepare("SELECT geography_json FROM personal_planet_geography_v1 WHERE user_id=?")
    .get<{ geography_json: PersonalPlanetGeography }>(user.id))!.geography_json;
  const record = stored.countries[countryId]!;
  const cells = Array.from({ length: 9 }, (_, i) => ({ q: 10 + i % 3, r: 10 + Math.floor(i / 3), id: `coastal-land-${i}`, terrain: "grass" as const }));
  const coastCells = [9, 10, 11, 12, 13].flatMap(r => [9, 10, 11, 12, 13].filter(q => q === 9 || q === 13 || r === 9 || r === 13)
    .map(q => ({ q, r, id: `coastal-shore-${q}-${r}`, terrain: "coast" as const })));
  const pinned = { ...stored, countries: { [countryId]: { ...record, sector: 0, cells } }, coastCells,
    coastOwners: Object.fromEntries(coastCells.map(cell => [cell.id, [countryId]])) };
  await db.prepare("UPDATE personal_planet_geography_v1 SET geography_json=?::jsonb WHERE user_id=?").run(JSON.stringify(pinned), user.id);
  const port = await service.createTask(countryId, { cityId: city.id, districtId: district.id, title: "Морской порт", estimate: 1,
    buildingHint: "compact-port-v1", idempotencyKey: "port" });
  expect(port.serviceRole).toBe("PORT");
  const layout = (await readActiveBlockLayout(db, city.id))!;
  const placement = layout.placements.find(p => p.taskId === port.id)!;
  expect(layout.blocks.find(b => b.id === placement.blockId)!.parameters.slotPortPlans).toHaveProperty(placement.slotKey);
  expect((await service.getPlanetAtlas(user.id)).countries.find(country => country.id === countryId)!.cities[0]!.ports).toEqual([]);
  const scene = await service.getCityScene(countryId, city.id);
  expect(scene.ports).toHaveLength(1);
  expect(scene.ports![0]!.taskId).toBe(port.id);
  expect(scene.ports![0]!.stage).toBe(1);
  const berth = scene.ports![0]!.plan.berth;
  expect(berth.x).toBeLessThanOrEqual(scene.city.bounds.maxX);
  const reservations = await countryPortReservations(db, countryId);
  expect(reservations.some(rect => berth.x >= rect.minX && berth.x <= rect.maxX && berth.y >= rect.minY && berth.y <= rect.maxY)).toBe(true);
  expect(await countryPortReservations(db, user.countryId)).toEqual([]);
  for (const status of ["STARTED", "IN_PROGRESS", "TESTING", "COMPLETED"] as const) {
    await service.updateTaskStatus(countryId, { taskId: port.id, status, comment: "Проверка стадий порта", idempotencyKey: status });
  }
  const completeScene = await service.getCityScene(countryId, city.id);
  expect(completeScene.ports![0]!.stage).toBe(5);
  expect((await service.getPlanetAtlas(user.id)).countries.find(country => country.id === countryId)!.cities[0]!.ports)
    .toEqual([{ taskId: port.id, berth, waterOutlet: completeScene.ports![0]!.plan.waterPath.at(-1)!, stage: 5 }]);
  expect(completeScene.ports![0]!.plan).toEqual(scene.ports![0]!.plan);
  await expect(service.createTask(countryId, { cityId: city.id, districtId: district.id, title: "Второй порт", estimate: 1,
    buildingHint: "compact-port-v1", idempotencyKey: "second-port" })).rejects.toThrow(/порт/);
});
