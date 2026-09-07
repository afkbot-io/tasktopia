import fastifyCookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppService } from "../src/server/app-service";
import { inviteCountryMember, registerUser } from "../src/server/auth";
import { createTestDb, type Db } from "../src/server/db";
import { registerRoutes } from "../src/server/routes";
import type { TaskDto } from "../src/shared/contracts";

describe("authorized atomic sprint transfer HTTP contract", { timeout: 30_000 }, () => {
  let db: Db, app: FastifyInstance, service: AppService;
  let cookie: string, viewerCookie: string, countryId: string, targetDistrictId: string;
  let crossCityDistrictId: string, foreignDistrictId: string, foreignTaskId: string, task: TaskDto;
  beforeAll(async () => {
    db = await createTestDb(); service = new AppService(db);
    const owner = await registerUser(db, { email: "transfer-owner@example.test", name: "Owner", password: "password123" });
    const viewer = await registerUser(db, { email: "transfer-viewer@example.test", name: "Viewer", password: "password123" });
    countryId = owner.user.countryId;
    await inviteCountryMember(db,countryId,owner.user.id,viewer.user.email,"VIEWER");
    for (const scope of [countryId,viewer.user.countryId]) await db.prepare("UPDATE countries SET seed=424242 WHERE id=?").run(scope);
    const project = async (scope: string, key: string) => {
      const city = await service.createCity(scope,{name:`Project ${key}`,idempotencyKey:`city-${key}`});
      const district = await service.createDistrict(scope,{cityId:city.id,name:`Sprint ${key}`,activate:true,idempotencyKey:`district-${key}`});
      return {city,district};
    };
    const home = await project(countryId,"home"), other = await project(countryId,"other"), foreign = await project(viewer.user.countryId,"private");
    targetDistrictId = (await service.createDistrict(countryId,{cityId:home.city.id,name:"Target sprint",idempotencyKey:"target"})).id;
    crossCityDistrictId = other.district.id; foreignDistrictId = foreign.district.id;
    task = await service.createTask(countryId,{cityId:home.city.id,districtId:home.district.id,title:"Canonical work",estimate:1,idempotencyKey:"home-task"});
    foreignTaskId = (await service.createTask(viewer.user.countryId,{cityId:foreign.city.id,districtId:foreign.district.id,title:"Private work",estimate:1,idempotencyKey:"private-task"})).id;
    app = Fastify(); await app.register(fastifyCookie); await registerRoutes(app,db,service); await app.ready();
    const login = async (email: string) => {
      const response = await app.inject({method:"POST",url:"/api/auth/login",payload:{email,password:"password123"}});
      const value=response.headers["set-cookie"]!; return (Array.isArray(value)?value[0]!:value).split(";")[0]!;
    };
    cookie = await login(owner.user.email); viewerCookie = await login(viewer.user.email);
    expect((await app.inject({method:"POST",url:`/api/countries/${countryId}/select`,headers:{cookie:viewerCookie}})).statusCode).toBe(200);
  });
  afterAll(async()=>{await app?.close();await db?.close();});

  it("rejects unauthenticated, viewer, malformed and unknown-field requests before mutation",async()=>{
    const url=`/api/tasks/${task.id}/transfer`,payload={targetDistrictId,idempotencyKey:"transfer-good"};
    expect((await app.inject({method:"POST",url,payload})).statusCode).toBe(401);
    expect((await app.inject({method:"POST",url,payload,headers:{cookie:viewerCookie}})).statusCode).toBe(403);
    for(const bad of [{...payload,targetDistrictId:"bad"},{...payload,idempotencyKey:"x"},{...payload,comment:"x".repeat(4001)},{...payload,countryId}]) {
      expect((await app.inject({method:"POST",url,payload:bad,headers:{cookie}})).statusCode).toBe(400);
    }
    expect((await app.inject({method:"POST",url:"/api/tasks/bad/transfer",payload,headers:{cookie}})).statusCode).toBe(400);
    expect((await service.getTask(countryId,task.id)).districtId).toBe(task.districtId);
    expect(await service.listWorldFeatures(countryId)).toEqual([]);
  });

  it("does not disclose foreign country tasks/districts or silently expand to another project",async()=>{
    for(const [id,target,status] of [[foreignTaskId,targetDistrictId,404],[task.id,foreignDistrictId,404],[task.id,crossCityDistrictId,400],[task.id,task.districtId,400]] as const) {
      const response=await app.inject({method:"POST",url:`/api/tasks/${id}/transfer`,headers:{cookie},payload:{targetDistrictId:target,idempotencyKey:`deny-${id}-${target}`}});
      expect(response.statusCode).toBe(status); expect(response.json()).not.toHaveProperty("title");
    }
    expect(await service.listWorldFeatures(countryId)).toEqual([]);
  });

  it("returns the same canonical task, emits one invalidation and makes old-site navigation resolve the new location",async()=>{
    const payload={targetDistrictId,idempotencyKey:"transfer-once",comment:"Move to the next sprint"};
    const response=await app.inject({method:"POST",url:`/api/tasks/${task.id}/transfer`,headers:{cookie},payload});
    expect(response.statusCode).toBe(200);
    const moved=response.json<TaskDto>(); expect(moved).toMatchObject({id:task.id,taskNumber:task.taskNumber,cityId:task.cityId,districtId:targetDistrictId});
    expect(moved.origin).not.toEqual(task.origin);
    const retry=await app.inject({method:"POST",url:`/api/tasks/${task.id}/transfer`,headers:{cookie},payload});
    expect(retry.json()).toEqual(moved);
    const feature=(await service.listWorldFeatures(countryId))[0]!;
    const resolved=await app.inject({method:"GET",url:`/api/tasks/resolve?id=${feature.siteMarker!.targetTaskId}`,headers:{cookie}});
    expect(resolved.json()).toMatchObject({id:task.id,countryId,districtId:targetDistrictId,origin:moved.origin});
    const events=(await service.listEvents(countryId,0)).filter(event=>event.type==="task.transferred");
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({taskId:task.id,fromDistrictId:task.districtId,toDistrictId:targetDistrictId,markerId:feature.id});
  });
});
