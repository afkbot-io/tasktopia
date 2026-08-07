# Tasktopia: AI-first Roadmap + Performance Plan

> Goal: make Tasktopia a true AI-agent task tracker while keeping the city/district/building metaphor intact, and fix the map performance issues.

## Current State

- Repo: `afkbot-io/tasktopia`, cloned at `/home/hermes/tasktopia`.
- Node 22 available, Node 24 required (npm install warns, typecheck passes).
- DB schema already has `tasks_v3.work_item_type`, `acceptance_criteria`, `system_analysis`, `architecture`, `design_system`, `implementation_plan`, `task_defects_v18`, `task_events_v7`, `task_attachments_v1`, `task_number`.
- MCP server exposes full CRUD for countries/cities/districts/tasks/comments/links/attachments.
- Performance: P1 (cache headers) + P6 (body/http2) already implemented in code and committed.
- Running nginx config (`/etc/nginx/sites-available/hermes-webui`) has `http2 on` and `client_max_body_size 100m`, but lacks cache headers for game assets.

## Part A — Performance (map slowness)

### A.1 — P1 + P6 ✅ DONE
- `src/server/index.ts`: `bodyLimit: 20_000_000`; fastifyStatic cache headers for `/game-assets/` and hashed bundles.
- `src/server/routes.ts`: chunk API returns ETag + 304.
- `deploy/nginx-tasktopia.conf`: HTTPS, http2, 20m body, immutable cache for assets.
- `deploy/nginx-hermes-webui-cache.patch`: patch to add the same cache location to the running server config.

### A.2 — Client rendering (P2)
**Goal:** show land/roads immediately from chunk JSON, load sprites asynchronously.
**Files:**
- `src/client/components/WorldCanvas.tsx` around `prepareChunk` (`await Assets.load(...)` before commit).
**Plan:**
1. Split chunk rendering into two passes:
   - Draw ground/road grid from chunk JSON as soon as JSON arrives.
   - Queue sprite textures in `Assets.load` and re-render buildings when ready.
2. Add a small loading indicator per chunk or per sprite batch instead of blocking the whole chunk.

### A.3 — Persistent chunk cache (P3)
**Goal:** survive F5 and city switches without re-fetching every chunk.
**Files:**
- `src/client/services/chunk-cache.ts` (new) using CacheStorage / IndexedDB.
- `src/client/components/WorldCanvas.tsx` to use the cache.
- Invalidate by `worldVersion` from chunk DTO / events.

### A.4 — Sprite atlases (P4)
**Goal:** reduce 391 PNG requests to ~6 sheets.
**Files:**
- New build script `scripts/build-sprite-atlas.ts` (or Python) using `sharp` / `spritesmith`.
- `src/client/components/WorldCanvas.tsx` Pixi spritesheet parsing.
- Keep existing fallback for non-atlas assets.

### A.5 — Panning storm / main thread freeze (P5)
**Goal:** debounce chunk loads, cancel stale requests, render ground incrementally.
**Files:**
- `src/client/components/WorldCanvas.tsx`: debounce pan end 120ms, AbortController per in-flight chunk, `buildGround` chunked via `requestAnimationFrame`.

## Part B — AI-first task tracker

### B.1 — Starter city (template/reference entity)
**Concept:** one special city per country called the **Starter City** (or Template City). It is read-only for players in terms of districts — it has no districts. It contains ~10 reference buildings: `[TEMPLATE]`, `[CONVENTION]`, `[CONTEXT]`. These buildings are not executable tasks; they are copied/cloned into real work tasks when needed.

**Backend changes:**
1. Migration `0007_starter_city.sql`:
   - `ALTER TABLE cities_v3 ADD COLUMN kind TEXT NOT NULL DEFAULT 'WORK' CHECK(kind IN ('WORK', 'STARTER'))`.
   - Unique index `one_starter_city_per_country`.
   - `ALTER TABLE tasks_v3 ADD COLUMN reference_kind TEXT CHECK(reference_kind IN ('TEMPLATE','CONVENTION','CONTEXT','WORK'))`.
   - `ALTER TABLE tasks_v3 ADD COLUMN copied_from_task_id TEXT` for traceability.
2. `app-service.ts`:
   - On country creation, auto-create the starter city with default reference buildings.
   - `createStarterReference(input)` — add a reference building to the starter city.
   - `cloneReferenceToTask(referenceTaskId, targetCityId, targetDistrictId, ...)` — copy a reference into a real task.
   - Forbid `district.create` inside starter city.
3. `mcp.ts`:
   - New tools: `starter_city.get`, `starter_reference.create`, `starter_reference.update`, `starter_reference.delete`, `starter_reference.clone_to_task`.
   - Update `city.create` instructions to mention the starter city.

**Frontend changes (later):**
- Render starter city with a distinct visual theme (e.g., tutorial/plaza).
- Reference buildings are lighter/ghosted until cloned.

### B.2 — Settings district per epic city
**Concept:** every normal city gets an auto-created district named **🏛️ Ратуша / City Hall**. This district contains only non-executable reference buildings: architecture context, conventions, standards for this epic. It is visually distinct from sprint districts.

**Backend changes:**
1. Migration `0008_settings_district.sql`:
   - `ALTER TABLE districts_v3 ADD COLUMN kind TEXT NOT NULL DEFAULT 'SPRINT' CHECK(kind IN ('SPRINT','SETTINGS'))`.
2. `app-service.ts`:
   - On `createCity`, also create a settings district with the city.
   - Restrict task status transitions in settings districts: they can only be `PLANNING` or `COMPLETED` (reference state).
3. `mcp.ts`:
   - `district.create` rejects `kind: 'SETTINGS'` (only auto-created).

### B.3 — Spec-driven templates
**Concept:** when creating a task, you can pick a template from the starter city / city hall and it pre-fills the spec fields.

**Backend changes:**
1. Add `task.create_from_template` MCP tool that accepts `templateTaskId` and target city/district, clones fields, and sets the new task's `workItemType`.
2. Pre-fill `acceptanceCriteria`, `systemAnalysis`, `architecture`, `designSystem`, `implementationPlan` from the template.

### B.4 — Dependencies between tasks
**Concept:** lightweight dependencies — no DAG engine yet, just visibility.

**Backend changes:**
1. Migration `0009_task_dependencies.sql`:
   - New table `task_dependencies_v1 (task_id, depends_on_task_id, PRIMARY KEY(task_id, depends_on_task_id))`.
2. `app-service.ts`:
   - `addTaskDependency`, `removeTaskDependency`, `listTaskDependencies`.
   - On `task.get` include `dependsOn` and `blockedBy` arrays.
3. `mcp.ts`:
   - `task.dependency_add`, `task.dependency_remove`.
   - On status transition to `COMPLETED`, warn (not block) if dependencies are not completed.

### B.5 — Assignee roles + "for user" field
**Concept:** `assignee` is a role (e.g., `agent:backend`, `agent:qa`, `human:pm`). A separate field `forUser` / `requester` tells who this task is for.

**Backend changes:**
1. Migration `0010_task_assignee_roles.sql`:
   - `ALTER TABLE tasks_v3 ADD COLUMN assignee_role TEXT` (free-form role label, e.g. `agent:architect`).
   - `ALTER TABLE tasks_v3 ADD COLUMN for_user_id TEXT` (references users, optional).
2. `app-service.ts`:
   - Accept `assigneeRole` and `forUserId` in create/update.
   - Return them in task DTO.
3. `mcp.ts`:
   - Add `assigneeRole` to `task.create`, `task.update_fields`, `task.assign`.
   - Add `forUserEmail` to `task.create` / `task.update_fields` (resolve to `for_user_id`).

### B.6 — Task activity / live work MCP
**Concept:** an MCP tool that returns the current state of work on a task: recent events, comments, status changes, active agent.

**Backend changes:**
1. `app-service.ts`:
   - `getTaskActivity(taskId)` joins `task_events_v7`, `task_comments_v3`, `task_defects_v18`, `task_attachments_v1` and returns a timeline.
2. `mcp.ts`:
   - `task.activity` tool.
3. Socket.io / realtime (optional):
   - On task status update / comment, emit event to room `task:{taskId}`.

### B.7 — Visual effect: building under work
**Concept:** when a task has recent events or status `IN_PROGRESS`, render a small effect on the building (e.g., pulsing border, scaffolding, or a tiny crane icon).

**Frontend changes:**
- `WorldCanvas.tsx` / building renderer: read `task.lastActivityAt` or `status === 'IN_PROGRESS'` and add visual cue.
- Update chunk DTO to include a `workStatus` flag for each task building.

### B.8 — Audit trail / chain-of-thought in comments
**Concept:** already partially supported via `task_events_v7`. Make it visible and require agents to leave structured handoff comments.

**Backend changes:**
1. `app-service.ts`:
   - On every status change / field update, write an event with `actor`, `actorUserId`, `event_type`, `details_json`.
   - Encourage `comment` body to start with `[handoff]`, `[blocker]`, `[decision]` prefixes.
2. `mcp.ts`:
   - Add `task.activity` and `task.history` tools.

## Part C — Implementation order

1. **Performance P1+P6** ✅ DONE; deploy patch to running nginx.
2. **Starter city DB + API** — backend only, MCP tools, no frontend yet.
3. **Settings district DB + API** — backend only.
4. **Assignee role + for user** — backend + MCP.
5. **Task dependencies** — backend + MCP.
6. **Task activity / history** — backend + MCP.
7. **Client P2/P5** — render land immediately, debounce panning.
8. **Frontend cues** — building under work, reference cards.
9. **P3/P4** — persistent cache, atlases (bigger front-end effort).
10. **Templates UI** — clone from starter city / city hall in the app.

## Part D — Verification

- `npm run typecheck` must pass after each backend step.
- `npm run test:server` (if present) or new unit tests for app-service helpers.
- Manual MCP smoke test: create starter city reference, clone to task, add dependency, set status, fetch activity.
- Performance: browser DevTools Network panel shows game assets served from disk cache after first load; 304 on chunks after no change.

## Open Questions

1. Should the starter city be created automatically for every country, or only on demand?
2. Should `assigneeRole` be a closed enum or free text?
3. Should dependencies block status transitions or just warn?
4. Should we keep the old `assignee_user_id` alongside the new role-based system, or migrate?
