import { readFile,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

// Written only after both executables were successfully built. A failed or
// partial rebuild leaves a manifest whose hashes reject the mixed artifacts.
const {version:appVersion}=JSON.parse(await readFile('package.json','utf8'));
const {assetRevision}=JSON.parse(await readFile('assets/pixel-city-pack/manifest.json','utf8'));
if(typeof appVersion!=='string'||!/^[a-f0-9]{16}$/.test(assetRevision))throw new Error('Invalid runtime build identity');
const files={};
for(const name of ['server.mjs','synchronize-city-scenes.mjs'])
  files[name]=createHash('sha256').update(await readFile(join('dist',name))).digest('hex');
await writeFile('dist/runtime-build.json',JSON.stringify({formatVersion:1,appVersion,assetRevision,files})+'\n');
