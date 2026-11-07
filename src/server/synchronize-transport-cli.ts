import { createDb,transaction } from "./db";
import { freezeMissingCountryAirports,readCountryAirportSites } from "./world/city-airport-site-store";
import { readCountryTransportNetworks,synchronizeCountryTransportNetworks } from "./world/country-transport-network-store";
import { freezeMissingCountryRailways, readActiveBlockLayouts } from "./world/active-block-layout";
import { freezeMissingCountryTransitStops, previewCityTransitStops, readCountryTransitStopPlans } from './world/city-transit-stop-store';
import { createHash } from 'node:crypto';
/** Explicit administrative conversion. Default mode reports derived geometry;
 * --write freezes it under the same country lock as normal topology changes. */
async function main(){
 const args=process.argv.slice(2),index=args.indexOf("--country"),countryId=args[index+1];
 if(index<0||!countryId||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(countryId)||args.some((arg,i)=>i!==index+1&&!['--country','--write'].includes(arg)))throw new Error("Usage: synchronize-transport --country UUID [--write]");
 if(!process.env.DATABASE_URL)throw new Error("DATABASE_URL is not set");
 const db=await createDb(process.env.DATABASE_URL,{maxConnections:1,migrate:false});
 try{
  await transaction(db,async()=>{
   if(!await db.prepare("SELECT id FROM countries WHERE id=? FOR UPDATE").get(countryId))throw new Error("Country not found");
   const before=await readCountryTransportNetworks(db,countryId),sites=await readCountryAirportSites(db,countryId);
   const stopPlansBefore = await readCountryTransitStopPlans(db,countryId);
   let changedStopPlans = 0;
   const missing=await db.prepare(`SELECT count(*) AS total FROM city_layouts_v1 l JOIN task_placements_v1 p ON p.layout_id=l.id JOIN city_blocks_v1 b ON b.id=p.block_id
     LEFT JOIN city_airport_sites_v1 a ON a.layout_id=l.id AND a.task_id=p.task_id WHERE l.country_id=? AND l.status='ACTIVE'
     AND b.parameters_json->'slotRoles'->>p.slot_key='AIRPORT' AND a.task_id IS NULL`).get<{total:number}>(countryId);
   const missingRailways=await db.prepare(`SELECT count(DISTINCT l.id) AS total FROM city_layouts_v1 l
     JOIN task_placements_v1 p ON p.layout_id=l.id JOIN city_blocks_v1 b ON b.id=p.block_id
     LEFT JOIN city_railway_corridors_v1 r ON r.layout_id=l.id WHERE l.country_id=? AND l.status='ACTIVE'
     AND b.parameters_json->'slotRoles'->>p.slot_key='RAILWAY' AND r.layout_id IS NULL`).get<{total:number}>(countryId);
   if(args.includes('--write')){
    await freezeMissingCountryAirports(db,countryId);await freezeMissingCountryRailways(db,countryId);
    changedStopPlans = await freezeMissingCountryTransitStops(db,countryId);
    const changed=await synchronizeCountryTransportNetworks(db,countryId,before);
    const remainingRailways=await db.prepare(`SELECT count(DISTINCT l.id) AS total FROM city_layouts_v1 l
      JOIN task_placements_v1 p ON p.layout_id=l.id JOIN city_blocks_v1 b ON b.id=p.block_id
      LEFT JOIN city_railway_corridors_v1 r ON r.layout_id=l.id WHERE l.country_id=? AND l.status='ACTIVE'
      AND b.parameters_json->'slotRoles'->>p.slot_key='RAILWAY' AND r.layout_id IS NULL`).get<{total:number}>(countryId);
    if(changed||changedStopPlans>0||Number(missing?.total)>0||Number(remainingRailways?.total)<Number(missingRailways?.total)){
     await db.prepare("UPDATE countries SET world_version=world_version+1 WHERE id=?").run(countryId);
     await db.prepare("DELETE FROM country_overview_snapshots_v1 WHERE country_id=?").run(countryId);
     // Offline administrative conversion has no task event to invalidate the
     // previous published pages. Never carry their old features forward.
     await db.prepare('DELETE FROM world_chunk_payloads_v1 WHERE country_id=?').run(countryId);
    }
   }
   const layouts = await db.prepare("SELECT city_id FROM city_layouts_v1 WHERE country_id=? AND status='ACTIVE' ORDER BY city_id").all<{city_id:string}>(countryId);
   const stopPlans = args.includes('--write') ? await readCountryTransitStopPlans(db,countryId) : [];
   if (!args.includes('--write')) for (const layout of await readActiveBlockLayouts(db,layouts.map(row=>row.city_id))) stopPlans.push(await previewCityTransitStops(db,layout));
   const stopSummary = { readyBefore: stopPlansBefore.length,readyAfter: args.includes('--write')?stopPlans.length:stopPlansBefore.length,
    cities: layouts.length,previewPlans: stopPlans.length,stops: stopPlans.reduce((n,plan)=>n+plan.stops.length,0),changedPlans:changedStopPlans,
    checksum:createHash('sha256').update(JSON.stringify(stopPlans.map(plan=>({layoutId:plan.layoutId,blocks:plan.processedBlockIds,stops:plan.stops})).sort((a,b)=>a.layoutId.localeCompare(b.layoutId)))).digest('hex') };
   console.log(JSON.stringify({event:"transport.synchronization",mode:args.includes('--write')?'write':'dry-run',countryId,transitStops:stopSummary,missingAirports:Number(missing?.total),missingRailways:Number(missingRailways?.total),airports:[...sites.values()].flat().map(site=>({taskId:site.taskId,ready:site.stage===5&&Boolean(site.plan),reason:site.reason})),network:await readCountryTransportNetworks(db,countryId)}));
  });
 }finally{await db.close();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:"Transport synchronization failed");process.exitCode=1;});
