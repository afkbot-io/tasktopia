import { afterEach,expect,it,vi } from 'vitest';
import { createTestDb,isTransactionActive,transaction,type Db,type Row } from '../src/server/db';
import { registerUser } from '../src/server/auth';
import { AppService } from '../src/server/app-service';
import { CitySceneSnapshotStore,citySceneSnapshotBuildKey,CITY_SCENE_SNAPSHOT_LIMITS } from '../src/server/world/city-scene-snapshot-store';

let db:Db|undefined;
afterEach(async()=>{vi.restoreAllMocks();const owned=db;db=undefined;await owned?.close();});
async function fixture(){
  db=await createTestDb();
  const {user}=await registerUser(db,{email:'snapshot@example.test',name:'Snapshot QA',password:'password123'});
  const service=new AppService(db),city=await service.createCity(user.countryId,{name:'Snapshot city',idempotencyKey:'city'});
  const district=await service.createDistrict(user.countryId,{cityId:city.id,name:'Snapshot district',activate:true,idempotencyKey:'district'});
  await service.createTask(user.countryId,{cityId:city.id,districtId:district.id,title:'Snapshot task',estimate:1,idempotencyKey:'task'});
  return{db,service,user,city};
}
it('reuses the exact committed city in a fresh service without rebuilding any chunk',async()=>{
  const{db,service,user,city}=await fixture();
  const original=await service.getCitySceneForUser(user.id,user.countryId,city.id);
  expect(service.runtimeStats().caches.cityScenes.builds).toBe(1);
  const fresh=new AppService(db),restored=await fresh.getCitySceneForUser(user.id,user.countryId,city.id);
  expect(restored).toEqual(original);
  expect(JSON.stringify(restored)).toBe(JSON.stringify(original));
  expect(fresh.runtimeStats().caches.cityScenes.builds).toBe(0);
  expect(fresh.runtimeStats().caches.chunks.builds).toBe(0);
});
it('invalidates the saved scene after a real task change and never overwrites it with an older reader',async()=>{
  const{db,service,user,city}=await fixture();
  const before=await service.getCitySceneForUser(user.id,user.countryId,city.id);
  const version=(await db.prepare('SELECT world_version FROM countries WHERE id=?').get<{world_version:number}>(user.countryId))!.world_version;
  const task=before.chunks.flatMap(c=>c.tasks)[0]!;
  await service.renameTask(user.countryId,{taskId:task.id,title:'Актуальная задача',idempotencyKey:'rename'});
  const fresh=new AppService(db),after=await fresh.getCitySceneForUser(user.id,user.countryId,city.id);
  expect(after.sceneRevision).not.toBe(before.sceneRevision);
  expect(after.chunks.flatMap(c=>c.tasks).find(t=>t.id===task.id)!.title).toBe('Актуальная задача');
  expect(fresh.runtimeStats().caches.cityScenes.builds).toBe(1);
  const saved=await db.prepare('SELECT world_version,source_hash,updated_at FROM city_scene_snapshots_v1 WHERE city_id=?').get(city.id);
  await new CitySceneSnapshotStore(db).write(user.countryId,city.id,Number(version),{...before,railConnections:undefined,seaConnections:undefined});
  expect(await db.prepare('SELECT world_version,source_hash,updated_at FROM city_scene_snapshots_v1 WHERE city_id=?').get(city.id)).toEqual(saved);
  const next=new AppService(db);expect(await next.getCitySceneForUser(user.id,user.countryId,city.id)).toEqual(after);
  expect(next.runtimeStats().caches.cityScenes.builds).toBe(0);
});
it.each(['payload','checksum','build'] as const)('rebuilds a damaged or unrelated %s cache instead of returning it',async field=>{
  const{db,service,user,city}=await fixture(),original=await service.getCitySceneForUser(user.id,user.countryId,city.id);
  if(field==='payload')await db.prepare('UPDATE city_scene_snapshots_v1 SET payload=? WHERE city_id=?').run(Buffer.from('corrupt'),city.id);
  if(field==='checksum')await db.prepare('UPDATE city_scene_snapshots_v1 SET source_hash=? WHERE city_id=?').run('0'.repeat(64),city.id);
  if(field==='build')await db.prepare('UPDATE city_scene_snapshots_v1 SET build_key=? WHERE city_id=?').run('0'.repeat(64),city.id);
  const fresh=new AppService(db);
  expect(await fresh.getCitySceneForUser(user.id,user.countryId,city.id)).toEqual(original);
  expect(fresh.runtimeStats().caches.cityScenes.builds).toBe(1);
  expect((await db.prepare('SELECT build_key FROM city_scene_snapshots_v1 WHERE city_id=?').get<{build_key:string}>(city.id))!.build_key)
    .toBe(await citySceneSnapshotBuildKey());
  const restored=new AppService(db);expect(await restored.getCitySceneForUser(user.id,user.countryId,city.id)).toEqual(original);
  expect(restored.runtimeStats().caches.cityScenes.builds).toBe(0);
});
it('does not publish a rolled-back task scene to disk or process cache',async()=>{
  const{db,service,user,city}=await fixture();
  const task=(await service.listTasks(user.countryId))[0]!,reader=new AppService(db);
  await expect(transaction(db,async()=>{
    await service.renameTask(user.countryId,{taskId:task.id,title:'Отменённое изменение',idempotencyKey:'rollback-name'});
    const scene=await reader.getCitySceneForUser(user.id,user.countryId,city.id);
    expect(scene.chunks.flatMap(c=>c.tasks).some(t=>t.title==='Отменённое изменение')).toBe(true);
    throw new Error('rollback snapshot fixture');
  })).rejects.toThrow('rollback snapshot fixture');
  expect(await db.prepare('SELECT count(*)::int AS n FROM city_scene_snapshots_v1').get()).toEqual({n:0});
  expect(reader.runtimeStats().caches.cityScenes.entries).toBe(0);
  const committed=await reader.getCitySceneForUser(user.id,user.countryId,city.id);
  expect(committed.chunks.flatMap(c=>c.tasks).some(t=>t.title==='Отменённое изменение')).toBe(false);
});
it('checks current membership before every saved scene read, including revocation',async()=>{
  const{db,service,user,city}=await fixture();await service.getCitySceneForUser(user.id,user.countryId,city.id);
  const guest=(await registerUser(db,{email:'snapshot-guest@example.test',name:'Guest',password:'password123'})).user;
  const read=vi.spyOn(CitySceneSnapshotStore.prototype,'read');
  await expect(new AppService(db).getCitySceneForUser(guest.id,user.countryId,city.id)).rejects.toMatchObject({code:'FORBIDDEN'});
  expect(read).not.toHaveBeenCalled();
  await db.prepare("INSERT INTO country_members(country_id,user_id,role,created_at) VALUES (?,?,'VIEWER',now())").run(user.countryId,guest.id);
  const member=new AppService(db);await member.getCitySceneForUser(guest.id,user.countryId,city.id);
  expect(member.runtimeStats().caches.cityScenes.builds).toBe(0);
  await db.prepare('DELETE FROM country_members WHERE country_id=? AND user_id=?').run(user.countryId,guest.id);read.mockClear();
  await expect(member.getCitySceneForUser(guest.id,user.countryId,city.id)).rejects.toMatchObject({code:'FORBIDDEN'});
  expect(read).not.toHaveBeenCalled();
  await expect(new AppService(db).getCitySceneForUser(guest.id,guest.countryId,city.id)).rejects.toMatchObject({code:'NOT_FOUND'});
});
it('never persists a viewer-specific response over the shared base scene',async()=>{
  const{db,service,user,city}=await fixture(),personal=await service.getCitySceneForUser(user.id,user.countryId,city.id);
  expect(personal.railConnections).toEqual([]);expect(personal.seaConnections).toEqual([]);
  const before=await db.prepare('SELECT world_version,source_hash,updated_at FROM city_scene_snapshots_v1 WHERE city_id=?')
    .get<{world_version:number;source_hash:string;updated_at:string}>(city.id);
  await new CitySceneSnapshotStore(db).write(user.countryId,city.id,Number(before!.world_version),personal);
  expect(await db.prepare('SELECT world_version,source_hash,updated_at FROM city_scene_snapshots_v1 WHERE city_id=?').get(city.id)).toEqual(before);
});
it('resolves two concurrent cold readers to one committed scene without changing the world',async()=>{
  const{db,user,city}=await fixture(),prepare=db.prepare.bind(db);
  const before=await db.prepare('SELECT world_version FROM countries WHERE id=?').get(user.countryId);
  let arrivals=0,release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  vi.spyOn(db,'prepare').mockImplementation(query=>{
    const statement=prepare(query);if(!query.includes('FROM city_scene_snapshots_v1 s'))return statement;
    return{...statement,get:async<T extends Row>(...args:unknown[])=>{
      const row=await statement.get<T>(...args);
      if(!row&&arrivals<2){arrivals++;if(arrivals===2)release();await gate;}
      return row;
    }};
  });
  const readers=[new AppService(db),new AppService(db)],pending=readers.map(r=>r.getCityScene(user.countryId,city.id));
  try{
    const [a,b]=await Promise.all(pending);expect(a).toEqual(b);expect(arrivals).toBe(2);
    expect(await db.prepare('SELECT world_version FROM countries WHERE id=?').get(user.countryId)).toEqual(before);
    expect(await db.prepare('SELECT count(*)::int AS n FROM city_scene_snapshots_v1').get()).toEqual({n:1});
    const fresh=new AppService(db);expect(await fresh.getCityScene(user.countryId,city.id)).toEqual(a);
    expect(fresh.runtimeStats().caches.cityScenes.builds).toBe(0);
  }finally{release();await Promise.allSettled(pending);}
},10000);
it('rejects an intact snapshot copied from another city, even with its valid checksum',async()=>{
  const{db,service,user,city}=await fixture();
  const other=await service.createCity(user.countryId,{name:'Other snapshot city',idempotencyKey:'other-city'});
  const district=await service.createDistrict(user.countryId,{cityId:other.id,name:'Other district',activate:true,idempotencyKey:'other-district'});
  await service.createTask(user.countryId,{cityId:other.id,districtId:district.id,title:'Foreign city task',estimate:1,idempotencyKey:'other-task'});
  const expected=await service.getCitySceneForUser(user.id,user.countryId,city.id);
  await service.getCitySceneForUser(user.id,user.countryId,other.id);
  await db.prepare(`UPDATE city_scene_snapshots_v1 a SET source_hash=b.source_hash,raw_bytes=b.raw_bytes,payload=b.payload
    FROM city_scene_snapshots_v1 b WHERE a.city_id=? AND b.city_id=?`).run(city.id,other.id);
  const fresh=new AppService(db);expect(await fresh.getCitySceneForUser(user.id,user.countryId,city.id)).toEqual(expected);
  expect(fresh.runtimeStats().caches.cityScenes.builds).toBe(1);
});
it.each(['city','country'] as const)('removes the saved body when its owning %s is deleted',async kind=>{
  const{db,service,user,city}=await fixture();await service.getCitySceneForUser(user.id,user.countryId,city.id);
  expect(await db.prepare('SELECT count(*)::int AS n FROM city_scene_snapshots_v1').get()).toEqual({n:1});
  if(kind==='city')await db.prepare('DELETE FROM cities_v3 WHERE id=? AND country_id=?').run(city.id,user.countryId);
  else await db.prepare('DELETE FROM countries WHERE id=?').run(user.countryId);
  expect(await db.prepare('SELECT count(*)::int AS n FROM city_scene_snapshots_v1').get()).toEqual({n:0});
});
it('builds and persists even an internal city read inside one repeatable snapshot',async()=>{
  const{db,service,user,city}=await fixture(),prepare=db.prepare.bind(db),inside:boolean[]=[];
  vi.spyOn(db,'prepare').mockImplementation(query=>{
    if(query.includes('SELECT l.*,')||query.includes('INSERT INTO city_scene_snapshots_v1'))inside.push(isTransactionActive());
    return prepare(query);
  });
  await service.getCityScene(user.countryId,city.id);
  expect(inside.length).toBeGreaterThanOrEqual(2);expect(inside.every(Boolean)).toBe(true);
});
it.each([0,-1,NaN,Infinity,Number.MAX_SAFE_INTEGER,CITY_SCENE_SNAPSHOT_LIMITS.rawBytes+1])('rejects invalid raw byte declaration %s before accessing the compressed blob',async rawBytes=>{
  const header={format_version:1,source_hash:'0'.repeat(64),raw_bytes:rawBytes};
  Object.defineProperty(header,'payload',{get(){throw new Error('Blob accessed before resource budget validation');}});
  const limitedDb={prepare:()=>({get:async()=>header})} as unknown as Db;
  await expect(new CitySceneSnapshotStore(limitedDb).read('country','city',1,64)).resolves.toBeUndefined();
});
