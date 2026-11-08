import { afterEach,expect,it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp,mkdir,readFile,writeFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { createTestDb,type Db } from '../src/server/db';
import { registerUser } from '../src/server/auth';
import { AppService } from '../src/server/app-service';

const execute=promisify(execFile);
let db:Db|undefined,folder:string|undefined;
afterEach(async()=>{await db?.close();if(folder)await rm(folder,{recursive:true,force:true});});
it('previews, warms and repeats across fresh compiled processes without touching work or geography',async()=>{
  db=await createTestDb();
  const {user}=await registerUser(db,{email:'scene-cli@example.test',name:'Scene CLI',password:'password123'});
  const service=new AppService(db),city=await service.createCity(user.countryId,{name:'Scene CLI city',idempotencyKey:'city'});
  const district=await service.createDistrict(user.countryId,{cityId:city.id,name:'Scene CLI district',activate:true,idempotencyKey:'district'});
  await service.createTask(user.countryId,{cityId:city.id,districtId:district.id,title:'Scene CLI task',estimate:1,idempotencyKey:'task'});
  const schema=(await db.prepare('SELECT current_schema() AS name').get<{name:string}>())!.name;
  expect(schema).toMatch(/^test_[a-f0-9]+$/);
  const url=new URL(process.env.TEST_DATABASE_URL??'postgres://tasktopia:tasktopia@127.0.0.1:55432/tasktopia_test');
  url.searchParams.set('options',`-csearch_path=${schema}`);
  await mkdir(join(process.cwd(),'.builder'),{recursive:true});
  folder=await mkdtemp(join(process.cwd(),'.builder/scene-cli-test-'));await mkdir(join(folder,'dist'));
  await writeFile(join(folder,'package.json'),await readFile('package.json'));
  await mkdir(join(folder,'assets/pixel-city-pack'),{recursive:true});
  await writeFile(join(folder,'assets/pixel-city-pack/manifest.json'),await readFile('assets/pixel-city-pack/manifest.json'));
  await build({entryPoints:{server:'src/server/index.ts','synchronize-city-scenes':'src/server/synchronize-city-scenes-cli.ts'},
    outdir:join(folder,'dist'),outExtension:{'.js':'.mjs'},bundle:true,packages:'external',platform:'node',format:'esm',target:'node24',logLevel:'silent'});
  const manifestScript=join(process.cwd(),'scripts/write-runtime-build-manifest.mjs');
  const manifest=()=>execute(process.execPath,[manifestScript],{cwd:folder});await manifest();
  const run=async(...args:string[])=>JSON.parse((await execute(process.execPath,['dist/synchronize-city-scenes.mjs',...args],
    {cwd:folder,env:{...process.env,NODE_ENV:'production',DATABASE_URL:url.toString()},timeout:15000})).stdout.trim());
  const canonical=async()=>({
    world:await db!.prepare('SELECT world_version FROM countries WHERE id=?').get(user.countryId),
    placements:await db!.prepare('SELECT * FROM task_placements_v1 ORDER BY task_id').all(),
    layouts:await db!.prepare('SELECT id,checksum FROM city_layouts_v1 ORDER BY id').all(),
    roads:await db!.prepare('SELECT * FROM country_road_snapshots_v1 ORDER BY country_id').all(),
    stops:await db!.prepare('SELECT * FROM city_transit_stop_plans_v1 ORDER BY layout_id').all(),
    tasks:await db!.prepare('SELECT id,title,status,progress FROM tasks_v3 ORDER BY id').all(),
    events:await db!.prepare('SELECT count(*)::int AS n FROM events').get(),
    migrations:await db!.prepare('SELECT name,checksum FROM schema_migrations ORDER BY name').all(),
  });
  const saved=()=>db!.prepare('SELECT city_id,country_id,world_version,build_key,source_hash,updated_at FROM city_scene_snapshots_v1 ORDER BY city_id').all();
  const before=await canonical(),beforeSaved=await saved();
  const preview=await run('--country',user.countryId,'--city',city.id);
  expect(preview).toMatchObject({mode:'dry-run',cities:1,ready:0,changed:0,rows:[{cityId:city.id,constructed:1,wouldChange:true}]});
  expect(await canonical()).toEqual(before);expect(await saved()).toEqual(beforeSaved);
  const written=await run('--country',user.countryId,'--write');
  expect(written).toMatchObject({mode:'write',cities:1,ready:1,changed:1,buildKey:preview.buildKey,rows:[{constructed:1,ready:true}]});
  const committed=await saved();
  const repeat=await run('--country',user.countryId,'--write');
  expect(repeat).toMatchObject({cities:1,ready:1,changed:0,buildKey:written.buildKey,rows:[{constructed:0,wouldChange:false}]});
  expect(await saved()).toEqual(committed);expect(await canonical()).toEqual(before);
  expect(await run('--country',user.countryId)).toMatchObject({mode:'dry-run',ready:1,changed:0,rows:[{constructed:0}]});
  const cliPath=join(folder,'dist/synchronize-city-scenes.mjs'),originalCli=await readFile(cliPath);
  await writeFile(cliPath,Buffer.concat([originalCli,Buffer.from('\n// mixed CLI artifact\n')]));
  await expect(run('--country',user.countryId,'--write')).rejects.toThrow(/artifacts are required/);
  expect(await saved()).toEqual(committed);await writeFile(cliPath,originalCli);
  // Any server artifact change invalidates the namespace even when the CLI,
  // package version, city and database version have stayed unchanged.
  const serverPath=join(folder,'dist/server.mjs');await writeFile(serverPath,Buffer.concat([await readFile(serverPath),Buffer.from('\n// fingerprint change\n')]));
  await expect(run('--country',user.countryId,'--write')).rejects.toThrow(/artifacts are required/);
  expect(await saved()).toEqual(committed);await manifest();
  const next=await run('--country',user.countryId);
  expect(next.buildKey).not.toBe(written.buildKey);expect(next).toMatchObject({ready:0,rows:[{constructed:1,wouldChange:true}]});
  expect(await saved()).toEqual(committed);expect(await canonical()).toEqual(before);
  await expect(run('--country',randomUUID(),'--write')).rejects.toThrow(/Country not found/);
  await expect(run('--country',user.countryId,'--city',randomUUID(),'--write')).rejects.toThrow(/City not found/);
  await expect(run('--country',user.countryId,'--write','--write')).rejects.toThrow(/Usage:/);
  await expect(run('--country',user.countryId,'--unknown')).rejects.toThrow(/Usage:/);
  expect(await saved()).toEqual(committed);expect(await canonical()).toEqual(before);
},30000);
