import type { IncomingHttpHeaders } from "node:http";
import { createMcpHandler, McpServer, ResourceTemplate, type AuthInfo, type McpHttpHandler } from "@modelcontextprotocol/server";
import { z } from "zod";
import { taskCollectionPageSchema, taskListPageSchema } from "./task-read-schemas";
import { readMcpArchiveRecords, readMcpCities, readMcpCity, readMcpCountries, readMcpCountryCounts, readMcpDistricts } from "./mcp-read-models";
import { BUILDING_CATALOG } from "../shared/catalog";
import type { AppService } from "./app-service";
import { DomainError } from "./app-service";
import type { Db } from "./db";
import { authenticateMcpToken, countryRole, listAccessibleCountries } from "./auth";
import { MCP_READ_SCOPES, type CountryRole, type McpScope, type TaskDto } from "../shared/contracts";
import { config } from "./config";
import { APP_VERSION } from "./version";
import { GenerationPendingError, getWorldGenerationJob, type WorldGenerationJob } from "./world-generation-jobs";
import { runWithGenerationRequestSignal } from "./generation-request-context";

export type McpIdentity = { userId: string; tokenId: string; scopes: McpScope[] };
export type McpAuthentication = { identity: McpIdentity; authInfo: AuthInfo };

/** Shareable web link to the task card; humans open it in the app. */
function taskUrl(countryId: string, task: Pick<TaskDto, "id" | "taskNumber">): string {
  return `${config.APP_ORIGIN}/task/${task.taskNumber}?${new URLSearchParams({ countryId, taskId: task.id })}`;
}

function response(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }], structuredContent: { result: data } };
}

function publicGenerationJob(job: WorldGenerationJob) {
  return { id: job.id, countryId: job.countryId, operation: job.operation, idempotencyKey: job.idempotencyKey,
    status: job.status, attempts: job.attempts, maxAttempts: job.maxAttempts,
    ...(job.result === undefined ? {} : { result: job.result }),
    ...(job.error === undefined ? {} : { error: job.error.code === "GENERATION_FAILED"
      ? { code: job.error.code, message: "Генерация завершилась с ошибкой" } : job.error }) };
}

function failure(error: unknown) {
  if (error instanceof GenerationPendingError) return response({ status: "accepted", job: publicGenerationJob(error.job) });
  const code = error instanceof DomainError ? error.code : "INTERNAL_ERROR";
  const message = error instanceof DomainError ? error.message : "Внутренняя ошибка MCP";
  return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ code, message }) }] };
}

function requireScope(identity: McpIdentity, scope: McpScope): void {
  if (!identity.scopes.includes(scope)) throw new DomainError("FORBIDDEN_SCOPE", `Токену не хватает scope ${scope}`);
}

const countryIdSchema = z.string().uuid().describe("Явный ID страны-проекта; не зависит от страны, выбранной в веб-интерфейсе");
const metadataPage = { view: z.enum(["full", "compact"]).optional(), limit: z.number().int().min(1).max(100).optional(), cursor: z.string().min(1).max(8192).optional() };

async function requireCountryAccess(db: Db, identity: McpIdentity, countryId: string, scope: McpScope): Promise<CountryRole> {
  requireScope(identity, scope);
  const role = await countryRole(db, identity.userId, countryId);
  if (!role) throw new DomainError("COUNTRY_ACCESS_DENIED", "У аккаунта нет доступа к запрошенной стране");
  if (role === "VIEWER" && !MCP_READ_SCOPES.includes(scope)) {
    throw new DomainError("FORBIDDEN_SCOPE", `Роль наблюдателя не разрешает scope ${scope} в запрошенной стране`);
  }
  return role;
}

export async function getMcpAuthentication(db: Db, headers: IncomingHttpHeaders): Promise<McpAuthentication | null> {
  const identity = await authenticateMcpToken(db, headers.authorization);
  if (!identity) return null;
  const authorization = headers.authorization;
  if (Array.isArray(authorization)) return null;
  const token = authorization?.replace(/^Bearer /i, "") ?? "";
  return {
    identity,
    authInfo: {
      token,
      clientId: `tasktopia-personal-key:${identity.tokenId}`,
      scopes: identity.scopes,
      extra: { tasktopiaIdentity: identity },
    },
  };
}

export async function createMcpServer(db: Db, service: AppService, identity: McpIdentity): Promise<McpServer> {
  const server = new McpServer({ name: "tasktopia", version: APP_VERSION }, {
    maxToolInputElements: 10_000,
    instructions: [
      "Tasktopia turns work into a living country: countries contain cities, cities contain districts, and tasks become buildings.",
      "Start with country.list, then pass the chosen countryId to every country-scoped tool. MCP tools never read or change the country selected in the web UI.",
      "Prefer view=compact for country/city/district/archive metadata lists and country/city/task cards. Continue nextCursor with identical scope/filters; use task.list_page instead of loading the full task catalog. Read only needed task.collection_list pages and task.document_get documents. Use resultMode=compact for comment/progress/status receipts; full remains the compatible legacy response.",
      "Every write requires a stable idempotencyKey. Reuse it only for an identical retry.",
      "District capacitySp is an advisory workload target and never blocks task creation.",
      "Keep project context on the country, epic outcomes on the city, sprint goal and deadline on the district, and executable analysis on the task.",
      "The State Archive is a compact country-level reference, not a city or task backlog. Use archive records for durable project rules, repository/environment links, architecture summaries and reusable templates; keep active work in tasks.",
      "A task workItemType classifies delivery as TASK, BUG, RELEASE or HOTFIX. task defects are linked observations with reproduction, actual and expected results.",
      "Task implementation materials are Markdown documents. Use task.document_upsert for the four standard files and any extra .md files; use task.checklist_replace and task.checklist_item_update to keep execution progress current.",
      "Every task has a human-facing number and canonical country/UUID url; share the url when reporting to people. Attach merge request links with task.link_add and binary evidence with task.attachment_add.",
      "Use task.transfer to move an existing task between sprints of the same city. Identity and history survive; the former parcel becomes available for another task. The destination parcel determines the artwork. Deleting a task leaves permanent ruins, never a reusable parcel.",
      "Use task.dependency_add to express task order (must be in the same city); task.activity returns the full audit trail of events, comments, defects, attachments and dependencies.",
      "Linked defects use OPEN -> IN_PROGRESS -> VERIFYING -> FIXED. Keep the parent task in TESTING while an ordinary linked defect is repaired; completion is blocked until every linked defect is FIXED.",
      "Deletion is permanent: read the entity and children, obtain explicit user approval, then pass the exact current confirmName or confirmTitle.",
      "Task stages are PLANNING -> STARTED -> IN_PROGRESS -> TESTING -> COMPLETED; only TESTING -> IN_PROGRESS may move backward and requires a comment.",
    ].join(" "),
    cacheHints: { "tools/list": { ttlMs: 300_000, cacheScope: "private" }, "resources/list": { ttlMs: 300_000, cacheScope: "private" } },
  });
  const actor = await db.prepare("SELECT name FROM users WHERE id = ?").get<{ name: string }>(identity.userId);
  const actorName = actor?.name ?? "Представитель страны";
  const resolveMember = async (countryId: string, email: string | undefined): Promise<string | undefined> => {
    if (!email) return undefined;
    const row = await db.prepare(`SELECT u.id FROM users u JOIN country_members cm ON cm.user_id = u.id
      WHERE cm.country_id = ? AND u.email = ?`).get<{ id: string }>(countryId, email.trim().toLowerCase());
    if (!row) throw new DomainError("ASSIGNEE_NOT_MEMBER", "Ответственный должен быть зарегистрирован и состоять в правительстве страны");
    return row.id;
  };
  const cityCreateSchema = z.object({
    countryId: countryIdSchema,
    name: z.string().min(2).max(100), description: z.string().max(8000).optional(), goal: z.string().max(4000).optional(),
    acceptanceCriteria: z.string().max(8000).optional(), deadline: z.string().datetime().optional(),
    morphology: z.enum(["BALANCED", "DENSE_CORE", "GARDEN_CITY", "POLYCENTRIC"]).optional(),
    idempotencyKey: z.string().min(4).max(160),
  });
  const districtCreateSchema = z.object({
    countryId: countryIdSchema,
    cityId: z.string().uuid(), name: z.string().min(2).max(100), goal: z.string().max(4000).optional(),
    description: z.string().max(8000).optional(), deadline: z.string().datetime().optional(),
    capacitySp: z.number().int().positive().optional().describe("Необязательный ориентир нагрузки в SP; не ограничивает число или сумму задач"), activate: z.boolean().optional(),
    archetype: z.enum(["NEW_BUILD", "PRIVATE", "MIXED_URBAN", "COMMERCIAL", "CIVIC"]).optional(),
    idempotencyKey: z.string().min(4).max(160),
  });

  server.registerTool("country.get", { title: "Get country", description: "Получить явно указанную страну; view=compact возвращает контекст, архив и число городов без полного списка городов.", inputSchema: z.object({ countryId: countryIdSchema, view: metadataPage.view }), annotations: { readOnlyHint: true } }, async ({ countryId, view }) => {
    try {
      await requireCountryAccess(db, identity, countryId, "country:read");
      if (view === "compact") return response({ kind: "country.card", version: 1, countryId,
        country: await service.getCountry(countryId), archive: await service.getArchive(countryId), counts: await readMcpCountryCounts(db, countryId) });
      return response({ country: await service.getCountry(countryId), archive: await service.getArchive(countryId), cities: await service.listCities(countryId) });
    } catch (error) { return failure(error); }
  });

  server.registerTool("world_generation.get", {
    description: "Получить состояние принятой фоновой операции по jobId. view=compact сокращает результат task.create/task.set_status/task.transfer до task.command-result без истории; full сохраняет прежний результат.",
    inputSchema: z.object({ countryId: countryIdSchema, jobId: z.string().uuid(), view: metadataPage.view }),
    annotations: { readOnlyHint: true },
  }, async ({ countryId, jobId, view }) => {
    try {
      await requireCountryAccess(db, identity, countryId, identity.scopes.includes("country:read") ? "country:read" : "tasks:read");
      const job = await getWorldGenerationJob(db, jobId);
      if (!job || job.countryId !== countryId) throw new DomainError("NOT_FOUND", "Операция генерации не найдена");
      requireScope(identity, job.operation.startsWith("task.") ? "tasks:read" : "country:read");
      const publicJob = publicGenerationJob(job);
      return response(job.status === "COMPLETED" ? { ...publicJob, result: await service.rehydrateGenerationResult(countryId, job.operation, job.result, view ?? "full") } : publicJob);
    } catch (error) { return failure(error); }
  });

  server.registerTool("country.list", { title: "List countries", description: "Страны аккаунта; view=compact возвращает ограниченную страницу метаданных без длинного контекста, full сохраняет прежний список.", inputSchema: z.object(metadataPage), annotations: { readOnlyHint: true } }, async (input) => {
    try {
      requireScope(identity, "country:read");
      if (input.view === "compact") return response(await readMcpCountries(db, identity.userId, input));
      return response(await Promise.all((await listAccessibleCountries(db, identity.userId)).map(async (access) => ({
                                                ...await service.getCountry(access.id), role: access.role, memberCount: access.memberCount,
                                              }))));
    } catch (error) { return failure(error); }
  });

  server.registerTool("country.update_profile", {
    description: "Обновить устойчивый контекст страны-проекта: описание, цель, продуктовый контекст, критерии успеха и ограничения.",
    inputSchema: z.object({
      countryId: countryIdSchema,
      description: z.string().max(8000).optional(), goal: z.string().max(4000).optional(), productContext: z.string().max(8000).optional(),
      successCriteria: z.string().max(8000).optional(), constraints: z.string().max(8000).optional(), idempotencyKey: z.string().min(4).max(160),
    }), annotations: { idempotentHint: true },
  }, async (input) => {
    try {
      const role = await requireCountryAccess(db, identity, input.countryId, "cities:write");
      if (role !== "OWNER") throw new DomainError("FORBIDDEN", "Профиль страны изменяет только её глава");
      return response(await service.updateCountryProfile(input.countryId, input));
    } catch (error) { return failure(error); }
  });

  server.registerTool("city.list", { description: "Города страны; view=compact возвращает страницу метаданных и счётчиков без полных описаний.", inputSchema: z.object({ countryId: countryIdSchema, ...metadataPage }), annotations: { readOnlyHint: true } }, async (input) => {
    try { await requireCountryAccess(db, identity, input.countryId, "country:read"); return response(input.view === "compact" ? await readMcpCities(db, input.countryId, input) : await service.listCities(input.countryId)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("city.get", { description: "Город; view=compact возвращает метаданные и счётчики без геометрии районов и задач. Full сохраняет прежнюю форму и требует tasks:read.", inputSchema: z.object({ countryId: countryIdSchema, cityId: z.string().uuid(), view: metadataPage.view }), annotations: { readOnlyHint: true } }, async ({ countryId, cityId, view }) => {
    try {
      await requireCountryAccess(db, identity, countryId, "country:read");
      if (view === "compact") return response(await readMcpCity(db, countryId, cityId));
      await requireCountryAccess(db, identity, countryId, "tasks:read");
      const city = (await service.listCities(countryId)).find((item) => item.id === cityId);
      if (!city) throw new DomainError("NOT_FOUND", "Город не найден");
      const districts = await service.listDistricts(countryId, cityId);
      return response({ city, districts: await Promise.all(districts.map(async (district) => ({ ...district, workload: await service.getDistrictWorkload(countryId, district.id) }))), tasks: await service.listTasks(countryId, undefined, cityId) });
    } catch (error) { return failure(error); }
  });

  server.registerTool("city.create", { description: "Создать город, его территорию, улицы и соединение с дорожной сетью страны.", inputSchema: cityCreateSchema, annotations: { idempotentHint: true } }, async (input, ctx) => {
    try { await requireCountryAccess(db, identity, input.countryId, "cities:write"); return response(await runWithGenerationRequestSignal(ctx.mcpReq.signal, () => service.createCity(input.countryId, input))); }
    catch (error) { return failure(error); }
  });

  server.registerTool("city.rename", { description: "Переименовать существующий город.", inputSchema: z.object({ countryId: countryIdSchema, cityId: z.string().uuid(), name: z.string().min(2).max(100), idempotencyKey: z.string().min(4).max(160) }), annotations: { idempotentHint: true } }, async (input) => {
    try { await requireCountryAccess(db, identity, input.countryId, "cities:write"); return response(await service.renameCity(input.countryId, input)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("city.update", {
    description: "Обновить город-эпик: название, описание, ожидаемый результат, критерии приёмки и срок.",
    inputSchema: z.object({
      countryId: countryIdSchema,
      cityId: z.string().uuid(), name: z.string().min(2).max(100).optional(), description: z.string().max(8000).optional(),
      goal: z.string().max(4000).optional(), acceptanceCriteria: z.string().max(8000).optional(), deadline: z.string().datetime().nullable().optional(),
      idempotencyKey: z.string().min(4).max(160),
    }), annotations: { idempotentHint: true },
  }, async (input) => {
    try { await requireCountryAccess(db, identity, input.countryId, "cities:write"); return response(await service.updateCity(input.countryId, input)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("city.delete", { description: "Безвозвратно удалить город, районы и задачи; постоянная история занятых участков остаётся в стране. Для защиты передайте точное текущее название.", inputSchema: z.object({ countryId: countryIdSchema, cityId: z.string().uuid(), confirmName: z.string().min(2).max(100), idempotencyKey: z.string().min(4).max(160) }), annotations: { destructiveHint: true, idempotentHint: true } }, async (input, ctx) => {
    try { await requireCountryAccess(db, identity, input.countryId, "cities:write"); return response(await runWithGenerationRequestSignal(ctx.mcpReq.signal, () => service.deleteCity(input.countryId, input))); }
    catch (error) { return failure(error); }
  });

  server.registerTool("district.list", { description: "Районы страны/города; view=compact возвращает страницу метаданных и workload без cells/lots. Full сохраняет прежнюю геометрию.", inputSchema: z.object({ countryId: countryIdSchema, cityId: z.string().uuid().optional(), ...metadataPage }), annotations: { readOnlyHint: true } }, async (input) => {
    try {
      const { countryId, cityId } = input;
      await requireCountryAccess(db, identity, countryId, "country:read");
      if (input.view === "compact") return response(await readMcpDistricts(db, countryId, cityId, input));
      const districts = await service.listDistricts(countryId, cityId);
      return response(await Promise.all(districts.map(async (district) => ({ ...district, workload: await service.getDistrictWorkload(countryId, district.id) }))));
    }
    catch (error) { return failure(error); }
  });

  server.registerTool("district.create", { description: "Создать расширяемый район с улицами, тротуарами и архетипом застройки. Если archetype не передан, сервер выберет его по цели района и характеру города.", inputSchema: districtCreateSchema, annotations: { idempotentHint: true } }, async (input, ctx) => {
    try { await requireCountryAccess(db, identity, input.countryId, "districts:write"); return response(await runWithGenerationRequestSignal(ctx.mcpReq.signal, () => service.createDistrict(input.countryId, input))); }
    catch (error) { return failure(error); }
  });

  server.registerTool("district.rename", { description: "Переименовать существующий район.", inputSchema: z.object({ countryId: countryIdSchema, districtId: z.string().uuid(), name: z.string().min(2).max(100), idempotencyKey: z.string().min(4).max(160) }), annotations: { idempotentHint: true } }, async (input) => {
    try { await requireCountryAccess(db, identity, input.countryId, "districts:write"); return response(await service.renameDistrict(input.countryId, input)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("district.update", {
    description: "Обновить район-спринт: название, sprint goal, описание, дедлайн и ориентир нагрузки SP.",
    inputSchema: z.object({
      countryId: countryIdSchema,
      districtId: z.string().uuid(), name: z.string().min(2).max(100).optional(), goal: z.string().max(4000).optional(),
      description: z.string().max(8000).optional(), deadline: z.string().datetime().nullable().optional(),
      capacitySp: z.number().int().positive().optional().describe("Ориентир команды, не серверный лимит"), idempotencyKey: z.string().min(4).max(160),
    }), annotations: { idempotentHint: true },
  }, async (input) => {
    try { await requireCountryAccess(db, identity, input.countryId, "districts:write"); return response(await service.updateDistrict(input.countryId, input)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("district.delete", { description: "Безвозвратно удалить район и все его задачи, сохранив постоянные руины на прежних участках. Для защиты передайте точное текущее название; если район был активным, сервер активирует следующий плановый.", inputSchema: z.object({ countryId: countryIdSchema, districtId: z.string().uuid(), confirmName: z.string().min(2).max(100), idempotencyKey: z.string().min(4).max(160) }), annotations: { destructiveHint: true, idempotentHint: true } }, async (input, ctx) => {
    try { await requireCountryAccess(db, identity, input.countryId, "districts:write"); return response(await runWithGenerationRequestSignal(ctx.mcpReq.signal, () => service.deleteDistrict(input.countryId, input))); }
    catch (error) { return failure(error); }
  });

  server.registerTool("district.activate", { description: "Сделать район активным.", inputSchema: z.object({ countryId: countryIdSchema, districtId: z.string().uuid(), idempotencyKey: z.string().min(4).max(160) }), annotations: { idempotentHint: true } }, async ({ countryId, districtId, idempotencyKey }) => {
    try { await requireCountryAccess(db, identity, countryId, "districts:write"); return response(await service.activateDistrict(countryId, districtId, idempotencyKey)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("district.complete", { description: "Закрыть район, когда все его задачи завершены; после этого район больше не расширяется.", inputSchema: z.object({ countryId: countryIdSchema, districtId: z.string().uuid(), idempotencyKey: z.string().min(4).max(160) }), annotations: { idempotentHint: true } }, async ({ countryId, districtId, idempotencyKey }, ctx) => {
    try { await requireCountryAccess(db, identity, countryId, "districts:write"); return response(await runWithGenerationRequestSignal(ctx.mcpReq.signal, () => service.completeDistrict(countryId, districtId, idempotencyKey))); }
    catch (error) { return failure(error); }
  });

  server.registerTool("task.list", { description: "Получить задачи, при необходимости только одного района.", inputSchema: z.object({ countryId: countryIdSchema, districtId: z.string().uuid().optional() }), annotations: { readOnlyHint: true } }, async ({ countryId, districtId }) => {
    try { await requireCountryAccess(db, identity, countryId, "tasks:read"); return response(await service.listTasks(countryId, districtId)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("task.list_page", { description: "Получить страницу задач с поиском и совместимыми фильтрами; limit по умолчанию 50, nextCursor продолжает тот же запрос.",
    inputSchema: taskListPageSchema.extend({ countryId: countryIdSchema }), annotations: { readOnlyHint: true } }, async (input) => {
    try { await requireCountryAccess(db, identity, input.countryId, "tasks:read"); return response(await service.listTaskPage(input.countryId, input)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("task.collection_list", { description: "Получить страницу комментариев, истории, дефектов, файлов, метаданных документов, чек-листа, зависимостей или MR. История начинается с последних записей; документы не включают content.",
    inputSchema: taskCollectionPageSchema.extend({ countryId: countryIdSchema }), annotations: { readOnlyHint: true } }, async (input) => {
    try { await requireCountryAccess(db, identity, input.countryId, "tasks:read"); return response(await service.getTaskCollection(input.countryId, input.taskId, input.collection, input)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("task.document_get", { description: "Получить содержимое одного Markdown-документа по задаче и стране.",
    inputSchema: z.object({ countryId: countryIdSchema, taskId: z.string().uuid(), documentId: z.string().uuid() }).strict(), annotations: { readOnlyHint: true } }, async ({ countryId, taskId, documentId }) => {
    try { await requireCountryAccess(db, identity, countryId, "tasks:read"); return response(await service.getTaskDocument(countryId, taskId, documentId)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("task.get", { description: "Получить задачу, Markdown-документы, чек-лист, дефекты, комментарии, MR, файлы и веб-ссылку для людей. view=compact возвращает task.card с counts и ограниченными метаданными документов без истории; full — прежний полный ответ.", inputSchema: z.object({ countryId: countryIdSchema, taskId: z.string().uuid(), view: z.enum(["full", "compact"]).optional() }), annotations: { readOnlyHint: true } }, async ({ countryId, taskId, view }) => {
    try {
      await requireCountryAccess(db, identity, countryId, "tasks:read");
      const task = view === "compact" ? await service.getTaskCard(countryId, taskId) : await service.getTask(countryId, taskId);
      return response({ ...task, url: taskUrl(countryId, task) });
    }
    catch (error) { return failure(error); }
  });

  server.registerTool("task.create", {
    description: "Создать задачу: сервер занимает свободный участок района и подбирает оформление под его размер. Размеры и семейство здания не задаются. Оценка относится к работе, а не к размеру постройки.",
    inputSchema: z.object({
      countryId: countryIdSchema,
      cityId: z.string().uuid(), districtId: z.string().uuid().optional(),
      title: z.string().min(2).max(160), description: z.string().max(8000).optional(),
      workItemType: z.enum(["TASK", "BUG", "RELEASE", "HOTFIX"]).optional(), acceptanceCriteria: z.string().max(8000).optional(),
      systemAnalysis: z.string().max(16000).optional(), architecture: z.string().max(16000).optional(),
      designSystem: z.string().max(16000).optional(), implementationPlan: z.string().max(16000).optional(),
      estimate: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(6)]),
      priority: z.enum(["LOW", "NORMAL", "HIGH", "CRITICAL"]).optional(), dueAt: z.string().datetime().optional(),
      assigneeEmail: z.string().email().optional(),
      assigneeRole: z.string().max(80).optional().describe("Роль ответственного, например backend-lead, ai-agent:hermes, qa"),
      forUserEmail: z.string().email().optional().describe("Заказчик/владелец задачи — для кого делается работа"),
      idempotencyKey: z.string().min(4).max(160),
    }).strict(),
    annotations: { idempotentHint: true },
  }, async (input, ctx) => {
    try {
      await requireCountryAccess(db, identity, input.countryId, "tasks:write");
      const task = await runWithGenerationRequestSignal(ctx.mcpReq.signal, async () => service.createTask(input.countryId, {
                                                cityId: input.cityId, districtId: input.districtId, title: input.title, description: input.description,
                                                workItemType: input.workItemType, acceptanceCriteria: input.acceptanceCriteria, systemAnalysis: input.systemAnalysis,
                                                architecture: input.architecture, designSystem: input.designSystem, implementationPlan: input.implementationPlan,
                                                estimate: input.estimate, priority: input.priority, dueAt: input.dueAt,
                                                creatorUserId: identity.userId, assigneeUserId: await resolveMember(input.countryId, input.assigneeEmail), assigneeRole: input.assigneeRole,
                                                forUserId: await resolveMember(input.countryId, input.forUserEmail), idempotencyKey: input.idempotencyKey,
                                              }));
      return response({ ...task, url: taskUrl(input.countryId, task), workload: await service.getDistrictWorkload(input.countryId, task.districtId) });
    } catch (error) { return failure(error); }
  });

  server.registerTool("task.rename", {
    description: "Переименовать задачу и связанное с ней здание.",
    inputSchema: z.object({ countryId: countryIdSchema, taskId: z.string().uuid(), title: z.string().min(2).max(160), idempotencyKey: z.string().min(4).max(160) }),
    annotations: { idempotentHint: true },
  }, async (input) => {
    try { await requireCountryAccess(db, identity, input.countryId, "tasks:write"); return response(await service.renameTask(input.countryId, { ...input, actor: actorName, actorUserId: identity.userId })); }
    catch (error) { return failure(error); }
  });

  server.registerTool("task.transfer", {
    description: "Перенести существующую задачу в другой спринт того же города. ID, номер, стадия и история сохраняются; прежний участок освобождается, новый выбирается автоматически. resultMode=compact возвращает короткий receipt без истории.",
    inputSchema: z.object({ countryId: countryIdSchema, taskId: z.string().uuid(), targetDistrictId: z.string().uuid(),
      comment: z.string().trim().max(4000).optional(), idempotencyKey: z.string().min(4).max(160), resultMode: metadataPage.view }).strict(),
    annotations: { idempotentHint: true, destructiveHint: true },
  }, async (input, ctx) => {
    try {
      await requireCountryAccess(db, identity, input.countryId, "tasks:write");
      const { countryId, resultMode, ...command } = input;
      const task = await runWithGenerationRequestSignal(ctx.mcpReq.signal, () => service.transferTask(countryId, { ...command, actor: actorName, actorUserId: identity.userId }, resultMode));
      return response({ ...task, url: taskUrl(input.countryId, task) });
    } catch (error) { return failure(error); }
  });

  server.registerTool("task.update_fields", {
    description: "Обновить постановку задачи: тип поставки, описание, критерии приёмки, системный анализ, архитектуру, дизайн-систему, план, SP, приоритет, дедлайн, роль ответственного и заказчика. Статус меняйте отдельной командой.",
    inputSchema: z.object({
      countryId: countryIdSchema,
      taskId: z.string().uuid(), title: z.string().min(2).max(160).optional(), description: z.string().max(8000).optional(),
      workItemType: z.enum(["TASK", "BUG", "RELEASE", "HOTFIX"]).optional(), acceptanceCriteria: z.string().max(8000).optional(),
      systemAnalysis: z.string().max(16000).optional(), architecture: z.string().max(16000).optional(), designSystem: z.string().max(16000).optional(),
      implementationPlan: z.string().max(16000).optional(), estimate: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(6)]).optional(),
      priority: z.enum(["LOW", "NORMAL", "HIGH", "CRITICAL"]).optional(), dueAt: z.string().datetime().nullable().optional(),
      assigneeRole: z.string().max(80).optional().describe("Роль ответственного, например backend-lead, ai-agent:hermes, qa"),
      forUserEmail: z.string().email().optional().describe("Заказчик/владелец задачи"),
      idempotencyKey: z.string().min(4).max(160),
    }), annotations: { idempotentHint: true },
  }, async (input) => {
    try {
      await requireCountryAccess(db, identity, input.countryId, "tasks:write");
      const forUserId = input.forUserEmail !== undefined
        ? (input.forUserEmail ? await resolveMember(input.countryId, input.forUserEmail) : undefined)
        : undefined;
      return response(await service.updateTaskFields(input.countryId, {
        ...input, forUserId, actor: actorName, actorUserId: identity.userId,
      }));
    }
    catch (error) { return failure(error); }
  });

  server.registerTool("task.defect_create", {
    description: "Зафиксировать связанный дефект внутри задачи с воспроизводимыми шагами и ожидаемым результатом.",
    inputSchema: z.object({
      countryId: countryIdSchema,
      taskId: z.string().uuid(), title: z.string().min(2).max(160), description: z.string().max(8000).optional(),
      reproductionSteps: z.string().min(1).max(12000), actualResult: z.string().min(1).max(8000), expectedResult: z.string().min(1).max(8000),
      idempotencyKey: z.string().min(4).max(160),
    }), annotations: { idempotentHint: true },
  }, async (input) => {
    try { await requireCountryAccess(db, identity, input.countryId, "tasks:write"); return response(await service.createTaskDefect(input.countryId, { ...input, actor: actorName, actorUserId: identity.userId })); }
    catch (error) { return failure(error); }
  });

  server.registerTool("task.defect_update", {
    description: "Вести отдельный цикл связанного дефекта: OPEN → IN_PROGRESS → VERIFYING → FIXED; при неудачной проверке VERIFYING → IN_PROGRESS, при повторном открытии FIXED → OPEN. Родительскую задачу на тестировании не откатывать.",
    inputSchema: z.object({
      countryId: countryIdSchema,
      defectId: z.string().uuid(), title: z.string().min(2).max(160).optional(), description: z.string().max(8000).optional(),
      reproductionSteps: z.string().trim().min(1).max(12000).optional(), actualResult: z.string().trim().min(1).max(8000).optional(), expectedResult: z.string().trim().min(1).max(8000).optional(),
      status: z.enum(["OPEN", "IN_PROGRESS", "VERIFYING", "FIXED"]).optional(), idempotencyKey: z.string().min(4).max(160),
    }), annotations: { idempotentHint: true },
  }, async (input) => {
    try { await requireCountryAccess(db, identity, input.countryId, "tasks:write"); return response(await service.updateTaskDefect(input.countryId, { ...input, actor: actorName, actorUserId: identity.userId })); }
    catch (error) { return failure(error); }
  });

  server.registerTool("task.delete", {
    description: "Безвозвратно удалить задачу, сохранив постоянные руины и краткую историю на её участке. Участок никогда не используется повторно. Для защиты передайте точный текущий заголовок.",
    inputSchema: z.object({ countryId: countryIdSchema, taskId: z.string().uuid(), confirmTitle: z.string().min(2).max(160), idempotencyKey: z.string().min(4).max(160) }),
    annotations: { destructiveHint: true, idempotentHint: true },
  }, async (input, ctx) => {
    try {
      await requireCountryAccess(db, identity, input.countryId, "tasks:write");
      const deleted = await runWithGenerationRequestSignal(ctx.mcpReq.signal, () => service.deleteTask(input.countryId, input));
      return response({ ...deleted, workload: await service.getDistrictWorkload(input.countryId, deleted.districtId) });
    }
    catch (error) { return failure(error); }
  });

  const statusInput = {
    countryId: countryIdSchema, taskId: z.string().uuid(), status: z.enum(["PLANNING", "STARTED", "IN_PROGRESS", "TESTING", "COMPLETED"]),
    progress: z.number().int().min(0).max(100).optional(), comment: z.string().max(8000).optional(), idempotencyKey: z.string().min(4).max(160),
    resultMode: z.enum(["full", "compact"]).optional(),
  };
  server.registerTool("task.set_status", { description: "Перевести задачу на следующую строительную стадию.", inputSchema: z.object(statusInput), annotations: { idempotentHint: true } }, async (input, ctx) => {
    try { await requireCountryAccess(db, identity, input.countryId, "tasks:write"); const { resultMode, ...command } = input; return response(await runWithGenerationRequestSignal(ctx.mcpReq.signal, () => service.updateTaskStatus(input.countryId, { ...command, actor: actorName, actorUserId: identity.userId }, resultMode))); }
    catch (error) { return failure(error); }
  });

  server.registerTool("task.report_progress", {
    description: "Обновить процент и статус задачи с обязательным комментарием.",
    inputSchema: z.object({ ...statusInput, progress: z.number().int().min(0).max(100), comment: z.string().min(1).max(8000) }),
    annotations: { idempotentHint: true },
  }, async (input, ctx) => {
    try { await requireCountryAccess(db, identity, input.countryId, "tasks:write"); const { resultMode, ...command } = input; return response(await runWithGenerationRequestSignal(ctx.mcpReq.signal, () => service.updateTaskStatus(input.countryId, { ...command, actor: actorName, actorUserId: identity.userId }, resultMode))); }
    catch (error) { return failure(error); }
  });

  server.registerTool("task.add_comment", {
    description: "Добавить комментарий без изменения стадии.",
    inputSchema: z.object({ countryId: countryIdSchema, taskId: z.string().uuid(), body: z.string().min(1).max(8000), idempotencyKey: z.string().min(4).max(160), resultMode: z.enum(["full", "compact"]).optional() }),
    annotations: { idempotentHint: true },
  }, async (input) => {
    try { await requireCountryAccess(db, identity, input.countryId, "comments:write"); const { resultMode, ...command } = input; return response(await service.addTaskComment(input.countryId, { ...command, actor: actorName, actorUserId: identity.userId }, resultMode)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("task.assign", {
    description: "Назначить ответственного из правительства страны или снять назначение. Можно задать роль, например ai-agent:hermes, backend-lead, qa.",
    inputSchema: z.object({
      countryId: countryIdSchema,
      taskId: z.string().uuid(), assigneeEmail: z.string().email().nullable(),
      assigneeRole: z.string().max(80).optional().describe("Роль ответственного, например backend-lead, ai-agent:hermes, qa"),
      idempotencyKey: z.string().min(4).max(160),
    }),
    annotations: { idempotentHint: true },
  }, async ({ countryId, taskId, assigneeEmail, assigneeRole, idempotencyKey }) => {
    try {
      await requireCountryAccess(db, identity, countryId, "tasks:write");
      return response(await service.assignTask(countryId, {
                                                taskId, assigneeUserId: assigneeEmail ? await resolveMember(countryId, assigneeEmail) ?? null : null,
                                                assigneeRole, actor: actorName, actorUserId: identity.userId, idempotencyKey,
                                              }));
    } catch (error) { return failure(error); }
  });

  server.registerTool("task.activity", {
    description: "Получить полную активность по задаче: события, комментарии, дефекты, вложения и связи с другими задачами (для MCP-агента как audit trail).",
    inputSchema: z.object({ countryId: countryIdSchema, taskId: z.string().uuid() }),
    annotations: { readOnlyHint: true },
  }, async ({ countryId, taskId }) => {
    try {
      await requireCountryAccess(db, identity, countryId, "tasks:read");
      return response(await service.getTaskActivity(countryId, taskId));
    } catch (error) { return failure(error); }
  });

  server.registerTool("task.dependency_add", {
    description: "Добавить зависимость задачи от другой задачи в том же городе. Связанная задача должна быть выполнена раньше.",
    inputSchema: z.object({ countryId: countryIdSchema, taskId: z.string().uuid(), dependsOnTaskId: z.string().uuid(), idempotencyKey: z.string().min(4).max(160) }),
    annotations: { idempotentHint: true },
  }, async (input) => {
    try {
      await requireCountryAccess(db, identity, input.countryId, "tasks:write");
      return response(await service.addTaskDependency(input.countryId, { ...input, actor: actorName, actorUserId: identity.userId }));
    } catch (error) { return failure(error); }
  });

  server.registerTool("task.dependency_remove", {
    description: "Убрать зависимость задачи от другой задачи.",
    inputSchema: z.object({ countryId: countryIdSchema, taskId: z.string().uuid(), dependsOnTaskId: z.string().uuid(), idempotencyKey: z.string().min(4).max(160) }),
    annotations: { idempotentHint: true },
  }, async (input) => {
    try {
      await requireCountryAccess(db, identity, input.countryId, "tasks:write");
      return response(await service.removeTaskDependency(input.countryId, { ...input, actor: actorName, actorUserId: identity.userId }));
    } catch (error) { return failure(error); }
  });

  server.registerTool("task.document_list", {
    description: "Получить четыре стандартных Markdown-документа задачи и дополнительные .md-файлы в порядке показа.",
    inputSchema: z.object({ countryId: countryIdSchema, taskId: z.string().uuid() }),
    annotations: { readOnlyHint: true },
  }, async ({ countryId, taskId }) => {
    try {
      await requireCountryAccess(db, identity, countryId, "tasks:read");
      const task = await service.getTask(countryId, taskId);
      return response({ taskNumber: task.taskNumber, documents: task.documents ?? [] });
    } catch (error) { return failure(error); }
  });

  server.registerTool("task.document_upsert", {
    description: "Создать или полностью обновить Markdown-документ задачи. Стандартные имена: system-analysis.md, architecture.md, design-system.md, implementation-plan.md; разрешены дополнительные kebab-case .md-файлы.",
    inputSchema: z.object({
      countryId: countryIdSchema,
      taskId: z.string().uuid(), fileName: z.string().regex(/^[a-z0-9][a-z0-9-]{0,78}\.md$/),
      title: z.string().min(2).max(100).optional().describe("Обязательно только для дополнительного документа"),
      content: z.string().max(64_000), idempotencyKey: z.string().min(4).max(160),
    }),
    annotations: { idempotentHint: true },
  }, async (input) => {
    try {
      await requireCountryAccess(db, identity, input.countryId, "tasks:write");
      return response(await service.upsertTaskDocument(input.countryId, { ...input, actor: actorName, actorUserId: identity.userId }));
    } catch (error) { return failure(error); }
  });

  server.registerTool("task.document_delete", {
    description: "Удалить дополнительный Markdown-документ задачи. Четыре стандартных документа не удаляются: при необходимости очистите их через task.document_upsert.",
    inputSchema: z.object({ countryId: countryIdSchema, taskId: z.string().uuid(), documentId: z.string().uuid(), idempotencyKey: z.string().min(4).max(160) }),
    annotations: { idempotentHint: true, destructiveHint: true },
  }, async (input) => {
    try {
      await requireCountryAccess(db, identity, input.countryId, "tasks:write");
      return response(await service.deleteTaskDocument(input.countryId, { ...input, actor: actorName, actorUserId: identity.userId }));
    } catch (error) { return failure(error); }
  });

  server.registerTool("task.checklist_replace", {
    description: "Заменить чек-лист задачи целиком, например пунктами из implementation-plan.md. Порядок массива становится порядком выполнения; пустой массив очищает чек-лист.",
    inputSchema: z.object({
      countryId: countryIdSchema,
      taskId: z.string().uuid(), items: z.array(z.object({ title: z.string().min(1).max(240), done: z.boolean().optional() })).max(50),
      idempotencyKey: z.string().min(4).max(160),
    }),
    annotations: { idempotentHint: true },
  }, async (input) => {
    try {
      await requireCountryAccess(db, identity, input.countryId, "tasks:write");
      return response(await service.replaceTaskChecklist(input.countryId, { ...input, actor: actorName, actorUserId: identity.userId }));
    } catch (error) { return failure(error); }
  });

  server.registerTool("task.checklist_item_update", {
    description: "Отметить отдельный пункт чек-листа выполненным/невыполненным или уточнить его название без замены остальных пунктов.",
    inputSchema: z.object({
      countryId: countryIdSchema,
      taskId: z.string().uuid(), itemId: z.string().uuid(), title: z.string().min(1).max(240).optional(), done: z.boolean().optional(),
      idempotencyKey: z.string().min(4).max(160),
    }).refine((value) => value.title !== undefined || value.done !== undefined, { message: "Передайте title или done" }),
    annotations: { idempotentHint: true },
  }, async (input) => {
    try {
      await requireCountryAccess(db, identity, input.countryId, "tasks:write");
      return response(await service.updateTaskChecklistItem(input.countryId, { ...input, actor: actorName, actorUserId: identity.userId }));
    } catch (error) { return failure(error); }
  });

  server.registerTool("task.link_add", {
    description: "Прикрепить к задаче ссылку на merge request (или другой http/https URL), чтобы она была видна в карточке задачи.",
    inputSchema: z.object({
      countryId: countryIdSchema,
      taskId: z.string().uuid(), url: z.string().min(8).max(2000), title: z.string().max(200).optional(),
      idempotencyKey: z.string().min(4).max(160),
    }),
    annotations: { idempotentHint: true },
  }, async (input) => {
    try {
      await requireCountryAccess(db, identity, input.countryId, "tasks:write");
      const task = await service.addTaskLink(input.countryId, { ...input, actor: actorName, actorUserId: identity.userId });
      return response({ taskNumber: task.taskNumber, mergeRequests: task.mergeRequests, url: taskUrl(input.countryId, task) });
    } catch (error) { return failure(error); }
  });

  server.registerTool("task.link_remove", {
    description: "Убрать ссылку на merge request из задачи.",
    inputSchema: z.object({ countryId: countryIdSchema, taskId: z.string().uuid(), url: z.string().min(8).max(2000), idempotencyKey: z.string().min(4).max(160) }),
    annotations: { idempotentHint: true },
  }, async (input) => {
    try {
      await requireCountryAccess(db, identity, input.countryId, "tasks:write");
      const task = await service.removeTaskLink(input.countryId, { ...input, actor: actorName, actorUserId: identity.userId });
      return response({ taskNumber: task.taskNumber, mergeRequests: task.mergeRequests, url: taskUrl(input.countryId, task) });
    } catch (error) { return failure(error); }
  });

  server.registerTool("task.attachment_add", {
    description: "Прикрепить к задаче файл любого формата (логи, скриншоты, схемы): имя, необязательный MIME и содержимое в base64.",
    inputSchema: z.object({
      countryId: countryIdSchema,
      taskId: z.string().uuid(), fileName: z.string().min(1).max(200), mimeType: z.string().max(120).optional(),
      contentBase64: z.string().min(4).max(Math.ceil(config.maxAttachmentBytes / 3) * 4)
        .regex(/^[A-Za-z0-9+/]+={0,2}$/).refine(value => value.length % 4 === 0, { message: "Нужен полный стандартный Base64 без префикса или пробелов" }),
      idempotencyKey: z.string().min(4).max(160),
    }),
    annotations: { idempotentHint: true },
  }, async (input) => {
    try {
      await requireCountryAccess(db, identity, input.countryId, "tasks:write");
      const attachment = await service.addTaskAttachment(input.countryId, {
        taskId: input.taskId, fileName: input.fileName, mimeType: input.mimeType,
        content: Buffer.from(input.contentBase64, "base64"),
        actor: actorName, actorUserId: identity.userId, idempotencyKey: input.idempotencyKey,
      });
      return response(attachment);
    } catch (error) { return failure(error); }
  });

  server.registerTool("task.attachment_list", {
    description: "Получить список файлов, прикреплённых к задаче.",
    inputSchema: z.object({ countryId: countryIdSchema, taskId: z.string().uuid() }),
    annotations: { readOnlyHint: true },
  }, async ({ countryId, taskId }) => {
    try {
      await requireCountryAccess(db, identity, countryId, "tasks:read");
      const task = await service.getTask(countryId, taskId);
      return response({ taskNumber: task.taskNumber, attachments: task.attachments ?? [] });
    } catch (error) { return failure(error); }
  });

  server.registerTool("archive.get", {
    description: "Получить Государственный архив страны и текущую стадию его комплекса на карте.",
    inputSchema: z.object({ countryId: countryIdSchema }),
    annotations: { readOnlyHint: true },
  }, async ({ countryId }) => {
    try { await requireCountryAccess(db, identity, countryId, "country:read"); return response(await service.getArchive(countryId)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("archive.record_list", {
    description: "Справки архива; view=compact возвращает страницу метаданных без body. Полный текст одной записи читает archive.record_get; full сохраняет прежний список.",
    inputSchema: z.object({ countryId: countryIdSchema, ...metadataPage }), annotations: { readOnlyHint: true },
  }, async (input) => {
    try { await requireCountryAccess(db, identity, input.countryId, "tasks:read"); return response(input.view === "compact" ? await readMcpArchiveRecords(db, input.countryId, input) : await service.listArchiveRecords(input.countryId)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("archive.record_get", {
    description: "Прочитать одну полную запись архива после ограниченного metadata list.",
    inputSchema: z.object({ countryId: countryIdSchema, recordId: z.string().uuid() }).strict(), annotations: { readOnlyHint: true },
  }, async ({ countryId, recordId }) => {
    try { await requireCountryAccess(db, identity, countryId, "tasks:read"); return response(await service.getArchiveRecord(countryId, recordId)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("archive.record_create", {
    description: "Добавить в Государственный архив устойчивый контекст, правило, репозиторий, окружение или шаблон. Не используйте архив вместо задачи.",
    inputSchema: z.object({
      countryId: countryIdSchema,
      kind: z.enum(["PROJECT", "REPOSITORY", "ARCHITECTURE", "CONVENTION", "ENVIRONMENT", "TEMPLATE"]),
      title: z.string().min(2).max(160), body: z.string().max(32000).optional(), sourceUrl: z.string().url().max(2000).optional(),
      tags: z.array(z.string().max(40)).max(10).optional(),
      idempotencyKey: z.string().min(4).max(160),
    }),
    annotations: { idempotentHint: true },
  }, async (input) => {
    try { await requireCountryAccess(db, identity, input.countryId, "cities:write"); return response(await service.createArchiveRecord(input.countryId, input)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("archive.record_update", {
    description: "Обновить запись Государственного архива.",
    inputSchema: z.object({
      countryId: countryIdSchema,
      recordId: z.string().uuid(), kind: z.enum(["PROJECT", "REPOSITORY", "ARCHITECTURE", "CONVENTION", "ENVIRONMENT", "TEMPLATE"]).optional(),
      title: z.string().min(2).max(160).optional(), body: z.string().max(32000).optional(), sourceUrl: z.string().url().max(2000).nullable().optional(),
      tags: z.array(z.string().max(40)).max(10).optional(),
      idempotencyKey: z.string().min(4).max(160),
    }),
    annotations: { idempotentHint: true },
  }, async (input) => {
    try { await requireCountryAccess(db, identity, input.countryId, "cities:write"); return response(await service.updateArchiveRecord(input.countryId, input)); }
    catch (error) { return failure(error); }
  });

  server.registerTool("archive.record_delete", {
    description: "Удалить запись Государственного архива. Для защиты передайте точное текущее название.",
    inputSchema: z.object({ countryId: countryIdSchema, recordId: z.string().uuid(), confirmTitle: z.string().min(2).max(160), idempotencyKey: z.string().min(4).max(160) }),
    annotations: { destructiveHint: true, idempotentHint: true },
  }, async (input) => {
    try { await requireCountryAccess(db, identity, input.countryId, "cities:write"); return response(await service.deleteArchiveRecord(input.countryId, input)); }
    catch (error) { return failure(error); }
  });

  server.registerResource("country", new ResourceTemplate("tasktopia://countries/{countryId}", { list: undefined }), { mimeType: "application/json" }, async (uri, variables) => {
    try {
      const countryId = String(variables.countryId);
      await requireCountryAccess(db, identity, countryId, "country:read");
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ country: await service.getCountry(countryId), archive: await service.getArchive(countryId), cities: await service.listCities(countryId) }) }],
      };
    } catch (error) { if (error instanceof DomainError) throw error; throw new Error("Внутренняя ошибка MCP", { cause: error }); }
  });
  server.registerResource("building-catalog", "tasktopia://catalog/buildings", { mimeType: "application/json" }, (uri) => {
    requireScope(identity, "country:read");
    return {
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(BUILDING_CATALOG, null, 2) }],
    };
  });

  return server;
}

function identityFromAuthInfo(authInfo: AuthInfo | undefined): McpIdentity {
  const identity = authInfo?.extra?.tasktopiaIdentity as McpIdentity | undefined;
  if (!identity?.userId || !identity.tokenId || !Array.isArray(identity.scopes)) {
    throw new DomainError("UNAUTHENTICATED", "MCP request не содержит проверенную Tasktopia identity");
  }
  return identity;
}

export function createTasktopiaMcpHandler(db: Db, service: AppService, onerror?: (error: Error) => void): McpHttpHandler {
  return createMcpHandler(
    ({ authInfo }) => createMcpServer(db, service, identityFromAuthInfo(authInfo)),
    { legacy: "stateless", responseMode: "auto", onerror },
  );
}
