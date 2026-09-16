import { createCountry, registerUser } from "../../src/server/auth";
import { AppService } from "../../src/server/app-service";
import type { Db } from "../../src/server/db";
import type { PersonalPlanetGeography } from "../../src/shared/planet-geography";

/** Real isolated tasks; only private geography is pinned to two eligible coasts. */
export async function coastalPortPair(db: Db, populate = true) {
  const {user}=await registerUser(db,{email:`sea-pair-${crypto.randomUUID()}@example.test`,name:"Мореплаватель",password:"password123"});
  const service=new AppService(db),sites=[];
  for(let i=0;i<2;i++){
    const countryId=await createCountry(db,user.id,`Берег ${i+1}`,{version:1,kind:"EAST_COAST",coastX:128});
    await db.prepare("UPDATE countries SET seed=123 WHERE id=?").run(countryId);
    const city=await service.createCity(countryId,{name:`Портовый ${i+1}`,idempotencyKey:`city-${i}`});
    const district=await service.createDistrict(countryId,{cityId:city.id,name:"Причал",activate:true,idempotencyKey:`district-${i}`});
    sites.push({countryId,city,district});
  }
  await service.getPlanetAtlas(user.id);
  const stored=(await db.prepare("SELECT geography_json FROM personal_planet_geography_v1 WHERE user_id=?").get<{geography_json:PersonalPlanetGeography}>(user.id))!.geography_json;
  const pinned:PersonalPlanetGeography={...stored,countries:{},coastCells:[],coastOwners:{}};
  sites.forEach((site,index)=>{
    const q0=10+index*20,r0=10;
    const cells=Array.from({length:9},(_,i)=>({q:q0+i%3,r:r0+Math.floor(i/3),id:`land-${index}-${i}`,terrain:"grass" as const}));
    const coastCells=Array.from({length:25},(_,i)=>({q:q0-1+i%5,r:r0-1+Math.floor(i/5),id:`coast-${index}-${i}`,terrain:"coast" as const})).filter(c=>c.q===q0-1||c.q===q0+3||c.r===r0-1||c.r===r0+3);
    pinned.countries[site.countryId]={...stored.countries[site.countryId]!,sector:0,continent:index,cells,center:{x:(q0+1.5)*stored.hexRadius*2,y:(r0+1.5)*stored.hexRadius*2},
      cities:{[site.city.id]:{sourceCenter:site.city.center,point:{x:(q0+1.5)*8,y:(r0+1.5)*8}}}};
    pinned.coastCells.push(...coastCells);
    for(const cell of coastCells)pinned.coastOwners[cell.id]=[site.countryId];
  });
  await db.prepare("UPDATE personal_planet_geography_v1 SET geography_json=?::jsonb WHERE user_id=?").run(JSON.stringify(pinned),user.id);
  const ports=[];
  for(const site of populate ? sites : []){
    const port=await service.createTask(site.countryId,{cityId:site.city.id,districtId:site.district.id,title:"Морской порт",estimate:1,buildingHint:"compact-port-v1",idempotencyKey:`port-${site.countryId}`});
    for(const status of ["STARTED","IN_PROGRESS","TESTING","COMPLETED"] as const)
      await service.updateTaskStatus(site.countryId,{taskId:port.id,status,comment:"Открытие навигации",idempotencyKey:`${port.id}-${status}`});
    ports.push({...site,port});
  }
  return {user,service,ports,sites};
}
