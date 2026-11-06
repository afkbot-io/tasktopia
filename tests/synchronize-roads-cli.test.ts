import { afterEach,expect,it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { createTestDb,type Db } from '../src/server/db';
import { registerUser } from '../src/server/auth';
import { AppService } from '../src/server/app-service';
import { readCountryRoads } from '../src/server/world/intercity-road-store';
import { INTERCITY_ROAD_PLANNER_VERSION } from '../src/server/world/intercity-road-planner';

const execute = promisify(execFile);
let db: Db | undefined;
afterEach(async () => db?.close());
it('previews, publishes and repeats a version upgrade without changing accepted roads or task geography',async () => {
  db = await createTestDb();const service = new AppService(db);
  const {user} = await registerUser(db,{email:'roads-cli@example.test',name:'Road CLI',password:'password123'});
  const countryId = user.countryId;
  await db.prepare('UPDATE countries SET seed=1 WHERE id=?').run(countryId);
  const cities = [];
  for (let i=0;i<2;i++) {
    const city = await service.createCity(countryId,{name:`Road city ${i}`,idempotencyKey:`city${i}`});cities.push(city);
    const district = await service.createDistrict(countryId,{cityId:city.id,name:'Road district',activate:true,idempotencyKey:`district${i}`});
    await service.createTask(countryId,{cityId:city.id,districtId:district.id,title:`House ${i}`,estimate:1,idempotencyKey:`task${i}`});
  }
  const current = (await readCountryRoads(db,countryId))!;
  expect(current.plan.routes).toHaveLength(1);
  const scene = await service.getCityScene(countryId,cities[0]!.id),chunk = scene.chunks[0]!;
  await new AppService(db).getChunkPayload(countryId,chunk.chunkX,chunk.chunkY,'DETAIL');
  await service.getCountryOverview(user.id,countryId);
  await db.prepare('UPDATE country_road_snapshots_v1 SET plan_json=?::jsonb WHERE country_id=?')
    .run(JSON.stringify({...current.plan,plannerVersion:2}),countryId);
  const schema = (await db.prepare('SELECT current_schema() AS name').get<{name:string}>())!.name;
  expect(schema).toMatch(/^test_[a-f0-9]+$/);
  const url = new URL(process.env.TEST_DATABASE_URL??'postgres://tasktopia:tasktopia@127.0.0.1:55432/tasktopia_test');
  url.searchParams.set('options',`-csearch_path=${schema}`);
  const run = async (...args:string[]) => JSON.parse((await execute(process.execPath,
    ['--import','tsx','src/server/synchronize-roads-cli.ts',...args],
    {env:{...process.env,DATABASE_URL:url.toString()},timeout:15_000})).stdout.trim());
  const snapshot = async () => ({
    roads:await db!.prepare('SELECT * FROM country_road_snapshots_v1 ORDER BY country_id').all(),
    country:await db!.prepare('SELECT world_version FROM countries WHERE id=?').get(countryId),
    chunks:await db!.prepare('SELECT count(*)::int AS total FROM world_chunk_payloads_v1').get(),
    overview:await db!.prepare('SELECT count(*)::int AS total FROM country_overview_snapshots_v1').get(),
    placements:await db!.prepare('SELECT * FROM task_placements_v1 ORDER BY task_id').all(),
    migrations:await db!.prepare('SELECT count(*)::int AS total FROM schema_migrations').get(),
  });
  const before = await snapshot();expect(before.chunks!.total).toBeGreaterThan(0);expect(before.overview!.total).toBeGreaterThan(0);
  const preview = await run('--country',countryId);
  expect(preview).toMatchObject({mode:'dry-run',changed:true,before:{plannerVersion:2},after:{plannerVersion:INTERCITY_ROAD_PLANNER_VERSION,routes:1}});
  expect(await snapshot()).toEqual(before);
  const written = await run('--country',countryId,'--write');
  expect(written).toMatchObject({mode:'write',changed:true,checksum:preview.checksum});
  const after = await snapshot();
  expect(Number(after.country!.world_version)).toBe(Number(before.country!.world_version)+1);
  expect(after.chunks).toEqual({total:0});expect(after.overview).toEqual({total:0});
  expect(after.placements).toEqual(before.placements);expect(after.migrations).toEqual(before.migrations);
  expect((await readCountryRoads(db,countryId))!.plan.routes).toEqual(current.plan.routes);
  expect(await run('--country',countryId,'--write')).toMatchObject({changed:false,checksum:written.checksum});
  expect(await run('--country',countryId)).toMatchObject({changed:false,checksum:written.checksum});
  expect(await snapshot()).toEqual(after);
  await expect(run('--country',randomUUID(),'--write')).rejects.toThrow(/Country not found/);
  await expect(run('--country',countryId,'--write','--write')).rejects.toThrow(/Usage:/);
  await expect(run('--country',countryId,'--unknown')).rejects.toThrow(/Usage:/);
  expect(await snapshot()).toEqual(after);
  // A publication failure after the road INSERT must roll back the complete
  // command, including its snapshot, and must not print a success receipt.
  const retryPlan=(await readCountryRoads(db,countryId))!.plan;
  await db.prepare('UPDATE country_road_snapshots_v1 SET plan_json=?::jsonb WHERE country_id=?')
    .run(JSON.stringify({...retryPlan,plannerVersion:2}),countryId);
  await db.exec(`CREATE FUNCTION fail_road_world_publication() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'road publication rollback fixture'; END; $$;
    CREATE TRIGGER fail_road_world_publication BEFORE UPDATE OF world_version ON countries
    FOR EACH ROW EXECUTE FUNCTION fail_road_world_publication();`);
  const beforeFault=await snapshot();let failure:unknown;
  try {await run('--country',countryId,'--write');} catch(error) {failure=error;}
  expect(failure).toMatchObject({stdout:'',stderr:expect.stringContaining('road publication rollback fixture')});
  expect(await snapshot()).toEqual(beforeFault);
},30_000);
