import { createHash } from 'node:crypto';
import { createDb,transaction } from './db';
import { previewCountryRoads,readCountryRoads,synchronizeCountryRoads,type CountryRoadSnapshot } from './world/intercity-road-store';

const summary = (snapshot: CountryRoadSnapshot | undefined) => snapshot ? {
  revision:snapshot.revision,plannerVersion:snapshot.plan.plannerVersion??null,routes:snapshot.plan.routes.length,
  components:snapshot.plan.components.length,unreachable:snapshot.plan.unreachable,
} : null;

/** Offline, explicit-country upgrade. Ordinary map reads never plan roads. */
async function main() {
  const args = process.argv.slice(2),countryId = args[1];
  if (args[0]!=='--country' || !countryId || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(countryId)
    || args.length!==2 && (args.length!==3 || args[2]!=='--write')) throw new Error('Usage: synchronize-roads --country UUID [--write]');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const write = args[2]==='--write';
  const db = await createDb(process.env.DATABASE_URL,{maxConnections:1,migrate:false});
  try {
    const report = await transaction(db,async () => {
      if (!await db.prepare('SELECT id FROM countries WHERE id=? FOR UPDATE').get(countryId)) throw new Error('Country not found');
      const before = await readCountryRoads(db,countryId);
      const after = await (write ? synchronizeCountryRoads(db,countryId) : previewCountryRoads(db,countryId));
      const changed = before?.revision!==after.revision;
      if (write && changed) {
        await db.prepare('UPDATE countries SET world_version=world_version+1 WHERE id=?').run(countryId);
        await db.prepare('DELETE FROM country_overview_snapshots_v1 WHERE country_id=?').run(countryId);
        await db.prepare('DELETE FROM world_chunk_payloads_v1 WHERE country_id=?').run(countryId);
      }
      return {event:'roads.synchronization',mode:write?'write':'dry-run',countryId,changed,
        before:summary(before),after:summary(after),metrics:after.plan.metrics,
        // JSONB preserves values and array order, but reorders object keys.
        // A preview and a persisted route must have the same receipt hash.
        checksum:createHash('sha256').update(JSON.stringify(after.plan.routes,(_key,value:unknown) =>
          value && typeof value==='object' && !Array.isArray(value)
            ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0)) : value)).digest('hex')};
    });
    console.log(JSON.stringify(report));
  } finally {await db.close();}
}
main().catch(error => {console.error(error instanceof Error?error.message:'Road synchronization failed');process.exitCode=1;});
