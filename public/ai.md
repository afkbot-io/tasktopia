# Tasktopia AI integration guide

Version: 1.26.0
Last updated: 2026-10-28
Public guide: https://tasktopia.online/ai.md  
MCP endpoint: https://tasktopia.online/mcp

Tasktopia turns work into a living country. Countries contain cities, cities
contain districts, and every task is represented by a building.

The active CITY client loads one complete version-5
`/api/countries/:countryId/cities/:cityId/scene` response, containing compact
version-2 chunk payloads. Moving inside that city does not fetch viewport chunks.
These browser endpoints are not MCP
resources and external agents should use the tools and resources below.

The country overview uses the internal authenticated
`GET /api/countries/:countryId/overview` read model (`schemaVersion: 8`).
It carries planet-derived bounded terrain, aggregate district progress and a
semantic city miniature, compact ground-road corridors and transport connections;
full city buildings, surfaces and props are absent.
This endpoint is private UI infrastructure, uses ETag plus conditional
background revalidation, and is not an MCP resource. Agents must continue to
use explicit-country `country.get`, `city.list`, `district.list`, and the task tools.

The planet overview uses the authenticated browser-only `GET /api/planet-atlas`
read model (`schemaVersion: 5`). It contains only countries visible to the
current account, compact progress aggregates, canonical world bounds, city and
district centres, and task-backed airports. The browser projects the shared
geography from these coordinates and `planetSeed`; four-connected land groups
define continents. Logical airport connections are not ground roads. The
response uses a private ETag cache with revalidation,
and browser snapshots are isolated by account. This endpoint is UI
infrastructure, not an MCP resource; agents should use `country.list` and the
country tools below.

The authenticated browser-only `GET /api/tasks/search` response includes the
building `origin`, `cityId`/`cityName`, and the city's `cityCenter` and
`cityBounds`. The UI uses that viewport to switch cities before focusing a
building; external agents should use `task.list_page` and compact `task.get`.

This document is intended for AI agents and developers integrating through the
Model Context Protocol (MCP).

## Work model: what every entity means

Tasktopia is not only a visualization. Its hierarchy is the working context an
AI must preserve:

| Entity | Project-management meaning | Use it for |
| --- | --- | --- |
| Country | An independent project, product, or workspace | The top-level goal, access boundary, and portfolio context |
| State Archive | A compact country-level reference | Durable rules, repository/environment links, architecture summaries and reusable templates |
| City | A long-lived project association, product direction, epic, or subproject | Grouping work that shares one stable domain and outcome |
| District | A sprint, iteration, milestone, phase, or bounded work package | A goal and advisory workload target for the current delivery cycle |
| Task/building | One concrete, verifiable unit of work | An outcome with acceptance criteria, estimate, owner, and progress |

### Fields AI agents must preserve

| Level | Fields | Purpose |
| --- | --- | --- |
| Country/project | `description`, `goal`, `productContext`, `successCriteria`, `constraints` | Stable product brief; read before planning any epic |
| State Archive | record `kind`, `title`, `body`, `sourceUrl`, `tags` | Short durable context shared by humans and AI; active work remains in tasks |
| City/epic | `description`, `goal`, `acceptanceCriteria`, `deadline` | Scope, expected epic outcome, exit conditions and target date |
| District/sprint | `goal`, `description`, `deadline`, `capacitySp` | Sprint goal, operating notes, timebox and advisory team workload |
| Task/work item | `workItemType`, `description`, `acceptanceCriteria`, Markdown documents, checklist, `estimate`, `priority`, `dueAt`, `assigneeEmail`, `assigneeRole`, `forUserEmail` | Executable brief, accountable executor, result owner and observable progress |
| Linked defect | `title`, `description`, `reproductionSteps`, `actualResult`, `expectedResult`, `status` | Reproducible observation attached to a task; its own lifecycle is `OPEN → IN_PROGRESS → VERIFYING → FIXED` |

`workItemType` is one of `TASK`, `BUG`, `RELEASE`, `HOTFIX`. A `BUG` work
item is delivery work in the roadmap. A linked defect is an observation found
inside any task and is managed through `task.defect_create` and
`task.defect_update`. Do not use one as a substitute for the other.

Do not create a city for one task, use a district as a label, or move work into
an arbitrary entity because its ID is convenient. When the country, city, or
district is ambiguous, read the available hierarchy and ask the user before a
write. A city is the association between a task stream and its project
direction; it is normally longer-lived than a sprint.

The State Archive is part of the country map but not part of the work hierarchy.
Use it for concise facts that should remain true across many tasks. Add a task
when work has an owner, status, dependency or completion criterion. The archive
complex grows from one to four unique buildings as its record count reaches
3, 6 and 10; this visual growth never changes workload or city statistics.

## Install the progress-management skill

A production-ready Codex skill is published at:

`https://tasktopia.online/skills/tasktopia-progress/SKILL.md`

It adds context resolution, mandatory clarification rules, task-writing
templates, evidence-based progress reporting, blocking workflow, safe status
transitions, and completion gates. Install it globally for the current user:

```bash
mkdir -p ~/.codex/skills/tasktopia-progress/agents
curl -fsS https://tasktopia.online/skills/tasktopia-progress/SKILL.md \
  -o ~/.codex/skills/tasktopia-progress/SKILL.md
curl -fsS https://tasktopia.online/skills/tasktopia-progress/agents/openai.yaml \
  -o ~/.codex/skills/tasktopia-progress/agents/openai.yaml
```

Start a new Codex task after installation so the skill catalog is refreshed.
Invoke it explicitly when needed:

```text
Используй $tasktopia-progress. Проверь текущий проект, найди нужное направление
и итерацию, затем поставь задачу и веди её прогресс по фактическим результатам.
```

The skill does not contain a personal key. Configure the MCP endpoint and
Bearer key separately as described below. Other agents can use the same
`SKILL.md` as a system/workflow instruction even if they do not support the
Codex skill directory convention.

## Quick start

1. Sign in at https://tasktopia.online.
2. Open the account panel and create a personal MCP key.
3. Copy the key immediately. Its secret is shown only once.
4. Configure an MCP client with the endpoint and an Authorization header.
5. Call `country.list`, choose the intended `countryId`, and pass it to every
   country-scoped tool while reading the relevant city, district, and task.

Generic client configuration:

```json
{
  "mcpServers": {
    "tasktopia": {
      "url": "https://tasktopia.online/mcp",
      "headers": {
        "Authorization": "Bearer <PERSONAL_MCP_KEY>"
      }
    }
  }
}
```

The key begins with `ttp_mcp_`. Use the exact `Authorization: Bearer ...`
format. Query-string tokens, cookies, `X-API-Key`, and bare tokens are not
accepted.

## Transport and protocol

- Transport: MCP Streamable HTTP at `https://tasktopia.online/mcp`.
- Current protocol: MCP 2026-07-28.
- Compatibility: stateless MCP 2025-11-25 clients are accepted.
- HTTP methods: `POST` for JSON-RPC; `GET` and `DELETE` are part of the
  Streamable HTTP transport lifecycle.
- Each request must carry the personal Bearer key.
- Send `Content-Type: application/json` for JSON-RPC requests.
- Browser clients must originate from `https://tasktopia.online`.

Tasktopia currently uses user-created personal API keys. It does not advertise
an OAuth authorization-server flow. Do not attempt OAuth discovery for this
endpoint.

## Permissions

A key can contain any combination of these scopes:

| Scope | Allows |
| --- | --- |
| `country:read` | Read an explicitly requested country and list available countries |
| `cities:write` | Update the country profile and State Archive; create, update, rename, or delete cities |
| `districts:write` | Create, update, rename, activate, complete, and delete districts |
| `tasks:read` | Read tasks and task details |
| `tasks:write` | Create/update tasks and linked defects, report progress, assign, and delete tasks |
| `comments:write` | Add task comments |

Request only the permissions an integration needs. A key is bound to its owner.
Every tool except `country.list` requires an explicit `countryId`. MCP never
reads or changes the country selected in the web UI, so concurrent agents cannot
redirect one another's requests by mutating shared account state. Membership and
role are resolved for the requested country on every call.

## Safe agent workflow

Follow this sequence unless the user explicitly asks for something else:

1. Call `country.list` with `view: "compact"` and choose the user-confirmed `countryId`.
2. Call `country.get` with that `countryId` and `view: "compact"`.
3. Page through `archive.record_list` with `view: "compact"` when project context matters; use `archive.record_get` for the needed bodies.
4. Page through compact `city.list` with that `countryId`; do not invent city IDs.
5. Use compact `district.list` with `countryId` for the relevant city.
6. Find an existing task with `task.list_page`, read compact `task.get`, then only the necessary collection pages and documents in the same country.
7. Make the smallest requested change.
8. Re-read the changed entity and report the result to the user.

Before creating work, ask only for information that remains genuinely
ambiguous. A compact confirmation should cover: country/project,
city/direction, district/iteration, expected task outcome, acceptance evidence,
estimate, and assignee when assignment matters. If exactly one matching context
exists, the agent may use it after stating the assumption.

For progress-centric operation:

1. Read compact `task.get` before an update; reuse that snapshot until a meaningful checkpoint or external change.
2. Read relevant checklist pages with `task.collection_list` and implementation documents with `task.document_get`, then update the relevant checklist item after a measurable checkpoint.
3. Use `task.report_progress` after a measurable checkpoint, not on a timer.
4. Base the percentage on completed checklist items, acceptance criteria or verified artifacts,
   never on effort spent.
5. Record blockers with `task.add_comment` without inflating progress.
6. Enter `TESTING` only after implementation is complete and a verification
   method exists.
7. Enter `COMPLETED` at 100% only after every checklist item and acceptance criterion is verified.

Exact progress ranges are `PLANNING = 0`, `STARTED = 0`, `IN_PROGRESS = 1–79`,
`TESTING = 80–99`, and `COMPLETED = 100`.

For every retried mutation, reuse the same `idempotencyKey`. Generate a new
idempotency key for a new user intent. Never place the personal MCP key in task
text, comments, logs, or tool arguments.

## Tools

Spatial commands are isolated from the MCP process: `city.create`,
`district.create`, `task.create`, `country.regenerate`, `task.set_status`
(including `task.report_progress`), `task.transfer`, `task.delete`, `city.delete`,
`district.delete`, and `district.complete` normally return their existing result, but
may return `{ "status": "accepted", "job": { ... } }` when generation exceeds
the bounded wait. This is a successful durable acceptance, not a tool error.
Keep the same idempotency key and poll `world_generation.get` with `job.id`;
do not submit a second command with a new key.

Acceptance means durable enqueue, not a completed mutation. The worker checks
current state and exact deletion confirmation; a rejected guard produces a
terminal `FAILED` without a partial mutation. The current worker preserves FIFO
inside a country and fair turns across countries. Migration `0046` keeps the six
new commands in internal `QUEUED`/`EXECUTING` states, exposed publicly as
`PENDING`/`RUNNING`. Older workers cannot claim them. During a mixed-version
rollout or rollback they wait for a current worker; strict combined FIFO is not
guaranteed with an old worker, and durable data/jobs remain preserved.
Migration `0047` preserves original new-command serialization across JSONB
queueing so pre-upgrade synchronous receipt retries retain their identity;
historical receipt hashes are not rewritten.

Disconnecting a waiting HTTP/MCP caller releases that caller's wait, not the
committed command. The job may complete afterward: retry the same key or poll.
Cancellation signals never enter payload/command identity and do not cancel the
worker's SQL transaction.
An already-cancelled request before enqueue returns `CANCELLED` without a new job.

#### `world_generation.get`

Reads one accepted generation operation in the explicitly requested country.

```json
{ "countryId": "<country-id>", "jobId": "<job-uuid>" }
```

`PENDING` and `RUNNING` are transient. `COMPLETED` includes `result`; final
`FAILED` includes a safe error object. Polling `task.*` operations requires
`tasks:read`; country/city/district operations require `country:read`. A write
scope alone does not grant polling. Accepted and polling responses omit input
`payload`. Unexpected `GENERATION_FAILED` messages, including historical jobs,
are fixed to `Генерация завершилась с ошибкой`; resource failures redact internal
server errors too.

Pass optional `view: "compact"` to get a completed `task.create`, `task.set_status`
or `task.transfer` result as a short `task.command-result` without
history/documents/comments. Other operation
results retain their shapes. Omitted `view` returns the compatible full result.

The server exposes 51 tools.

### Compact structure reads

Prefer `view: "compact"` for `country.list`, `city.list`, `district.list`, and
`archive.record_list`. Each returns `kind`, `version: 1`, `items`, `nextCursor`
and, except the account country list, `countryId`. Their kinds are
`country.list-page`, `city.list-page`, `district.list-page`, `archive.record-page`.
Optional `limit` defaults to 50 and accepts 1–100; `cursor` and `limit` apply
only to compact mode. Continue with the same context until `nextCursor: null`.
Ordering is creation time then ID ascending, preserving PostgreSQL timestamp
precision. A cursor belongs to its list kind, account for countries, country,
and optional `cityId` for districts. Incompatible cursors are rejected.

These metadata pages omit long country/city descriptions, district `cells` and
`lots`, and archive `body`. Cities expose task/district counts, districts expose
grouped `workload`, archive metadata exposes `bodyLength`. Full mode or omitted
`view` preserves the old complete arrays/shapes without truncation. Tool JSON text
uses compact serialization; `structuredContent` contains the same data.

### Countries

#### `country.get`

Returns the explicitly requested country, its State Archive, and cities.
With `view: "compact"`, returns `kind: "country.card", version: 1`, the country
profile, archive, and `counts.cities` instead of the city list.

```json
{ "countryId": "<country-id>" }
```

Required scope: `country:read`.

#### `country.list`

Lists countries available to the owner. With no arguments it preserves the full
array; prefer the compact metadata page described above.

Required scope: `country:read`.

#### `country.update_profile`

Updates the long-lived project brief. It requires an owner account and
`cities:write`. Omitted fields remain unchanged; an empty string deliberately
clears a text field.

```json
{
  "countryId": "<country-id>",
  "goal": "Reduce onboarding time to under five minutes",
  "productContext": "B2B teams migrating from spreadsheets",
  "successCriteria": "Activation >= 60%; no critical accessibility defects",
  "constraints": "PostgreSQL, public API compatibility, RU/EN UI",
  "idempotencyKey": "country-profile-onboarding-v2"
}
```

### State Archive

#### `archive.get`

Returns the country archive identity, record count, and visual stage. Pass `countryId`.
Required scope: `country:read`.

#### `archive.record_list`

Lists archive records for the requested country. Prefer `view: "compact"` to
page through metadata without `body` before adding overlapping context. The
default preserves the full array. Required scope: `tasks:read`.

#### `archive.record_get`

Reads one complete archive record using `countryId` and `recordId`, rejecting
foreign or deleted records. Required scope: `tasks:read`.

#### `archive.record_create`

Creates durable project reference material. Allowed kinds are `PROJECT`,
`REPOSITORY`, `ARCHITECTURE`, `CONVENTION`, `ENVIRONMENT`, and `TEMPLATE`.

```json
{
  "countryId": "<country-id>",
  "kind": "REPOSITORY",
  "title": "Main repository",
  "body": "Production monorepo; default branch is main",
  "sourceUrl": "https://github.com/example/product",
  "tags": ["git", "production"],
  "idempotencyKey": "archive-main-repository-v1"
}
```

Required scope: `cities:write`. Use a task instead when the information has a
workflow status, assignee, dependency, deadline or acceptance criteria.

#### `archive.record_update`

Updates a record by `recordId`; omitted fields remain unchanged and
`sourceUrl: null` removes the link. Required scope: `cities:write`.

#### `archive.record_delete`

Deletes a record after the exact `confirmTitle` is supplied. This may reduce
the visible archive stage. Required scope: `cities:write`; explicit user intent
is required because deletion is permanent.

### Cities

#### `city.list`

Lists cities in the requested country. Pass `countryId`; prefer `view: "compact"`
for metadata pages with district/task counts.

Required scope: `country:read`.

#### `city.get`

Reads one city.

```json
{ "countryId": "<country-id>", "cityId": "<city-id>" }
```

Full mode requires `country:read` and `tasks:read`. With `view: "compact"`, the
`kind: "city.card", version: 1` response contains city metadata/counts without
tasks or district geometry and requires only `country:read`.

#### `city.create`

Creates a city in the requested country.

```json
{
  "countryId": "<country-id>",
  "name": "Payments platform",
  "description": "Payments domain and its boundaries",
  "goal": "Make retryable payments production-ready",
  "acceptanceCriteria": "Recovery metrics and rollback are verified",
  "deadline": "2026-09-30T18:00:00.000Z",
  "morphology": "BALANCED",
  "idempotencyKey": "create-city-payments-v1"
}
```

`description` and `morphology` are optional. `idempotencyKey` is required.
Allowed morphology values are `BALANCED`, `DENSE_CORE`, `GARDEN_CITY`, and
`POLYCENTRIC`. Reuse the same idempotency key when retrying this exact creation.

Required scope: `cities:write`.

#### `city.rename`

Renames an existing city.

```json
{ "countryId": "<country-id>", "cityId": "<city-id>", "name": "New city name", "idempotencyKey": "rename-city-v1" }
```

Required scope: `cities:write`.

#### `city.update`

Updates a city/epic without changing its ID or geometry. It accepts optional
`name`, `description`, `goal`, `acceptanceCriteria`, and nullable `deadline`,
plus required `idempotencyKey`. Use `deadline: null` to clear the date.

#### `city.delete`

Permanently deletes a city and cascades its districts, tasks and comments. Permanent former task sites remain country-owned history and are never available for new construction. Deleting the country itself removes that history for privacy. Pass the exact current name to prevent accidental deletion.

```json
{ "countryId": "<country-id>", "cityId": "<city-id>", "confirmName": "Exact city name", "idempotencyKey": "delete-city-v1" }
```

Required scope: `cities:write`. This operation is destructive; always read the city and ask the user for explicit deletion intent first.

### Districts

#### `district.list`

Lists districts. Omit `cityId` to list districts across all cities in the
requested country.

```json
{ "countryId": "<country-id>", "cityId": "<optional-city-id>" }
```

Required scope: `country:read`.

#### `district.create`

Creates a district.

```json
{
  "countryId": "<country-id>",
  "cityId": "<city-id>",
  "name": "Northern district",
  "goal": "Ship billing recovery",
  "description": "Two-week iteration for recovery and observability",
  "deadline": "2026-08-21T18:00:00.000Z",
  "capacitySp": 40,
  "activate": false,
  "archetype": "COMMERCIAL",
  "idempotencyKey": "create-sprint-12-v1"
}
```

`cityId`, `name`, and `idempotencyKey` are required. Allowed archetypes are
`NEW_BUILD`, `PRIVATE`, `MIXED_URBAN`, `COMMERCIAL`, and `CIVIC`.
`capacitySp` is an optional positive planning target. It never blocks task
creation: sprint duration, team size, parallel owners, and actual workload are
for the team to evaluate. `district.list`, `city.get`, `task.create`, and
`task.delete` expose `workload` with `targetSp`, `plannedSp`, `openSp`,
`taskCount`, and `overTargetBySp`. Do not create an extra district merely
because the target is exceeded.

Required scope: `districts:write`.

#### `district.delete`

Permanently deletes a district and all of its tasks. If the deleted district was active, the oldest planned district becomes active automatically.

```json
{ "countryId": "<country-id>", "districtId": "<district-id>", "confirmName": "Exact district name", "idempotencyKey": "delete-district-v1" }
```

Required scope: `districts:write`. Read the district and its tasks, state the cascade, and require explicit user intent before calling it.

#### `district.rename`

Renames an existing district without changing its geometry or status.

```json
{ "countryId": "<country-id>", "districtId": "<district-id>", "name": "New district name", "idempotencyKey": "rename-district-v1" }
```

Required scope: `districts:write`.

#### `district.update`

Updates sprint metadata without rebuilding the district. It accepts optional
`name`, `goal`, `description`, nullable `deadline`, advisory `capacitySp`, and
required `idempotencyKey`. Exceeding `capacitySp` remains valid.

#### `district.activate`

Marks a district as active.

```json
{
  "countryId": "<country-id>",
  "districtId": "<district-id>",
  "idempotencyKey": "activate-sprint-12-v1"
}
```

Required scope: `districts:write`.

#### `district.complete`

Completes a district.

```json
{
  "countryId": "<country-id>",
  "districtId": "<district-id>",
  "idempotencyKey": "complete-sprint-12-v1"
}
```

Required scope: `districts:write`.

### Tasks and buildings

#### `task.list`

Lists tasks. Omit `districtId` to list across the requested country.

```json
{ "countryId": "<country-id>", "districtId": "<optional-district-id>" }
```

Required scope: `tasks:read`.

#### `task.get`

Reads one task with its current state, documents, checklist, defects, linked
artifacts, human-facing task number, and browser URL.

```json
{ "countryId": "<country-id>", "taskId": "<task-id>" }
```

Required scope: `tasks:read`.

#### Bounded reads: `task.list_page`, `task.collection_list`, `task.document_get`

For large task histories, use `task.get` with optional `view: "compact"`. It
returns a distinct `kind: "task.card", version: 1` with overview text, accounts,
geometry, real collection counts and at most 50 document metadata records.
Document metadata includes `isFilled` and `contentLength`, never `content`.
Omitting `view` preserves the full legacy response.

`task.list_page` accepts explicit `countryId`, optional `q`, `cityId`, `districtId`,
`status`, `workItemType`, `priority`, `assigneeUserId`, `limit`, `cursor`. It returns
`kind: "task.list-page", version: 1` with short task locations ordered by updated
time and ID descending. Keep the same country and filters when continuing.

`task.collection_list` accepts explicit `countryId`, `taskId`, `collection` and
optional `limit`, `cursor`, `order: "asc" | "desc"`. Collections are `comments`,
`events`, `defects`, `attachments`, `documents`, `checklist`, `dependencies`,
`mergeRequests`. It returns `kind: "task.collection-page", version: 1`, `items`,
`nextCursor`. History defaults to latest first, documents/checklist to position,
and dependencies to task number. Cursors belong to one country, task, collection
and order. Both tools default to 50 records and accept 1–100; the final page has
`nextCursor: null`. All three tools require `tasks:read`.

`task.document_get` takes `countryId`, `taskId`, `documentId` and returns only that
full Markdown document. It rejects foreign or deleted documents.

`task.add_comment`, `task.set_status`, `task.report_progress`, `task.transfer` accept optional
`resultMode: "compact"` for a small, explicitly tagged `task.command-result`
(version 1). The default remains full. Result mode does not change command
identity: retrying the same key and payload with another mode never repeats the
mutation. Task numbers increase for the lifetime of a country and are not reused
after deletion. Existing full clients and stored receipts remain compatible.

#### `task.create`

Creates a task and its world visual. The default visual is a building. A public
park is also a task, not a decorative record: it receives the same task number,
card, five statuses, checklist, defects, deletion and realtime updates.

```json
{
  "countryId": "<country-id>",
  "cityId": "<city-id>",
  "districtId": "<optional-district-id>",
  "title": "Add retry policy",
  "workItemType": "TASK",
  "description": "Retry transient provider errors without duplicate charges",
  "acceptanceCriteria": "Idempotency and backoff tests pass; metrics are visible",
  "estimate": 3,
  "priority": "HIGH",
  "dueAt": "2026-08-12T12:00:00.000Z",
  "assigneeEmail": "person@example.com",
  "assigneeRole": "backend-lead",
  "forUserEmail": "product-owner@example.com",
  "idempotencyKey": "create-task-retry-policy-v1"
}
```

Required fields: `countryId`, `cityId`, `title`, `estimate`, and `idempotencyKey`. Allowed
estimates are `1`, `2`, `3`, or `6`. Allowed priorities are `LOW`, `NORMAL`,
`HIGH`, and `CRITICAL`.

`assigneeEmail` is the registered country member accountable for execution.
`assigneeRole` records the capacity in which that person or agent works, for
example `backend-lead`, `qa`, or `ai-agent:codex`. `forUserEmail` identifies the
registered customer/result owner for whom the work is performed. The MCP key
owner remains the task creator; creator, assignee, and result owner may differ.

Участок и внешний вид выбираются сервером автоматически: сначала свободное
место существующего квартала района, затем подходящий дом или общественное
пространство. `buildingHint`, `visualKind` и `parkVariant` больше не принимаются.
Оценка описывает объём работы, а не размер здания. Новый квартал появляется
только при отсутствии подходящего места в существующих кварталах района.

Required scope: `tasks:write`.

#### `task.transfer`

Moves an existing task to a different sprint in the same city and explicitly
requested country. Required scope: `tasks:write`; current country membership
must permit writes. It preserves UUID, number, status, history and service role.
Прежний участок освобождается и может быть занят новой задачей. Запись о переносе
остаётся в истории задачи. Не удаляйте и не создавайте задачу заново для переноса.

```json
{
  "countryId": "<country-id>",
  "taskId": "<task-id>",
  "targetDistrictId": "<different-sprint-id-in-the-same-city>",
  "comment": "Move to the next sprint",
  "idempotencyKey": "task-transfer-next-sprint-v1"
}
```

`comment` and `resultMode: "full" | "compact"` are optional; other fields are required.
`comment` is limited to 4000 characters;
unknown fields are rejected. A completed/abandoned destination or another city
is not allowed. Размещение и история меняются атомарно; при ошибке исходная задача остаётся
на месте. Повтор с тем же ключом не выполняет перенос повторно. The response is the current task plus its canonical browser URL.
Task URLs returned by get/create/transfer/link operations include both `countryId`
and `taskId`: `/task/<number>?countryId=<country-id>&taskId=<task-id>`. Preserve
these parameters: task numbers are country-local, while UUID survives relocation.

#### `task.update_fields`

Updates task metadata without changing workflow status. Optional fields include
`title`, `description`, `workItemType`, `acceptanceCriteria`, `estimate`,
`priority`, nullable `dueAt`, `assigneeRole`, and `forUserEmail`. The legacy planning text fields remain
accepted for compatible clients (`systemAnalysis`, `architecture`,
`designSystem`, `implementationPlan`) and synchronize the four standard documents,
but new agents should use `task.document_upsert`.

Required scope: `tasks:write`.

#### Task Markdown documents

Every task starts with four stable document slots:

- `system-analysis.md` — actors, desired behavior, data, integrations, risks and edge cases;
- `architecture.md` — boundaries, contracts, storage, migration, rollout/rollback and trade-offs;
- `design-system.md` — components, tokens, states, responsive and accessibility decisions;
- `implementation-plan.md` — ordered, verifiable implementation steps.

Use `task.document_list` to read them. Use `task.document_upsert` to create or
replace one complete document. Additional lowercase kebab-case `.md` files are
allowed for a task-specific runbook, rollout plan or investigation. Use
`task.document_delete` only for an additional document; a standard document is
cleared by upserting empty content and cannot be deleted.

```json
{
  "countryId": "<country-id>",
  "taskId": "<task-id>",
  "fileName": "implementation-plan.md",
  "title": "План реализации",
  "content": "# План\n\n1. Add the migration.\n2. Verify rollback.",
  "idempotencyKey": "task-plan-v2"
}
```

#### Task checklist

Use `task.checklist_replace` after agreeing the plan to create an ordered list
of concrete steps. It replaces the complete checklist; an empty array clears
it, and at most 50 items are accepted. During execution use
`task.checklist_item_update` with `itemId` to mark one
step done or refine its title. Re-read `task.get` before and after the write.

```json
{
  "countryId": "<country-id>",
  "taskId": "<task-id>",
  "items": [
    { "title": "Add the migration", "done": true },
    { "title": "Verify rollback" }
  ],
  "idempotencyKey": "task-checklist-from-plan-v1"
}
```

В интерфейсе просматривают документы, чек-лист, MR, доказательства, дефекты
и историю задачи. Рабочие изменения, включая перенос между спринтами,
выполняются через MCP; интерфейс служит для просмотра и навигации.

#### `task.defect_create`

Creates a linked defect on an existing task. Provide `taskId`, `title`, optional
`description`, non-empty `reproductionSteps`, `actualResult`, `expectedResult`,
and `idempotencyKey`. It starts as `OPEN`. Do not silently change the parent
task type or status.

```json
{
  "countryId": "<country-id>",
  "taskId": "<task-id>",
  "title": "Duplicate payment after timeout",
  "reproductionSteps": "1. Delay provider response\n2. Retry checkout\n3. Open ledger",
  "actualResult": "Two capture rows exist",
  "expectedResult": "One capture row is reconciled",
  "idempotencyKey": "defect-duplicate-capture-v1"
}
```

Required scope: `tasks:write`.

#### `task.defect_update`

Updates defect evidence and its independent lifecycle:

- `OPEN → IN_PROGRESS` when repair work starts;
- `IN_PROGRESS → VERIFYING` when the fix is ready for a retest;
- `VERIFYING → FIXED` only after a successful retest;
- `VERIFYING → IN_PROGRESS` when the retest fails;
- `FIXED → OPEN` when the defect is reproduced again.

Keep the parent task in `TESTING` and preserve its progress while an ordinary
linked defect is repaired. Move the parent `TESTING → IN_PROGRESS` only when
the task itself needs scope-level rework. Task completion is rejected while any
linked defect is not `FIXED`. Passing `FIXED` records `fixedAt`; reopening clears
it. Re-read the parent with `task.get` after every mutation.

Required scope: `tasks:write`.

#### `task.delete`

Permanently deletes one task/building. Its site remains occupied by permanent ruins
with limited historical information; a later task can never reuse it.

```json
{ "countryId": "<country-id>", "taskId": "<task-id>", "confirmTitle": "Exact task title", "idempotencyKey": "delete-task-v1" }
```

Required scope: `tasks:write`. Read the task first and require explicit deletion intent.

#### `task.rename`

Renames a task and the title associated with its building. The change is added
to the task event history.

```json
{ "countryId": "<country-id>", "taskId": "<task-id>", "title": "New task title", "idempotencyKey": "rename-task-v1" }
```

Required scope: `tasks:write`.

#### `task.set_status`

Moves a task to a valid workflow state. Optionally records progress and a
comment in the same operation.

```json
{
  "countryId": "<country-id>",
  "taskId": "<task-id>",
  "status": "IN_PROGRESS",
  "progress": 35,
  "comment": "API contract implemented",
  "idempotencyKey": "task-status-api-contract-v1"
}
```

Required scope: `tasks:write`.

#### `task.report_progress`

Reports status, progress, and a progress comment together.

```json
{
  "countryId": "<country-id>",
  "taskId": "<task-id>",
  "status": "IN_PROGRESS",
  "progress": 70,
  "comment": "Tests pass; browser QA remains",
  "idempotencyKey": "task-progress-browser-qa-v1"
}
```

Required scope: `tasks:write`.

#### `task.add_comment`

Adds a comment without changing task status.

```json
{
  "countryId": "<country-id>",
  "taskId": "<task-id>",
  "body": "Blocked pending access approval",
  "idempotencyKey": "comment-access-blocker-v1"
}
```

Required scope: `comments:write`.

#### `task.assign`

Assigns a task by account email and optionally records the executor's role. Set
`assigneeEmail` to `null` to unassign. Changing the assignee does not silently
change `forUserEmail`.

```json
{
  "countryId": "<country-id>",
  "taskId": "<task-id>",
  "assigneeEmail": "person@example.com",
  "assigneeRole": "qa",
  "idempotencyKey": "assign-task-person-v1"
}
```

Required scope: `tasks:write`.

#### Additional task context tools

- Every tool in this section also requires the same explicit `countryId`.
- `task.activity` accepts `taskId` and reads the audit trail: events, comments,
  defects, attachments and dependencies. `task.get` also returns documents and
  the checklist.
- `task.document_list`, `task.document_upsert`, and `task.document_delete`
  manage task-scoped Markdown material as described above.
- `task.checklist_replace` and `task.checklist_item_update` manage ordered
  execution steps and their done state.
- `task.dependency_add` and `task.dependency_remove` accept `taskId`,
  `dependsOnTaskId`, and (for writes) `idempotencyKey`. Both tasks must belong
  to one city; use the dependency only when the second task must finish first.
- `task.link_add` accepts `taskId`, an HTTP(S) `url`, optional `title`, and
  `idempotencyKey`. Use it for commits, MR/PRs, CI runs, designs, or other
  repository evidence. `task.link_remove` removes the exact URL.
- `task.attachment_add` accepts `taskId`, `fileName`, optional `mimeType`,
  Base64 `contentBase64`, and `idempotencyKey`. Use it for evidence that cannot
  be represented by a stable URL. `task.attachment_list` reads attachment
  metadata; the human UI remains view-only.

`contentBase64` — полный стандартный Base64 с padding, без пробелов и `data:`.
Пустой файл и файл больше настроенного лимита (по умолчанию 10 MiB) отклоняются.
Повтор с тем же `idempotencyKey` проверяет SHA-256 содержимого:
другие байты, в том числе той же длины,
возвращают `CONFLICT`. Старый receipt проверяется по сохранённому файлу;
если файл недоступен, повтор возвращает `CONFLICT`, не создавая дубль.

Read before mutation, use a stable `idempotencyKey` for every write, and keep
repository artifacts linked to the task that produced or verified them.

## Resources

### `tasktopia://countries/{countryId}`

Returns the explicitly addressed country, its State Archive, and cities. The
resource does not read or change the country selected in the web UI.

Required scope: `country:read`.

### `tasktopia://catalog/buildings`

Returns the supported building catalog used by task visualization.

Required scope: `country:read`.

## Responses and errors

Successful tools return structured MCP content. The primary machine-readable
payload is under `structuredContent.result`; a JSON text representation is also
provided for clients that consume text content.

Transport-level failures:

- `401 Unauthorized`: missing, malformed, expired, or revoked Bearer key;
- `403 Forbidden`: a browser Origin is not allowed;
- `429 Too Many Requests`: rate limit reached; wait before retrying;

Validated tool calls return protocol-level MCP results. Missing `countryId`,
missing scopes, `COUNTRY_ACCESS_DENIED`, invalid or inaccessible IDs, conflicts, invalid transitions, and domain validation
failures are returned as MCP tool results with `isError: true`, not as HTTP
`403`, `404`, or `409`. Inspect the returned error content and never silently
assume a mutation succeeded.

On ambiguous network failure, read the entity before retrying. If a retry is
still necessary, reuse the original `idempotencyKey`.

## Agent rules

- Confirm one `countryId` through `country.list` and pass it explicitly to every project-scoped call.
- Never guess entity IDs or silently create substitute entities.
- Preserve the user's hierarchy: country → city → district → task/building.
- Prefer one small, verifiable mutation at a time.
- Respect task transition rules reported by the server.
- Do not mark work complete merely because code was generated.
- After a mutation, verify the resulting entity and explain what changed.
- Treat the personal MCP key as a password and never expose it in output.

## Human links

- Application: https://tasktopia.online
- MCP guide: https://tasktopia.online/ai.md
- Progress skill: https://tasktopia.online/skills/tasktopia-progress/SKILL.md
- MCP endpoint: https://tasktopia.online/mcp


## Интерфейс читает, MCP управляет работой

Создание и изменение задач, стадий, прогресса, исполнителей, комментариев и
чек-листов выполняются через MCP. Не предлагайте пользователю искать в интерфейсе
кнопку «Взять в работу»: карточки, документы и карта служат для просмотра и навигации.
При `PLANNING → STARTED` через `task.set_status` или `task.report_progress` задача
без исполнителя атомарно назначается авторизованному владельцу MCP-токена.
Существующее назначение сохраняется; явная передача выполняется через `task.assign`.
Открытие карточки, комментарий и изменение описания не назначают исполнителя.
`actor` и `assigneeRole` не заменяют подтверждённую учётную запись. Общий токен
означает общего владельца; не выдавайте его за отдельную личность агента.
Настройки аккаунта и состояние прочтения уведомлений не изменяют задачи.
