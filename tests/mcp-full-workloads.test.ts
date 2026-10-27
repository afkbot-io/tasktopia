import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { AppService } from "../src/server/app-service";
import { registerUser } from "../src/server/auth";
import { createTestDb, type Db, type Row } from "../src/server/db";
import { createMcpServer } from "../src/server/mcp";
import { synchronizeCityBlocks } from "../src/server/world/active-block-layout";
import { MCP_SCOPES, type DistrictDto, type TaskDto } from "../src/shared/contracts";

type FullDistrict = DistrictDto & { workload: unknown };

describe("legacy full MCP district workloads", { timeout: 60_000 }, () => {
  let db: Db, counted: Db, service: AppService, client: Client;
  let countryId: string, cityId: string, foreignCountryId: string, foreignCityId: string, foreignDistrictId: string;
  let districts: DistrictDto[], emptyId: string, mixedId: string, completedId: string;
  let server: Awaited<ReturnType<typeof createMcpServer>>;
  const workloadQueries: string[] = [];
  const workloadQuery = (query: string) => query.includes("COUNT(t.id)") && query.includes("AS task_count");
  const result = <T>(reply: Awaited<ReturnType<Client["callTool"]>>) => {
    expect(reply.isError).not.toBe(true);
    return (reply.structuredContent as { result: T }).result;
  };

  beforeAll(async () => {
    db = await createTestDb();
    const owner = await registerUser(db, { email: "full-workloads@example.test", name: "Workloads", password: "password123" });
    const outsider = await registerUser(db, { email: "foreign-workloads@example.test", name: "Foreign workloads", password: "password123" });
    countryId = owner.user.countryId; foreignCountryId = outsider.user.countryId;
    await db.prepare("UPDATE countries SET seed=424242 WHERE id=ANY(?::text[])").run([countryId, foreignCountryId]);
    const writer = new AppService(db);
    cityId = (await writer.createCity(countryId, { name: "Full workloads", idempotencyKey: "full-workloads-city" })).id;
    mixedId = (await writer.createDistrict(countryId, { cityId, name: "Mixed", activate: true, idempotencyKey: "full-mixed" })).id;
    emptyId = (await writer.createDistrict(countryId, { cityId, name: "Empty", idempotencyKey: "full-empty" })).id;
    completedId = (await writer.createDistrict(countryId, { cityId, name: "Completed", idempotencyKey: "full-completed" })).id;
    const first = await writer.createTask(countryId, { cityId, districtId: mixedId, title: "Planning workload", estimate: 3, idempotencyKey: "full-first-task" });
    await db.prepare(`INSERT INTO tasks_v3 SELECT (jsonb_populate_record(NULL::tasks_v3,to_jsonb(t)||jsonb_build_object(
      'id',gen_random_uuid()::text,'task_number',0,'title',entry.title,'district_id',entry.district_id,
      'estimate',entry.estimate,'status',entry.status,'progress',entry.progress))).*
      FROM tasks_v3 t CROSS JOIN (VALUES
        ('Completed mixed task',?::text,5,'COMPLETED',100),
        ('In progress mixed task',?::text,2,'IN_PROGRESS',40),
        ('Completed district task',?::text,8,'COMPLETED',100)
      ) AS entry(title,district_id,estimate,status,progress) WHERE t.id=?`).run(mixedId, mixedId, completedId, first.id);
    await db.prepare("UPDATE districts_v3 SET capacity_sp=CASE id WHEN ? THEN 7 WHEN ? THEN 4 ELSE 6 END WHERE city_id=?")
      .run(mixedId, emptyId, cityId);
    await db.prepare("UPDATE districts_v3 SET status='COMPLETED' WHERE id=?").run(completedId);
    await synchronizeCityBlocks(db, countryId, cityId);
    districts = await writer.listDistricts(countryId, cityId);
    foreignCityId = (await writer.createCity(foreignCountryId, { name: "Foreign city", idempotencyKey: "foreign-workloads-city" })).id;
    foreignDistrictId = (await writer.createDistrict(foreignCountryId, { cityId: foreignCityId, name: "Foreign district", idempotencyKey: "foreign-workloads-district" })).id;
    counted = {
      prepare(query) {
        const statement = db.prepare(query);
        const read = async <T>(operation: () => Promise<T>) => {
          if (workloadQuery(query)) workloadQueries.push(query);
          return operation();
        };
        return { all: <T extends Row>(...args: unknown[]) => read(() => statement.all<T>(...args)),
          get: <T extends Row>(...args: unknown[]) => read(() => statement.get<T>(...args)), run: (...args) => statement.run(...args) };
      },
      exec: query => db.exec(query), transaction: callback => db.transaction(callback), close: async () => undefined,
    };
    service = new AppService(counted);
    server = await createMcpServer(counted, service, { userId: owner.user.id, tokenId: "full-workloads-test", scopes: [...MCP_SCOPES] });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    client = new Client({ name: "legacy-full-workloads", version: "1.0.0" }); await client.connect(clientTransport);
  });
  afterAll(async () => { await client?.close(); await server?.close(); await db?.close(); });

  const expectedWorkload = (id: string) => id === mixedId
    ? { districtId: mixedId, targetSp: 7, plannedSp: 10, openSp: 5, taskCount: 3, overTargetBySp: 3 }
    : id === emptyId ? { districtId: emptyId, targetSp: 4, plannedSp: 0, openSp: 0, taskCount: 0, overTargetBySp: 0 }
      : { districtId: completedId, targetSp: 6, plannedSp: 8, openSp: 0, taskCount: 1, overTargetBySp: 2 };

  it.each(["city.get", "district.list"] as const)("%s full preserves geometry and exact workloads using one aggregate for three districts", async name => {
    workloadQueries.length = 0;
    const reply = await client.callTool({ name, arguments: { countryId, cityId, view: "full" } });
    const data = result<FullDistrict[] | { districts: FullDistrict[]; tasks: TaskDto[] }>(reply);
    const actual = Array.isArray(data) ? data : data.districts;
    expect(actual).toEqual(districts.map(district => ({ ...district, workload: expectedWorkload(district.id) })));
    if (!Array.isArray(data)) {
      expect(data.tasks).toHaveLength(4);
      expect(data.tasks.every(task => task.footprint.length > 0 && task.accessPath.length > 0)).toBe(true);
    }
    expect(workloadQueries, "Legacy full must aggregate requested workloads once, independently of district count").toHaveLength(1);
  });

  it("preserves singleton shape including empty and completed districts", async () => {
    for (const id of [mixedId, emptyId, completedId]) expect(await service.getDistrictWorkload(countryId, id)).toEqual(expectedWorkload(id));
  });

  it("uses one aggregate for one or many unique district IDs and skips an empty request", async () => {
    for (const ids of [[mixedId], [mixedId, emptyId, completedId], [mixedId, mixedId]]) {
      workloadQueries.length = 0;
      const actual = await service.getDistrictWorkloads(countryId, ids);
      expect(actual).toEqual(new Map([...new Set(ids)].map(id => [id, expectedWorkload(id)])));
      expect(workloadQueries).toHaveLength(1);
    }
    workloadQueries.length = 0;
    expect(await service.getDistrictWorkloads(countryId, [])).toEqual(new Map());
    expect(workloadQueries).toHaveLength(0);
  });

  it("keeps foreign and missing singleton districts fail closed", async () => {
    await expect(service.getDistrictWorkload(countryId, foreignDistrictId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.getDistrictWorkload(countryId, randomUUID())).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects an entire requested batch when any district is foreign or missing", async () => {
    for (const ids of [[foreignDistrictId], [mixedId, foreignDistrictId], [mixedId, randomUUID()]]) {
      workloadQueries.length = 0;
      await expect(service.getDistrictWorkloads(countryId, ids)).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(workloadQueries).toHaveLength(1);
    }
  });

  it("keeps legacy full foreign/missing city authorization and empty-list behavior", async () => {
    for (const id of [foreignCityId, randomUUID()]) {
      const city = await client.callTool({ name: "city.get", arguments: { countryId, cityId: id, view: "full" } });
      expect(city.isError).toBe(true); expect(JSON.parse((city.content[0] as { text: string }).text).code).toBe("NOT_FOUND");
      expect(result(await client.callTool({ name: "district.list", arguments: { countryId, cityId: id, view: "full" } }))).toEqual([]);
    }
    const foreign = await client.callTool({ name: "district.list", arguments: { countryId: foreignCountryId, view: "full" } });
    expect(foreign.isError).toBe(true); expect(JSON.parse((foreign.content[0] as { text: string }).text).code).toBe("COUNTRY_ACCESS_DENIED");
  });
});
