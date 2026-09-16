/** Local-only reproducible M/L workloads. Geometry is authored solely by the
 * domain service. Direct status batching is fixture setup, not API coverage. */
import {mkdir,writeFile} from "node:fs/promises";
import {createDb,transaction} from "../src/server/db";
import {AppService} from "../src/server/app-service";
import {registerUser,loginUser,createCountry} from "../src/server/auth";
import {synchronizeCityBlocks} from "../src/server/world/active-block-layout";
import {CITY_LANDMARKS} from "../src/shared/city-landmarks";
const size=process.env.LIVING_WORLD_SIZE??"M";
if(!["M","L"].includes(size))throw new Error("Use M or L");
const spec=size==="M"?{tasks:300,districts:12,cities:6,countries:3}:{tasks:2000,districts:60,cities:20,countries:10};
const url=process.env.DATABASE_URL??"postgres://tasktopia:tasktopia@127.0.0.1:55432/tasktopia_test";
if(!["127.0.0.1","localhost","::1"].includes(new URL(url).hostname))throw new Error("Performance fixtures are local-only");
const db=await createDb(url),service=new AppService(db);
const email=`living-world-perf-${size.toLowerCase()}@tasktopia.local`,password="living-world-local-performance";
try{
 const existing=await db.prepare("SELECT id FROM users WHERE lower(email)=lower(?)").get(email);
 const {user}=existing?await loginUser(db,email,password):await registerUser(db,{email,password,name:`Performance ${size}`,countryName:`Living ${size} 0`});
 const countries=(await db.prepare("SELECT id,name FROM countries WHERE user_id=? ORDER BY name").all<{id:string;name:string}>(user.id));
 for(let i=countries.length;i<spec.countries;i++)countries.push({id:await createCountry(db,user.id,`Living ${size} ${i}`),name:`Living ${size} ${i}`});
 const report={size,spec,email,countryId:countries[0]!.id,cityId:"",cities:[] as {id:string;countryId:string;tasks:number;families:number;landmarks:number}[]};
 for(let n=0;n<spec.cities;n++){
  const country=countries[Math.floor(n/2)]!;await db.prepare("UPDATE countries SET seed=? WHERE id=?").run(987321+Math.floor(n/2)*100,country.id);
  const name=n===0?`Основной город ${size}`:`Город ${size} ${n}`;
  const city=(await service.listCities(country.id)).find(c=>c.name===name)??await service.createCity(country.id,{name,morphology:"DENSE_CORE",idempotencyKey:`perf-${size}-city-${n}`});
  if(n===0)report.cityId=city.id;
  const count=n===0?spec.tasks:24,districtCount=n===0?spec.districts:6;
  let ordinal=0;
  const existingCityTasks=await service.listTasks(country.id),landmarks=new Set(existingCityTasks.filter(t=>t.cityId===city.id).map(t=>t.buildingType));
  const pending=CITY_LANDMARKS.map(l=>l.family).filter(f=>!landmarks.has(f));
  for(let d=0;d<districtCount;d++){
   const title=`Район ${d+1}`;
   const district=(await service.listDistricts(country.id,city.id)).find(x=>x.name===title)??await service.createDistrict(country.id,{cityId:city.id,name:title,activate:false,archetype:"MIXED_URBAN",idempotencyKey:`perf-${size}-${n}-district-${d}`});
   const existingTasks=new Map((await service.listTasks(country.id,district.id)).map(t=>[t.title,t]));
   const districtTasks=Math.floor(count/districtCount)+(d<count%districtCount?1:0);
   for(let j=0;j<districtTasks;j++){
    ordinal++;const title=`Нагрузка ${n}.${ordinal}`;
    if(existingTasks.has(title))continue;
    const base={cityId:city.id,districtId:district.id,title,estimate:1 as const,creatorUserId:user.id,assigneeUserId:ordinal%3===0?user.id:undefined};
    let created;
    if(n===0&&pending.length){
     try{created=await service.createTask(country.id,{...base,buildingHint:pending[0],idempotencyKey:`perf-${size}-${n}-${ordinal}-landmark`});pending.shift();}
     catch(error){if(!["INFRASTRUCTURE_RESERVATION_CONFLICT","PLACEMENT_UNAVAILABLE"].includes(String((error as {code?:string}).code)))throw error;
      created=await service.createTask(country.id,{...base,idempotencyKey:`perf-${size}-${n}-${ordinal}-auto`});}
    }else created=await service.createTask(country.id,{...base,idempotencyKey:`perf-${size}-${n}-${ordinal}-auto`});
    const used=pending.indexOf(created.buildingType);if(used>=0)pending.splice(used,1);
    if(ordinal%50===0)console.log(JSON.stringify({size,city:n,tasks:ordinal}));
   }
  }
  const tasks=(await service.listTasks(country.id)).filter(t=>t.cityId===city.id).sort((a,b)=>a.taskNumber-b.taskNumber);
  await transaction(db,async()=>{
   for(let i=0;i<tasks.length;i++){
    const fraction=i/tasks.length,status=fraction<.8?"COMPLETED":fraction<.95?"IN_PROGRESS":fraction<.975?"TESTING":"PLANNING";
    await db.prepare("UPDATE tasks_v3 SET status=?,progress=? WHERE id=?").run(status,status==="COMPLETED"?100:status==="IN_PROGRESS"?50:status==="TESTING"?90:0,tasks[i]!.id);
   }
   await synchronizeCityBlocks(db,country.id,city.id);
   await db.prepare("UPDATE countries SET world_version=world_version+1 WHERE id=?").run(country.id);
  });
  const districts=await service.listDistricts(country.id,city.id);
  for(const district of districts){
   const members=tasks.filter(t=>t.districtId===district.id),last=tasks.indexOf(members.at(-1)!);
   if(last>=0&&last/tasks.length<.8&&district.status!=="COMPLETED"){
    await service.activateDistrict(country.id,district.id,`perf-${size}-${n}-${district.id}-active`);
    await service.completeDistrict(country.id,district.id,`perf-${size}-${n}-${district.id}-complete`);
   }
  }
  const active=tasks[Math.ceil(tasks.length*.8)]!;
  await service.activateDistrict(country.id,active.districtId,`perf-${size}-${n}-active-work`);
  if(n===0){
   const extra=await service.createTask(country.id,{cityId:city.id,districtId:active.districtId,title:"Исторический участок нагрузки",estimate:1,idempotencyKey:`perf-${size}-historical`});
   await service.deleteTask(country.id,{taskId:extra.id,confirmTitle:extra.title,idempotencyKey:`perf-${size}-historical-delete`});
   const moved=tasks.slice(Math.ceil(tasks.length*.8)).find(t=>!t.serviceRole&&!CITY_LANDMARKS.some(l=>l.family===t.buildingType))!;
   await service.transferTask(country.id,{taskId:moved.id,targetDistrictId:tasks.at(-1)!.districtId,idempotencyKey:`perf-${size}-historical-transfer`});
  }
  report.cities.push({id:city.id,countryId:country.id,tasks:tasks.length,families:new Set(tasks.map(t=>t.buildingType)).size,landmarks:new Set(tasks.map(t=>t.buildingType).filter(f=>CITY_LANDMARKS.some(l=>l.family===f))).size});
  console.log(JSON.stringify(report.cities.at(-1)));
 }
 await db.prepare("UPDATE users SET active_country_id=? WHERE id=?").run(report.countryId,user.id);
 await mkdir("tmp/living-world/performance",{recursive:true});
 await writeFile(`tmp/living-world/performance/fixture-${size}.json`,JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
}finally{await db.close();}
