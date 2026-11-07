import { createHash,randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { zstdCompress,zstdDecompress } from 'node:zlib';
import type { Db } from '../db';
import { APP_VERSION } from '../version';
import { ASSET_REVISION } from '../../shared/catalog';
import { CITY_SCENE_SCHEMA_VERSION,type CitySceneDto } from '../../shared/city-scene-contract';
import { CITY_SCENE_MAX_CHUNKS } from '../../shared/city-capacity';
import { decodeCitySceneWire,encodeCitySceneWire } from '../../shared/city-scene-wire';

export const CITY_SCENE_SNAPSHOT_LIMITS=Object.freeze({rawBytes:128*1024*1024,compressedBytes:64*1024*1024});
const compress=promisify(zstdCompress),decompress=promisify(zstdDecompress);
const digest=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const sourceNamespace=randomUUID();
let buildKeyPromise:Promise<string|undefined>|undefined;
/** All compiled executables identify the same server artifact. A CLI's own
 * bundle hash would create a different namespace and could never warm web.
 * Unbundled source instances intentionally share only this process namespace. */
export function citySceneSnapshotBuildKey():Promise<string|undefined>{
  return buildKeyPromise??=(async()=>{
    let source:string=sourceNamespace;
    if(process.env.NODE_ENV==='production'){
      if(!import.meta.url.endsWith('.mjs'))return undefined;
      try{
        const bytes=await readFile(join(process.cwd(),'dist/runtime-build.json'));
        if(bytes.byteLength>4096)return undefined;
        const manifest=JSON.parse(bytes.toString('utf8')) as {formatVersion?:unknown;appVersion?:unknown;assetRevision?:unknown;files?:Record<string,unknown>};
        const self=basename(fileURLToPath(import.meta.url));
        if(manifest.formatVersion!==1||manifest.appVersion!==APP_VERSION||manifest.assetRevision!==ASSET_REVISION
          ||!['server.mjs','synchronize-city-scenes.mjs'].includes(self)
          ||typeof manifest.files?.[self]!=='string'||typeof manifest.files?.['server.mjs']!=='string')return undefined;
        const server=await readFile(join(process.cwd(),'dist/server.mjs')),current=await readFile(fileURLToPath(import.meta.url));
        if(digest(server)!==manifest.files['server.mjs']||digest(current)!==manifest.files[self])return undefined;
        // The manifest binds both producers. Verify the CLI too, so a stale
        // command cannot label a scene with the new server's fingerprint.
        const cli=await readFile(join(process.cwd(),'dist/synchronize-city-scenes.mjs'));
        if(digest(cli)!==manifest.files['synchronize-city-scenes.mjs'])return undefined;
        source=digest(bytes);
      }catch{return undefined;} // Unidentified/mixed artifacts cannot reuse a blob.
    }
    return digest(`${APP_VERSION}:${ASSET_REVISION}:${CITY_SCENE_SCHEMA_VERSION}:compact1:${source}`);
  })();
}

/** Private, versioned, disposable base scene. Viewer ACLs and personal
 * connections are always resolved by AppService after their normal checks. */
export class CitySceneSnapshotStore {
  constructor(private readonly db:Db,private readonly options:{read?:boolean;write?:boolean}={}){}
  async read(countryId:string,cityId:string,worldVersion:number,chunkSize:number):Promise<CitySceneDto|undefined>{
    if(this.options.read===false)return;
    const buildKey=await citySceneSnapshotBuildKey();if(!buildKey)return;
    const row=await this.db.prepare(`SELECT s.format_version,s.source_hash,s.raw_bytes,s.payload FROM city_scene_snapshots_v1 s
      JOIN cities_v3 c ON c.id=s.city_id AND c.country_id=s.country_id
      WHERE s.city_id=? AND s.country_id=? AND s.world_version=? AND s.build_key=?`)
      .get<{format_version:number;source_hash:string;raw_bytes:number;payload:Uint8Array}>(cityId,countryId,worldVersion,buildKey);
    if(!row||row.format_version!==1||!Number.isSafeInteger(row.raw_bytes)||row.raw_bytes<1
      ||row.raw_bytes>CITY_SCENE_SNAPSHOT_LIMITS.rawBytes||!(row.payload instanceof Uint8Array)
      ||row.payload.byteLength<1||row.payload.byteLength>CITY_SCENE_SNAPSHOT_LIMITS.compressedBytes)return;
    try{
      const raw=await decompress(row.payload,{maxOutputLength:row.raw_bytes});
      if(raw.byteLength!==row.raw_bytes||digest(raw)!==row.source_hash)return;
      const scene=decodeCitySceneWire(JSON.parse(raw.toString('utf8')));
      if(scene.schemaVersion!==CITY_SCENE_SCHEMA_VERSION||scene.city?.id!==cityId
        ||scene.railConnections!==undefined||scene.seaConnections!==undefined
        ||scene.lod!=='DETAIL'||scene.chunkSize!==chunkSize
        ||!Array.isArray(scene.chunks)||scene.chunks.length>CITY_SCENE_MAX_CHUNKS
        ||scene.chunks.some(chunk=>chunk.publishedVersion!==worldVersion)
        ||!/^[a-f0-9]{64}$/.test(scene.sceneRevision))return;
      return scene;
    }catch{return undefined;} // A broken cache is never the source of truth.
  }
  async write(countryId:string,cityId:string,worldVersion:number,scene:CitySceneDto):Promise<void>{
    if(this.options.write===false)return;
    const buildKey=await citySceneSnapshotBuildKey();if(!buildKey)return;
    if(scene.city.id!==cityId||scene.schemaVersion!==CITY_SCENE_SCHEMA_VERSION||scene.chunks.length>CITY_SCENE_MAX_CHUNKS
      ||scene.railConnections!==undefined||scene.seaConnections!==undefined
      ||scene.chunks.some(chunk=>chunk.publishedVersion!==worldVersion))return;
    const raw=Buffer.from(JSON.stringify(encodeCitySceneWire(scene)));
    if(raw.byteLength>CITY_SCENE_SNAPSHOT_LIMITS.rawBytes)return;
    const payload=await compress(raw);if(payload.byteLength>CITY_SCENE_SNAPSHOT_LIMITS.compressedBytes)return;
    // Insert through the authoritative city owner, never a caller-supplied
    // country label. An older MVCC reader cannot overwrite a newer snapshot.
    await this.db.prepare(`INSERT INTO city_scene_snapshots_v1(city_id,country_id,world_version,build_key,source_hash,raw_bytes,payload)
      SELECT c.id,c.country_id,?,?,?,?,? FROM cities_v3 c WHERE c.id=? AND c.country_id=?
      ON CONFLICT(city_id) DO UPDATE SET country_id=excluded.country_id,world_version=excluded.world_version,
        build_key=excluded.build_key,source_hash=excluded.source_hash,raw_bytes=excluded.raw_bytes,
        payload=excluded.payload,updated_at=transaction_timestamp()
      WHERE city_scene_snapshots_v1.world_version<=excluded.world_version`)
      .run(worldVersion,buildKey,digest(raw),raw.byteLength,payload,cityId,countryId);
  }
}
