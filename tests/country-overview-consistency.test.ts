import { expect,it,vi } from "vitest";
import { createTestDb, transaction } from "../src/server/db";
import { registerUser } from "../src/server/auth";
import { AppService } from "../src/server/app-service";

it("reads country labels, miniature data and personal geography from one snapshot during a concurrent city rename",async()=>{
  const db=await createTestDb();let release=()=>{};
  try{
    const {user}=await registerUser(db,{email:"country-snapshot@example.test",name:"Snapshot",password:"password123"});
    const service=new AppService(db),writer=new AppService(db);
    const city=await service.createCity(user.countryId,{name:"До изменения",idempotencyKey:"snapshot-city"});
    const baseline=await service.getPlanetAtlas(user.id);
    let reached=()=>{};
    const gate=new Promise<void>(resolve=>{reached=resolve;}),resume=new Promise<void>(resolve=>{release=resolve;});
    const read=service.getPlanetAtlas.bind(service);
    const reads:Awaited<ReturnType<typeof service.getPlanetAtlas>>[]=[];
    const spy=vi.spyOn(service,"getPlanetAtlas").mockImplementation(async id=>{
      const atlas=await read(id);reads.push(atlas);
      if(reads.length===1){reached();await resume;}
      return atlas;
    });
    // This continuation is created outside the reader's AsyncLocalStorage scope.
    const mutation=(async()=>{await gate;try{await writer.renameCity(user.countryId,{cityId:city.id,name:"После изменения",idempotencyKey:"snapshot-rename"});}finally{release();}})();
    const before=await service.getCountryOverview(user.id,user.countryId);await mutation;spy.mockRestore();
    const beforeVersion=baseline.countries.find(c=>c.id===user.countryId)!.worldVersion;
    const usedVersion=reads.at(-1)!.countries.find(c=>c.id===user.countryId)!.worldVersion;
    // PostgreSQL may retry a serialization conflict when inserting the cache
    // row after the country FK changes. Both wholly-old and wholly-new are valid.
    expect(before.cities.find(c=>c.id===city.id)!.name).toBe(usedVersion===beforeVersion?"До изменения":"После изменения");
    const after=await service.getCountryOverview(user.id,user.countryId);
    expect(after.cities.find(c=>c.id===city.id)!.name).toBe("После изменения");
    if(usedVersion===beforeVersion)expect(after.revision).not.toBe(before.revision);
    else expect(after.revision).toBe(before.revision);
    expect(after.cities.find(c=>c.id===city.id)!.atlasCenter).toEqual(before.cities.find(c=>c.id===city.id)!.atlasCenter);
  }finally{release();vi.restoreAllMocks();await db.close();}
},15000);


it("does not publish rolled-back country or city scenes into process caches", async () => {
  const db = await createTestDb();
  try {
    const { user } = await registerUser(db, { email: "snapshot-rollback@example.test", name: "Rollback", password: "password123" });
    const service = new AppService(db);
    const city = await service.createCity(user.countryId, { name: "Initial", idempotencyKey: "rollback-city" });
    const initial = await service.getCountryOverview(user.id, user.countryId);
    const stored = await db.prepare("SELECT geography_json FROM personal_planet_geography_v1 WHERE user_id=?").get(user.id);
    await expect(transaction(db, async () => {
      await service.renameCity(user.countryId, { cityId: city.id, name: "Never committed", idempotencyKey: "rollback-rename" });
      expect((await service.getCountryOverview(user.id, user.countryId)).cities.find(c => c.id === city.id)!.name).toBe("Never committed");
      expect((await service.getCitySceneForUser(user.id, user.countryId, city.id)).city.name).toBe("Never committed");
      await service.createCity(user.countryId, { name: "Transient anchor", idempotencyKey: "rollback-anchor" });
      await service.getPlanetAtlas(user.id);
      throw new Error("abort read model");
    })).rejects.toThrow("abort read model");
    expect(await db.prepare("SELECT geography_json FROM personal_planet_geography_v1 WHERE user_id=?").get(user.id)).toEqual(stored);
    expect((await service.getCountryOverview(user.id, user.countryId)).revision).toBe(initial.revision);
    // Reuse the aborted world_version with different committed data. A leaked
    // cache entry would now expose the title from the aborted transaction.
    await service.renameCity(user.countryId, { cityId: city.id, name: "Committed", idempotencyKey: "committed-rename" });
    expect((await service.getCitySceneForUser(user.id, user.countryId, city.id)).city.name).toBe("Committed");
    expect((await service.getCountryOverview(user.id, user.countryId)).cities.find(c => c.id === city.id)!.name).toBe("Committed");
  } finally { await db.close(); }
}, 15000);

it("restarts the whole city snapshot when a committed event invalidates its chunk build",async()=>{
  const db=await createTestDb();let release=()=>{};
  try{
    const {user}=await registerUser(db,{email:"city-snapshot-stale@example.test",name:"Stale",password:"password123"});
    const reader=new AppService(db),writer=new AppService(db,event=>reader.acceptExternalEvent(event));
    const city=await writer.createCity(user.countryId,{name:"Concurrent city",idempotencyKey:"stale-city"});
    const district=await writer.createDistrict(user.countryId,{cityId:city.id,name:"Concurrent district",activate:false,idempotencyKey:"stale-district"});
    await writer.activateDistrict(user.countryId,district.id,"stale-activate");
    const task=await writer.createTask(user.countryId,{cityId:city.id,districtId:district.id,title:"Concurrent task",estimate:1,idempotencyKey:"stale-task"});
    let reached=()=>{};
    const gate=new Promise<void>(resolve=>{reached=resolve;}),resume=new Promise<void>(resolve=>{release=resolve;});
    const original=reader.getViewportPayloads.bind(reader);let reads=0;
    vi.spyOn(reader,"getViewportPayloads").mockImplementation(async(...args)=>{
      if(++reads===1){reached();await resume;}
      return original(...args);
    });
    const mutation=(async()=>{await gate;try{
      await writer.updateTaskStatus(user.countryId,{taskId:task.id,status:"STARTED",comment:"Concurrent commit",idempotencyKey:"stale-start"});
    }finally{release();}})();
    const scene=await reader.getCitySceneForUser(user.id,user.countryId,city.id);await mutation;
    expect(reads).toBeGreaterThan(1);
    expect(scene.chunks.flatMap(c=>c.tasks).find(t=>t.id===task.id)?.status).toBe("STARTED");
  }finally{release();vi.restoreAllMocks();await db.close();}
},15000);

it("does not retain speculative task payloads or version fences after a caller rollback",async()=>{
  const db=await createTestDb();
  try{
    const {user}=await registerUser(db,{email:"chunk-rollback@example.test",name:"Rollback chunks",password:"password123"});
    const service=new AppService(db);
    const city=await service.createCity(user.countryId,{name:"Rollback city",idempotencyKey:"chunk-city"});
    const district=await service.createDistrict(user.countryId,{cityId:city.id,name:"Rollback district",activate:false,idempotencyKey:"chunk-district"});
    await service.activateDistrict(user.countryId,district.id,"chunk-activate");
    const task=await service.createTask(user.countryId,{cityId:city.id,districtId:district.id,title:"Original task",estimate:1,idempotencyKey:"chunk-task"});
    await expect(transaction(db,async()=>{
      await service.updateTaskStatus(user.countryId,{taskId:task.id,status:"STARTED",comment:"Never committed",idempotencyKey:"chunk-start"});
      const speculative=await service.getCitySceneForUser(user.id,user.countryId,city.id);
      expect(speculative.chunks.flatMap(c=>c.tasks).find(t=>t.id===task.id)?.status).toBe("STARTED");
      throw new Error("abort task");
    })).rejects.toThrow("abort task");
    const restored=await service.getCitySceneForUser(user.id,user.countryId,city.id);
    expect(restored.chunks.flatMap(c=>c.tasks).find(t=>t.id===task.id)?.status).toBe("PLANNING");
  }finally{await db.close();}
},15000);
