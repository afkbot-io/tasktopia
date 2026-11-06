import { afterEach, expect, it } from 'vitest';
import { createTestDb, type Db } from '../src/server/db';
import { registerUser } from '../src/server/auth';
import { AppService } from '../src/server/app-service';
import { readActiveBlockLayout } from '../src/server/world/active-block-layout';
import * as store from '../src/server/world/city-transit-stop-store';
import { encodeCitySceneWire, decodeCitySceneWire } from '../src/shared/city-scene-wire';
import { buildCityWalkNetwork } from '../src/client/city-walk-network';
import { buildMobilityNetwork } from '../src/client/city-mobility-network';
import { terrainAt } from '../src/shared/world-terrain';
import { materializeChunkPhysics } from '../src/shared/world-chunk-physics';

let db: Db | undefined;
afterEach(async () => { await db?.close(); });
it('stores only authorized active-layout plans, preserves their prefix and distinguishes absent from ready-empty', async () => {
  db = await createTestDb();
  const service = new AppService(db);
  const { user } = await registerUser(db,{ email: 'stop-store@example.test', name: 'Stops', password: 'password123' });
  await db.prepare('UPDATE countries SET seed=? WHERE id=?').run(424242,user.countryId);
  const city = await service.createCity(user.countryId,{ name: 'Stops', idempotencyKey: 'stop-city' });
  const layout = (await readActiveBlockLayout(db,city.id))!;
  // Reads neither create rows nor invoke the planner, including an empty city.
  expect(await store.readCityTransitStopPlan(db,'foreign-country',layout.id)).toBeUndefined();
  const original = await store.readCityTransitStopPlan(db,user.countryId,layout.id);
  if (original) await db.prepare('DELETE FROM city_transit_stop_plans_v1 WHERE layout_id=?').run(layout.id);
  expect(await store.readCityTransitStopPlan(db,user.countryId,layout.id)).toBeUndefined();
  const empty = { schemaVersion: 1 as const, layoutId: layout.id, processedBlockIds: [], stops: [] };
  await expect(store.saveCityTransitStopPlan(db,'foreign-country',empty)).rejects.toThrow();
  await store.saveCityTransitStopPlan(db,user.countryId,empty);
  expect(await store.readCityTransitStopPlan(db,user.countryId,layout.id)).toEqual(empty);
  await expect(db.prepare('UPDATE city_transit_stop_plans_v1 SET plan_json=?::jsonb WHERE layout_id=?').run('{}',layout.id)).rejects.toThrow();
  expect(await store.readCityTransitStopPlan(db,'foreign-country',layout.id)).toBeUndefined();
  const district = await service.createDistrict(user.countryId,{ cityId: city.id, name: 'First', activate: false, idempotencyKey: 'stop-district' });
  for (let i=0; i<18; i++) await service.createTask(user.countryId,{ cityId: city.id, districtId: district.id, title: `Building ${i}`, estimate: 1, idempotencyKey: `stop-task-${i}` });
  const grown = (await readActiveBlockLayout(db,city.id))!;
  const frozen = await store.freezeCityTransitStops(db,grown);
  expect(frozen.processedBlockIds.length).toBe(grown.blocks.length);
  expect(frozen.stops.length).toBeGreaterThan(0);
  const row = await db.prepare('SELECT updated_at FROM city_transit_stop_plans_v1 WHERE layout_id=?').get(layout.id);
  expect(await store.freezeCityTransitStops(db,grown)).toEqual(frozen);
  expect(await db.prepare('SELECT updated_at FROM city_transit_stop_plans_v1 WHERE layout_id=?').get(layout.id)).toEqual(row);
  // Even a future SQL writer must not replace/reorder published stops.
  await expect(store.saveCityTransitStopPlan(db,user.countryId,{ ...frozen, stops: frozen.stops.slice(1) })).rejects.toThrow();
  await expect(store.saveCityTransitStopPlan(db,user.countryId,{ ...frozen, processedBlockIds: [...frozen.processedBlockIds].reverse() })).rejects.toThrow();
  expect(await store.readCityTransitStopPlan(db,user.countryId,layout.id)).toEqual(frozen);
  expect(await store.countryTransitStopReservations(db,'foreign-country')).toEqual([]);
  expect((await store.countryTransitStopReservations(db,user.countryId)).length).toBe(frozen.stops.length);
},30000);

it('publishes the same immutable stops in CITY and viewport features through growth, status, deletion and reload, without writes on GET', async () => {
  db = await createTestDb();const service = new AppService(db);
  const { user } = await registerUser(db,{ email: 'stop-scene@example.test', name: 'Stops', password: 'password123' });
  await db.prepare('UPDATE countries SET seed=? WHERE id=?').run(424242,user.countryId);
  const city = await service.createCity(user.countryId,{ name: 'Native stops', idempotencyKey: 'scene-city' });
  const district = await service.createDistrict(user.countryId,{ cityId: city.id, name: 'First', activate: true, idempotencyKey: 'scene-district' });
  const tasks = [];
  for (let i=0; i<12; i++) tasks.push(await service.createTask(user.countryId,{ cityId: city.id, districtId: district.id, title: `Building ${i}`, estimate: 1, idempotencyKey: `scene-task-${i}` }));
  const scene = await service.getCityScene(user.countryId,city.id);
  expect(scene.transitStops!.length).toBeGreaterThan(0);
  expect(decodeCitySceneWire(encodeCitySceneWire(scene)).transitStops).toEqual(scene.transitStops);
  const features = [...new Map(scene.chunks.flatMap(chunk => chunk.worldFeatures).filter(f => f.kind==='BUS_STOP').map(f => [f.id,f])).values()];
  expect(features.length).toBe(scene.transitStops!.length);
  expect((await service.listWorldFeatures(user.countryId)).filter(f => f.kind==='BUS_STOP')).toEqual(expect.arrayContaining(features));
  const beforeRows = await db.prepare('SELECT * FROM city_transit_stop_plans_v1').all();
  const beforeVersion = await db.prepare('SELECT world_version FROM countries WHERE id=?').get(user.countryId);
  await new AppService(db).getCityScene(user.countryId,city.id);
  expect(await db.prepare('SELECT * FROM city_transit_stop_plans_v1').all()).toEqual(beforeRows);
  expect(await db.prepare('SELECT world_version FROM countries WHERE id=?').get(user.countryId)).toEqual(beforeVersion);
  const first = tasks[0]!;
  await service.updateTaskStatus(user.countryId,{ taskId: first.id, status: 'STARTED', comment: 'Start', idempotencyKey: 'scene-start' });
  await service.deleteTask(user.countryId,{ taskId: first.id, confirmTitle: first.title, idempotencyKey: 'scene-delete' });
  const destination = await service.createDistrict(user.countryId,{ cityId:city.id,name:'Moved',activate:false,idempotencyKey:'scene-move-district' });
  await service.transferTask(user.countryId,{taskId:tasks[1]!.id,targetDistrictId:destination.id,idempotencyKey:'scene-move'});
  for (let i=12; i<28; i++) await service.createTask(user.countryId,{ cityId: city.id, districtId: district.id, title: `Growth ${i}`, estimate: 1, idempotencyKey: `scene-task-${i}` });
  const after = await new AppService(db).getCityScene(user.countryId,city.id);
  expect(after.transitStops).toEqual(expect.arrayContaining([...scene.transitStops!]));
  const physical = after.chunks.map(materializeChunkPhysics);
  const roads = new Map(physical.flatMap(chunk => chunk.roads).map(p => [`${p.x},${p.y}`,p]));
  const nativeFeatures = [...new Map(physical.flatMap(chunk => chunk.worldFeatures).map(f => [f.id,f])).values()];
  const walk = buildCityWalkNetwork({ terrain: [],roads,surfaces: physical.flatMap(chunk => chunk.surfaces),
    tasks: [...new Map(physical.flatMap(chunk => chunk.tasks).map(t => [t.id,t])).values()],features: nativeFeatures,
    decorations: [...new Map(physical.flatMap(chunk => chunk.decorations).map(d => [d.id,d])).values()],
    sampleTerrain: p => terrainAt(424242,p.x,p.y).terrain });
  const network = buildMobilityNetwork({ roads,walkGraph: walk.walkGraph,crosswalks: walk.crosswalks,
    activityCells: walk.activityCells,buildingEntrances: walk.buildingEntrances });
  for (const stop of after.transitStops!) for (const p of [...stop.queue,...stop.accessPath]) {
    const id = `${p.x},${p.y}`;expect(network.walkers.has(id),`${stop.id} native approach`).toBe(true);
    expect(network.zoneByCell.has(id),`${stop.id} native conflict`).toBe(false);
  }
  expect(await db.prepare('SELECT * FROM city_transit_stop_plans_v1').all()).not.toEqual(beforeRows);
  const layout = (await readActiveBlockLayout(db,city.id))!;
  await db.prepare('DELETE FROM city_transit_stop_plans_v1 WHERE layout_id=?').run(layout.id);
  // This direct legacy-fixture edit must publish its source change, as a
  // topology command does. An unchanged world version legitimately reuses
  // the persisted scene from before the edit.
  await db.prepare('UPDATE countries SET world_version=world_version+1 WHERE id=?').run(user.countryId);
  const legacy = await new AppService(db).getCityScene(user.countryId,city.id);
  expect(legacy.transitStops).toBeUndefined();
  expect(await store.readCityTransitStopPlan(db,user.countryId,layout.id)).toBeUndefined();
},30000);
