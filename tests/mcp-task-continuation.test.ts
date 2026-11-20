import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type Db } from '../src/server/db';
import { AppService } from '../src/server/app-service';
import { createCountry, inviteCountryMember, registerUser, setActiveCountry } from '../src/server/auth';
import { createMcpServer, type McpIdentity } from '../src/server/mcp';
import { registerRoutes } from '../src/server/routes';
import type { TaskDto } from '../src/shared/contracts';
import type { TaskSprintPageDto } from '../src/shared/task-sprints';
import { PostgresWorldGenerationDispatcher, processNextWorldGenerationJob } from '../src/server/world-generation-jobs';

describe('MCP-only sprint continuation',{timeout:60_000},()=>{
  let db:Db,service:AppService,identity:McpIdentity,viewer:McpIdentity,task:TaskDto;
  let countryId:string,first:string,next:string,foreign:string,crossCity:string,activeCountry:string;
  const sessions:Array<{client:Client;server:Awaited<ReturnType<typeof createMcpServer>>}>=[];
  const connect=async(caller=identity)=>{
    const server=await createMcpServer(db,service,caller),[a,b]=InMemoryTransport.createLinkedPair();
    await server.connect(b);const client=new Client({name:'sprint-continuation-test',version:'1.0.0'});
    await client.connect(a);sessions.push({client,server});return client;
  };
  const input=()=>({countryId,taskId:task.id,fromDistrictId:first,targetDistrictId:next,idempotencyKey:'sdk-continue-once'});
  beforeAll(async()=>{
    db=await createTestDb();service=new AppService(db);
    const owner=await registerUser(db,{email:'sprint-mcp-owner@example.test',name:'Owner',password:'password123'});
    const observer=await registerUser(db,{email:'sprint-mcp-viewer@example.test',name:'Viewer',password:'password123'});
    activeCountry=owner.user.countryId;foreign=observer.user.countryId;
    countryId=await createCountry(db,owner.user.id,'Explicit continuation');
    await inviteCountryMember(db,countryId,owner.user.id,observer.user.email,'VIEWER');
    await db.prepare('UPDATE countries SET seed=424242 WHERE id=?').run(countryId);
    const city=await service.createCity(countryId,{name:'Continuation project',idempotencyKey:'city'});
    first=(await service.createDistrict(countryId,{cityId:city.id,name:'Sprint one',activate:true,idempotencyKey:'first'})).id;
    next=(await service.createDistrict(countryId,{cityId:city.id,name:'Sprint two',idempotencyKey:'second'})).id;
    const other=await service.createCity(countryId,{name:'Another project',idempotencyKey:'other'});
    crossCity=(await service.createDistrict(countryId,{cityId:other.id,name:'Other sprint',activate:true,idempotencyKey:'other-sprint'})).id;
    task=await service.createTask(countryId,{cityId:city.id,districtId:first,title:'One canonical task',estimate:1,idempotencyKey:'task'});
    await service.updateTaskStatus(countryId,{taskId:task.id,status:'STARTED',idempotencyKey:'start'});
    await setActiveCountry(db,owner.user.id,activeCountry);
    identity={userId:owner.user.id,tokenId:crypto.randomUUID(),scopes:['tasks:read','tasks:write']};
    viewer={userId:observer.user.id,tokenId:crypto.randomUUID(),scopes:['tasks:read','tasks:write']};
  });
  afterAll(async()=>{for(const {client,server} of sessions){await client.close();await server.close();}await db?.close();});

  it('advertises explicit strict schemas and rejects malformed commands',async()=>{
    const client=await connect(),tools=(await client.listTools()).tools;
    const command=tools.find(t=>t.name==='task.continue')!,history=tools.find(t=>t.name==='task.sprint_list')!;
    expect(command.inputSchema.required).toEqual(expect.arrayContaining(['countryId','taskId','fromDistrictId','targetDistrictId','idempotencyKey']));
    expect(command.inputSchema.additionalProperties).toBe(false);
    expect(command.annotations).toMatchObject({idempotentHint:true,destructiveHint:false});
    expect(history.annotations).toMatchObject({readOnlyHint:true});
    const {countryId:omitted,...missing}=input();expect(omitted).toBe(countryId);
    for(const args of [missing,{...input(),fromDistrictId:'bad'},{...input(),taskId:'bad'},{...input(),idempotencyKey:'x'},
      {...input(),comment:'x'.repeat(4001)},{...input(),stage:5}])expect((await client.callTool({name:'task.continue',arguments:args})).isError).toBe(true);
    expect((await service.listTaskSprints(countryId,task.id)).items).toEqual([]);
  });

  it('enforces task write scope, membership, city ownership and closed destinations',async()=>{
    for(const caller of [{...identity,scopes:['tasks:read'] as McpIdentity['scopes']},viewer]){
      const response=await(await connect(caller)).callTool({name:'task.continue',arguments:input()});
      expect(response.isError).toBe(true);expect(JSON.stringify(response.content)).toContain('FORBIDDEN_SCOPE');
    }
    const client=await connect();
    for(const [args,code] of [[{...input(),countryId:foreign},'COUNTRY_ACCESS_DENIED'],[{...input(),targetDistrictId:crossCity},'INVALID_INPUT']] as const){
      const response=await client.callTool({name:'task.continue',arguments:args});
      expect(response.isError).toBe(true);expect(JSON.stringify(response.content)).toContain(code);
    }
    await service.completeDistrict(countryId,crossCity,'close-other');
    const closed=(await service.createDistrict(countryId,{cityId:task.cityId,name:'Closed destination',idempotencyKey:'closed-destination'})).id;
    await service.completeDistrict(countryId,closed,'close-destination');
    const sealed=await client.callTool({name:'task.continue',arguments:{...input(),targetDistrictId:closed}});
    expect(sealed.isError).toBe(true);expect(JSON.stringify(sealed.content)).toContain('DISTRICT_SEALED');
    expect((await service.listTaskSprints(countryId,task.id)).items).toEqual([]);
  });

  it('continues once across SDK reconnects and exposes paginated read-only HTTP',async()=>{
    let client=await connect();
    const result=await client.callTool({name:'task.continue',arguments:{...input(),resultMode:'compact'}});
    expect(result.isError).not.toBe(true);
    expect((result.structuredContent as {result:unknown}).result).toMatchObject({kind:'task.command-result',id:task.id,
      taskNumber:task.taskNumber,districtId:first,currentDistrictId:next,status:'STARTED'});
    await client.close();client=await connect();
    expect((await client.callTool({name:'task.continue',arguments:{...input(),resultMode:'compact'}})).structuredContent).toEqual(result.structuredContent);
    const response=await client.callTool({name:'task.sprint_list',arguments:{countryId,taskId:task.id,limit:1}});
    const page=(response.structuredContent as {result:TaskSprintPageDto}).result;
    expect(page.items).toHaveLength(1);expect(page.nextCursor).toBeTruthy();
    expect((await client.callTool({name:'task.sprint_list',arguments:{countryId,taskId:task.id,cursor:'bad'}})).isError).toBe(true);
    const app=Fastify();await app.register(fastifyCookie);await registerRoutes(app,db,service);await app.ready();
    try{
      const login=await app.inject({method:'POST',url:'/api/auth/login',payload:{email:'sprint-mcp-owner@example.test',password:'password123'}});
      const cookies=login.headers['set-cookie']!,cookie=(Array.isArray(cookies)?cookies[0]!:cookies).split(';')[0]!;
      const read=await app.inject({method:'GET',url:`/api/tasks/${task.id}/sprints?countryId=${countryId}&limit=1`,headers:{cookie}});
      expect(read.statusCode).toBe(200);expect(read.json()).toEqual(page);
      expect((await app.inject({method:'POST',url:`/api/tasks/${task.id}/continue`,headers:{cookie},payload:input()})).statusCode).toBe(404);
      expect((await app.inject({method:'GET',url:`/api/tasks/${task.id}/sprints?countryId=${countryId}`})).statusCode).toBe(401);
      expect((await app.inject({method:'GET',url:`/api/tasks/${task.id}/sprints?countryId=${foreign}`,headers:{cookie}})).statusCode).toBe(403);
    }finally{await app.close();}
    expect(await db.prepare('SELECT active_country_id FROM users WHERE id=?').get(identity.userId)).toEqual({active_country_id:activeCountry});
    expect((await service.listTasks(countryId)).map(t=>t.id)).toEqual([task.id]);
    expect((await service.listEvents(countryId)).filter(e=>e.type==='task.continued')).toHaveLength(1);
  });

  it('accepts durable continuation over MCP and never lets a pre-upgrade worker claim it',async()=>{
    const worker=new AppService(db),dispatcher=new PostgresWorldGenerationDispatcher(db,0);
    const destination=(await worker.createDistrict(countryId,{cityId:task.cityId,name:'Queued continuation',idempotencyKey:'queued-district'})).id;
    service=new AppService(db,undefined,undefined,dispatcher);
    try{
      const client=await connect(),args={countryId,taskId:task.id,fromDistrictId:next,targetDistrictId:destination,idempotencyKey:'sdk-queued',resultMode:'compact'};
      const response=await client.callTool({name:'task.continue',arguments:args});
      expect(response.isError).not.toBe(true);
      const accepted=(response.structuredContent as {result:{status:string;job:{id:string;status:string}}}).result;
      expect(accepted.status).toBe('accepted');expect(accepted.job.status).toBe('PENDING');
      expect(await db.prepare("SELECT status FROM world_generation_jobs_v1 WHERE id=?").get(accepted.job.id)).toEqual({status:'CONTINUE_QUEUED'});
      expect(await db.prepare("SELECT id FROM world_generation_jobs_v1 WHERE id=? AND status IN ('PENDING','RUNNING','QUEUED','EXECUTING')").all(accepted.job.id)).toEqual([]);
      await client.close();const again=await connect();
      expect((await again.callTool({name:'task.continue',arguments:args})).structuredContent).toEqual(response.structuredContent);
      await processNextWorldGenerationJob(db,worker,'continuation-contract-worker');
      const completed=await again.callTool({name:'world_generation.get',arguments:{countryId,jobId:accepted.job.id,view:'compact'}});
      expect(completed.isError).not.toBe(true);
      expect((completed.structuredContent as {result:unknown}).result).toMatchObject({status:'COMPLETED',result:{id:task.id,currentDistrictId:destination}});
      expect((await worker.listTaskSprints(countryId,task.id)).items).toHaveLength(3);
      expect((await worker.listTasks(countryId)).map(t=>t.id)).toEqual([task.id]);
    }finally{await dispatcher.close();}
  });
});
