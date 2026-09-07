import { describe, expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createTestDb } from "../src/server/db";
import { readActiveBlockLayout, synchronizeCityBlocks } from "../src/server/world/active-block-layout";
import { blockSlots } from "../src/shared/block-templates";
import { getBuilding } from "../src/shared/catalog";
import { randomUUID } from "node:crypto";
import { compileBlockLayout } from "../src/server/world/block-layout-compiler";
import { activateBlockLayout, persistReadyBlockLayout } from "../src/server/world/block-layout-store";
import type { CityBlockV1 } from "../src/shared/block-world";
import { compactServiceFamily } from "../src/shared/compact-building-families";

describe("authored service family live storage projection",()=>{
  it("keeps the sixteenth FIRE role on a fitting generic parcel when compatible art cannot fit", async () => {
    const db = await createTestDb();
    try {
      let service = new AppService(db);
      const { countryId } = (await registerUser(db, {
        email: "fire-fallback@example.test", name: "Fire fallback", password: "password123",
      })).user;
      await db.prepare("UPDATE countries SET seed=424242 WHERE id=?").run(countryId);
      const city = await service.createCity(countryId, { name: "Fallback city", idempotencyKey: "city" });
      const district = await service.createDistrict(countryId, { cityId: city.id, name: "Fallback sprint", activate: true, idempotencyKey: "sprint" });
      const empty = (await readActiveBlockLayout(db, city.id))!;
      expect(empty.blocks).toEqual([]);expect(empty.placements).toEqual([]);expect(empty.siteMarkers).toEqual([]);
      // Install an accepted stored V3 plan in this isolated EMPTY layout. No
      // task geometry is rewritten and no seed/catalogue lottery chooses the
      // fallback parcel. Subsequent allocation and transfer use real services.
      const previous=structuredClone(empty);
      previous.blocks=[0,1].map((sequence):CityBlockV1=>({id:randomUUID(),districtLayoutId:previous.districtLayouts[0]!.id,
        sequence,kind:"RESIDENTIAL",templateKey:"residential-court",templateVersion:3,variant:"south",seed:17,
        origin:{x:city.center.x+sequence*32,y:city.center.y},width:32,height:32,summary:{},
        parameters:{sitePlan:{version:1,parcels:Array.from({length:9},(_,i)=>({x:3+Math.floor(i/3)*9,y:3+i%3*9,
          width:6,height:i===8?4:6,clearance:1,kind:"BUILDING",family:i===8?"compact-wide-v1":"compact-apartment-v1"}))}}}));
      for(const block of previous.blocks) for(const slot of blockSlots(block)) if(slot.footprint.length===24) {
        previous.siteMarkers.push({id:randomUUID(),blockId:block.id,slotKey:slot.key,kind:"RUINED",assetVariant:"brick",
          snapshot:{title:"Permanent old wide site",taskNumber:100+block.sequence,buildingFamily:"compact-wide-v1",lastStage:5}});
      }
      const pinned=compileBlockLayout({countryId,cityId:city.id,seed:424242,origin:city.center,revision:empty.revision+1,previous,
        districts:[{id:district.id,archetype:empty.districtLayouts[0]!.archetype,sequence:0,tasks:[]}]});
      await db.prepare("DELETE FROM city_layouts_v1 WHERE id=?").run(empty.id);
      const timestamp=new Date().toISOString();
      await persistReadyBlockLayout(db,pinned,timestamp);await activateBlockLayout(db,pinned.id,timestamp);
      await db.prepare("UPDATE cities_v3 SET bounds_json=?::jsonb WHERE id=?").run(JSON.stringify(pinned.bounds),city.id);
      const reloaded=(await readActiveBlockLayout(db,city.id))!;
      expect(reloaded.blocks.map(block=>block.parameters.sitePlan)).toEqual(pinned.blocks.map(block=>block.parameters.sitePlan));
      expect(reloaded.siteMarkers).toHaveLength(2);
      service=new AppService(db);
      for (let n = 1; n <= 15; n++) await service.createTask(countryId, { cityId: city.id, districtId: district.id,
        title: `Work ${n}`, estimate: 1, visualKind: "BUILDING", idempotencyKey: `work-${n}` });
      const before = (await readActiveBlockLayout(db, city.id))!;
      expect(before.blocks).toHaveLength(pinned.blocks.length);
      expect(before.siteMarkers).toEqual(reloaded.siteMarkers);
      const occupied = new Set([...before.placements,...before.siteMarkers].map(p => `${p.blockId}:${p.slotKey}`));
      const available = before.blocks.flatMap(block => blockSlots(block).map(slot => ({ block, slot })))
        .filter(({block,slot})=>slot.kind==="BUILDING"&&!occupied.has(`${block.id}:${slot.key}`));
      expect(available).toHaveLength(1);
      const reservation = available[0]!;
      expect(reservation.slot.serviceRole).toBe("FIRE");
      expect(reservation.slot.footprint).toHaveLength(36);
      expect(reservation.slot.footprint).not.toHaveLength(24);
      expect(compactServiceFamily("FIRE",6,6)).toBeUndefined();
      const fire = await service.createTask(countryId, { cityId: city.id, districtId: district.id,
        title: "Work 16", estimate: 1, visualKind: "BUILDING", idempotencyKey: "work-16" });
      expect(fire.serviceRole).toBe("FIRE");
      expect(fire.buildingType).not.toBe("compact-fire-station-v1");
      expect(fire.footprint).toEqual(reservation.slot.footprint);
      const shape = getBuilding(fire.buildingType).footprint;
      expect(fire.footprint).toHaveLength(shape.width * shape.height);
      const after=(await readActiveBlockLayout(db,city.id))!;
      expect(after.blocks).toHaveLength(before.blocks.length);
      expect(after.siteMarkers).toEqual(before.siteMarkers);
      for(const old of before.placements) expect(after.placements.find(p=>p.taskId===old.taskId)).toEqual(old);
      for(const block of before.blocks) {
        const stored=after.blocks.find(b=>b.id===block.id)!;
        expect({origin:stored.origin,width:stored.width,height:stored.height,sitePlan:stored.parameters.sitePlan})
          .toEqual({origin:block.origin,width:block.width,height:block.height,sitePlan:block.parameters.sitePlan});
      }
      const target = await service.createDistrict(countryId, { cityId: city.id, name: "Next sprint", idempotencyKey: "next" });
      const moved = await service.transferTask(countryId, { taskId: fire.id, targetDistrictId: target.id, idempotencyKey: "move" });
      expect(moved).toMatchObject({ buildingType: fire.buildingType, serviceRole: "FIRE" });
      expect(moved.footprint).toHaveLength(fire.footprint.length);
    } finally { await db.close(); }
  }, 30_000);

  it("persists explicitly requested FIRE art geometry across stage updates, fresh readers, transfer and permanent ruins",async()=>{
    const db=await createTestDb();
    try {
      const service=new AppService(db),{countryId}=(await registerUser(db,{email:"fire-family@example.test",name:"Fire family",password:"password123"})).user;
      await db.prepare("UPDATE countries SET seed=424242 WHERE id=?").run(countryId);
      const city=await service.createCity(countryId,{name:"Fire city",idempotencyKey:"city"});
      const district=await service.createDistrict(countryId,{cityId:city.id,name:"Fire sprint",activate:true,idempotencyKey:"sprint"});
      const fire=await service.createTask(countryId,{cityId:city.id,districtId:district.id,title:"Explicit fire art",estimate:1,
        visualKind:"BUILDING",buildingHint:"compact-fire-station-v1",idempotencyKey:"explicit-fire"});
      // Explicit art is not a shortcut through the business service thresholds.
      expect(fire.serviceRole).toBeUndefined();expect(fire.buildingType).toBe("compact-fire-station-v1");
      expect(fire!.footprint).toHaveLength(24); expect(getBuilding(fire!.buildingType).footprint).toEqual({width:6,height:4});
      const layout=(await readActiveBlockLayout(db,city.id))!,placement=layout.placements.find(p=>p.taskId===fire!.id)!,block=layout.blocks.find(b=>b.id===placement.blockId)!;
      expect(block.parameters.sitePlan).toMatchObject({version:1,parcels:expect.any(Array)});
      const persistedPlan=structuredClone(block.parameters.sitePlan);
      expect(block.parameters.slotFamilies).toMatchObject({[placement.slotKey]:fire!.buildingType});
      expect(blockSlots(block).find(s=>s.key===placement.slotKey)!.buildingFamily).toBe(fire!.buildingType);
      const started=await service.updateTaskStatus(countryId,{taskId:fire!.id,status:"STARTED",idempotencyKey:"start-fire"});
      expect(started).toMatchObject({origin:fire!.origin,footprint:fire!.footprint,buildingType:fire!.buildingType,stage:2});
      expect((await new AppService(db).getTask(countryId,fire!.id)).buildingType).toBe(fire!.buildingType);
      expect((await readActiveBlockLayout(db,city.id))!.blocks.find(b=>b.id===block.id)!.parameters.sitePlan).toEqual(persistedPlan);
      const target=await service.createDistrict(countryId,{cityId:city.id,name:"Next sprint",idempotencyKey:"target-sprint"});
      const moved=await service.transferTask(countryId,{taskId:fire!.id,targetDistrictId:target.id,idempotencyKey:"move-fire"});
      expect(moved).toMatchObject({buildingType:fire!.buildingType,stage:2});
      expect(moved.serviceRole).toBeUndefined();
      expect(moved.footprint).toHaveLength(24);
      const marker=(await service.listWorldFeatures(countryId))[0]!;
      expect(marker).toMatchObject({footprint:fire!.footprint,siteMarker:{snapshot:{buildingFamily:fire!.buildingType}}});
      await synchronizeCityBlocks(db,countryId,city.id,true);
      expect((await new AppService(db).getTask(countryId,fire!.id)).buildingType).toBe(fire!.buildingType);
      expect((await service.listWorldFeatures(countryId))[0]).toEqual(marker);
    } finally {await db.close();}
  },30_000);
});
