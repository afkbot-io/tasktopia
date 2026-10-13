import {afterEach,expect,it} from 'vitest';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createTestDb,type Db} from '../src/server/db';
import {registerUser} from '../src/server/auth';
import {AppService} from '../src/server/app-service';
import {readActiveBlockLayout} from '../src/server/world/active-block-layout';
const execute=promisify(execFile);
let db:Db|undefined;
afterEach(async()=>db?.close());
it('defaults to a read-only report, imports missing legacy geometry explicitly, and repeats without changing the world',async()=>{
 db=await createTestDb();const service=new AppService(db);
 const {user}=await registerUser(db,{email:'transport-cli@example.test',name:'CLI',password:'password123'});
 const countryId=user.countryId,city=await service.createCity(countryId,{name:'Старый вокзал',idempotencyKey:'city'});
 for(let i=0;i<6;i++){
  const district=await service.createDistrict(countryId,{cityId:city.id,name:`Район ${i}`,activate:false,idempotencyKey:`district-${i}`});
  await service.createTask(countryId,{cityId:city.id,districtId:district.id,title:`Дом ${i}`,estimate:1,idempotencyKey:`task-${i}`});
 }
 const layout=(await readActiveBlockLayout(db,city.id))!;
 const reserved=layout.blocks.find(b=>Object.values(b.parameters.slotRoles??{}).includes('RAILWAY'))!;
 const districtId=layout.districtLayouts.find(d=>d.id===reserved.districtLayoutId)!.districtId;
 await service.createTask(countryId,{cityId:city.id,districtId,title:'Вокзал',estimate:1,idempotencyKey:'station'});
 await db.prepare('DELETE FROM city_railway_corridors_v1 WHERE layout_id=?').run(layout.id);
 const schema=(await db.prepare('SELECT current_schema() AS name').get<{name:string}>())!.name;
 expect(schema).toMatch(/^test_[a-f0-9]+$/);
 const url=new URL(process.env.TEST_DATABASE_URL!);url.searchParams.set('options',`-csearch_path=${schema}`);
 const run=async(...args:string[])=>JSON.parse((await execute(process.execPath,['--import','tsx','src/server/synchronize-transport-cli.ts','--country',countryId,...args],{env:{...process.env,DATABASE_URL:url.toString()},timeout:15000})).stdout.trim());
 const snapshot=async()=>({country:await db!.prepare('SELECT world_version FROM countries WHERE id=?').get(countryId),
  rail:await db!.prepare('SELECT count(*)::int AS total FROM city_railway_corridors_v1').get(),
  air:await db!.prepare('SELECT count(*)::int AS total FROM city_airport_sites_v1').get(),
  network:await db!.prepare('SELECT revision FROM country_transport_networks_v1 WHERE country_id=?').get(countryId),
  migrations:await db!.prepare('SELECT count(*)::int AS total FROM schema_migrations').get()});
 const before=await snapshot();expect((await run()).missingRailways).toBe(1);expect(await snapshot()).toEqual(before);
 expect((await run('--write')).mode).toBe('write');const imported=await snapshot();expect(imported.rail).toEqual({total:1});expect(imported.country).not.toEqual(before.country);
 expect((await run('--write')).missingRailways).toBe(0);expect(await snapshot()).toEqual(imported);
 await expect(run('--unrecognized')).rejects.toThrow();expect(await snapshot()).toEqual(imported);
},30000);
