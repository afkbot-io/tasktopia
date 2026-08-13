# Tasktopia AI integration guide

Version: 1.13.2
Last updated: 2026-08-13
Public guide: https://tasktopia.online/ai.md  
MCP endpoint: https://tasktopia.online/mcp

Tasktopia turns work into a living country. Countries contain cities, cities
contain districts, and every task is represented by a building.

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
5. Call `country.get_current`, then read the relevant city, district, and task
   before making changes.

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
| `country:read` | Read the selected country and list available countries |
| `cities:write` | Update the country profile and State Archive; create, update, rename, or delete cities |
| `districts:write` | Create, update, rename, activate, complete, and delete districts |
| `tasks:read` | Read tasks and task details |
| `tasks:write` | Create/update tasks and linked defects, report progress, assign, and delete tasks |
| `comments:write` | Add task comments |

Request only the permissions an integration needs. A key is bound to its owner.
The selected country belongs to the account, not to an individual key, so
`country.select` affects later MCP requests made by every key of that account.

## Safe agent workflow

Follow this sequence unless the user explicitly asks for something else:

1. Call `country.get_current`.
2. If needed, call `country.list` and then `country.select`.
3. Call `archive.record_list` when project rules, repository links or architecture context affect the work.
4. Call `city.list`; do not invent city IDs.
5. Call `district.list` for the relevant city.
6. Call `task.list` and `task.get` before updating an existing task.
7. Make the smallest requested change.
8. Re-read the changed entity and report the result to the user.

Before creating work, ask only for information that remains genuinely
ambiguous. A compact confirmation should cover: country/project,
city/direction, district/iteration, expected task outcome, acceptance evidence,
estimate, and assignee when assignment matters. If exactly one matching context
exists, the agent may use it after stating the assumption.

For progress-centric operation:

1. Read `task.get` before every update.
2. Read the checklist and implementation documents, then update the relevant checklist item after a measurable checkpoint.
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

The server exposes 46 tools.

### Countries

#### `country.get_current`

Returns the country currently selected for this account. No arguments.

Required scope: `country:read`.

#### `country.list`

Lists countries available to the owner. No arguments.

Required scope: `country:read`.

#### `country.select`

Selects the country used by subsequent requests.

Arguments:

```json
{ "countryId": "<country-id>" }
```

Required scope: `country:read`.

#### `country.update_profile`

Updates the long-lived project brief. It requires an owner account and
`cities:write`. Omitted fields remain unchanged; an empty string deliberately
clears a text field.

```json
{
  "goal": "Reduce onboarding time to under five minutes",
  "productContext": "B2B teams migrating from spreadsheets",
  "successCriteria": "Activation >= 60%; no critical accessibility defects",
  "constraints": "PostgreSQL, public API compatibility, RU/EN UI",
  "idempotencyKey": "country-profile-onboarding-v2"
}
```

### State Archive

#### `archive.get`

Returns the country archive identity, record count, and visual stage. No arguments.
Required scope: `country:read`.

#### `archive.record_list`

Lists every compact archive record for the selected country. Read this before
adding overlapping context. Required scope: `tasks:read`.

#### `archive.record_create`

Creates durable project reference material. Allowed kinds are `PROJECT`,
`REPOSITORY`, `ARCHITECTURE`, `CONVENTION`, `ENVIRONMENT`, and `TEMPLATE`.

```json
{
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

Lists cities in the selected country. No arguments.

Required scope: `country:read`.

#### `city.get`

Reads one city.

```json
{ "cityId": "<city-id>" }
```

Required scopes: `country:read` and `tasks:read`.

#### `city.create`

Creates a city in the selected country.

```json
{
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
{ "cityId": "<city-id>", "name": "New city name", "idempotencyKey": "rename-city-v1" }
```

Required scope: `cities:write`.

#### `city.update`

Updates a city/epic without changing its ID or geometry. It accepts optional
`name`, `description`, `goal`, `acceptanceCriteria`, and nullable `deadline`,
plus required `idempotencyKey`. Use `deadline: null` to clear the date.

#### `city.delete`

Permanently deletes a city and cascades its districts, tasks, comments, and city features. City-local roads are removed; only genuine highway or through-road components are retained as shared infrastructure. The response includes `roadsDeleted`. Pass the exact current name to prevent accidental deletion.

```json
{ "cityId": "<city-id>", "confirmName": "Exact city name", "idempotencyKey": "delete-city-v1" }
```

Required scope: `cities:write`. This operation is destructive; always read the city and ask the user for explicit deletion intent first.

### Districts

#### `district.list`

Lists districts. Omit `cityId` to list districts across all cities in the
selected country.

```json
{ "cityId": "<optional-city-id>" }
```

Required scope: `country:read`.

#### `district.create`

Creates a district.

```json
{
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
{ "districtId": "<district-id>", "confirmName": "Exact district name", "idempotencyKey": "delete-district-v1" }
```

Required scope: `districts:write`. Read the district and its tasks, state the cascade, and require explicit user intent before calling it.

#### `district.rename`

Renames an existing district without changing its geometry or status.

```json
{ "districtId": "<district-id>", "name": "New district name", "idempotencyKey": "rename-district-v1" }
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
  "districtId": "<district-id>",
  "idempotencyKey": "activate-sprint-12-v1"
}
```

Required scope: `districts:write`.

#### `district.complete`

Completes a district.

```json
{
  "districtId": "<district-id>",
  "idempotencyKey": "complete-sprint-12-v1"
}
```

Required scope: `districts:write`.

### Tasks and buildings

#### `task.list`

Lists tasks. Omit `districtId` to list across the selected context.

```json
{ "districtId": "<optional-district-id>" }
```

Required scope: `tasks:read`.

#### `task.get`

Reads one task with its current state, documents, checklist, defects, linked
artifacts, human-facing task number, and browser URL.

```json
{ "taskId": "<task-id>" }
```

Required scope: `tasks:read`.

#### `task.create`

Creates a task and its world visual. The default visual is a building. A public
park is also a task, not a decorative record: it receives the same task number,
card, five statuses, checklist, defects, deletion and realtime updates.

```json
{
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

Required fields: `cityId`, `title`, `estimate`, and `idempotencyKey`. Allowed
estimates are `1`, `2`, `3`, or `6`. Allowed priorities are `LOW`, `NORMAL`,
`HIGH`, and `CRITICAL`.

`assigneeEmail` is the registered country member accountable for execution.
`assigneeRole` records the capacity in which that person or agent works, for
example `backend-lead`, `qa`, or `ai-agent:codex`. `forUserEmail` identifies the
registered customer/result owner for whom the work is performed. The MCP key
owner remains the task creator; creator, assignee, and result owner may differ.

`buildingHint` is an optional exact building key. Read
`tasktopia://catalog/buildings` first and use only a compatible catalog key;
omit the field when no exact building was requested. Keys beginning with
`landmark-` create a task-linked city landmark: it follows the task through all
five construction stages, and only one landmark task is allowed per city. The
country-level State Archive is separate and is not selected with `buildingHint`.

To create a task-backed park, set `visualKind` to `PARK` and optionally choose
`parkVariant`: `urban-formal`, `urban-community`, `urban-central`,
`urban-botanical`, `urban-amusement`, or `urban-park`. Do not infer a park from
words such as "parking"; use `PARK` only when the user explicitly wants a public
green-space task. For ordinary tasks omit both fields.

Required scope: `tasks:write`.

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
  "taskId": "<task-id>",
  "items": [
    { "title": "Add the migration", "done": true },
    { "title": "Verify rollback" }
  ],
  "idempotencyKey": "task-checklist-from-plan-v1"
}
```

The human UI is read-only: people inspect task documents, checklist, MR links,
evidence, defects and history; AI agents perform task mutations through MCP.

#### `task.defect_create`

Creates a linked defect on an existing task. Provide `taskId`, `title`, optional
`description`, non-empty `reproductionSteps`, `actualResult`, `expectedResult`,
and `idempotencyKey`. It starts as `OPEN`. Do not silently change the parent
task type or status.

```json
{
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

Permanently deletes one task/building and releases its planned lot so a later task can reuse it.

```json
{ "taskId": "<task-id>", "confirmTitle": "Exact task title", "idempotencyKey": "delete-task-v1" }
```

Required scope: `tasks:write`. Read the task first and require explicit deletion intent.

#### `task.rename`

Renames a task and the title associated with its building. The change is added
to the task event history.

```json
{ "taskId": "<task-id>", "title": "New task title", "idempotencyKey": "rename-task-v1" }
```

Required scope: `tasks:write`.

#### `task.set_status`

Moves a task to a valid workflow state. Optionally records progress and a
comment in the same operation.

```json
{
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
  "taskId": "<task-id>",
  "assigneeEmail": "person@example.com",
  "assigneeRole": "qa",
  "idempotencyKey": "assign-task-person-v1"
}
```

Required scope: `tasks:write`.

#### Additional task context tools

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

Read before mutation, use a stable `idempotencyKey` for every write, and keep
repository artifacts linked to the task that produced or verified them.

## Resources

### `tasktopia://country/current`

Returns the current country and its cities. Use it to orient an agent before
planning work.

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

Validated tool calls return protocol-level MCP results. Missing scopes, invalid
or inaccessible IDs, conflicts, invalid transitions, and domain validation
failures are returned as MCP tool results with `isError: true`, not as HTTP
`403`, `404`, or `409`. Inspect the returned error content and never silently
assume a mutation succeeded.

On ambiguous network failure, read the entity before retrying. If a retry is
still necessary, reuse the original `idempotencyKey`.

## Agent rules

- Confirm the selected country before writing.
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
