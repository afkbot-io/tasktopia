import { createDb } from './db';
import { AppService } from './app-service';
import { CitySceneSnapshotStore,citySceneSnapshotBuildKey } from './world/city-scene-snapshot-store';

const usage='Usage: synchronize-city-scenes --country UUID [--city UUID] [--write]';
const uuid=(value:string|undefined):value is string=>!!value&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
type Saved={world_version:string;build_key:string;raw_bytes:number;compressed_bytes:number};
/** Offline derived-view preparation only. No regeneration, business mutation,
 * user impersonation or personal transport projection. Each city uses the
 * same MVCC base-scene reader as web, with a finite process LRU. */
async function main(){
  const args=process.argv.slice(2),countryId=args[1];
  if(args[0]!=='--country'||!uuid(countryId))throw new Error(usage);
  let rest=args.slice(2),cityId:string|undefined;
  if(rest[0]==='--city'){
    if(!uuid(rest[1]))throw new Error(usage);cityId=rest[1];rest=rest.slice(2);
  }
  const write=rest[0]==='--write';if(write)rest=rest.slice(1);
  if(rest.length)throw new Error(usage);
  if(process.env.NODE_ENV!=='production'||!import.meta.url.endsWith('.mjs'))
    throw new Error('Build first; use NODE_ENV=production node dist/synchronize-city-scenes.mjs');
  if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is not set');
  const buildKey=await citySceneSnapshotBuildKey();if(!buildKey)throw new Error('Exact runtime-build.json, server and scene CLI artifacts are required; rebuild together');
  const db=await createDb(process.env.DATABASE_URL,{maxConnections:1,migrate:false});
  try{
    if(!await db.prepare('SELECT id FROM countries WHERE id=?').get(countryId))throw new Error('Country not found');
    const parameters=cityId?[countryId,cityId]:[countryId];
    const cities=await db.prepare(`SELECT id FROM cities_v3 WHERE country_id=?${cityId?' AND id=?':''} ORDER BY id`)
      .all<{id:string}>(...parameters);
    if(cityId&&!cities.length)throw new Error('City not found in country');
    const store=new CitySceneSnapshotStore(db,{write});
    const service=new AppService(db,undefined,undefined,undefined,undefined,store);
    const rows=[];
    const saved=(id:string)=>db.prepare(`SELECT world_version,build_key,raw_bytes,
      octet_length(payload)::int AS compressed_bytes FROM city_scene_snapshots_v1 WHERE country_id=? AND city_id=?`)
      .get<Saved>(countryId,id);
    for(const city of cities){
      const builds=service.runtimeStats().caches.cityScenes.builds;
      const scene=await service.getCityScene(countryId,city.id),after=await saved(city.id);
      const constructed=service.runtimeStats().caches.cityScenes.builds-builds;
      const observedVersion=scene.chunks[0]?.publishedVersion;
      if(!Number.isSafeInteger(observedVersion))throw new Error('Invalid scene publication version');
      const verified=write&&constructed>0
        ? await store.read(countryId,city.id,observedVersion!,scene.chunkSize) : constructed===0?scene:undefined;
      const ready=!!after&&after.build_key===buildKey&&Number(after.world_version)===observedVersion
        &&verified?.sceneRevision===scene.sceneRevision;
      if(write&&!ready)throw new Error('Snapshot not published: scene exceeds limits or world changed; retry when stable');
      rows.push({cityId:city.id,sceneRevision:scene.sceneRevision,observedWorldVersion:observedVersion,
        chunks:scene.chunks.length,constructed,ready,wouldChange:constructed>0,
        changed:write&&constructed>0,
        rawBytes:ready?after!.raw_bytes:null,compressedBytes:ready?after!.compressed_bytes:null});
    }
    console.log(JSON.stringify({event:'city-scenes.synchronization',mode:write?'write':'dry-run',countryId,buildKey,
      cities:rows.length,ready:rows.filter(row=>row.ready).length,changed:rows.filter(row=>row.changed).length,rows}));
  }finally{await db.close();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'City scene preparation failed');process.exitCode=1;});
