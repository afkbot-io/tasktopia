# References and entity map

## Entity families

- Identity/access: users, sessions, countries, country_members, mcp_tokens.
- Current world: cities_v3, districts_v3, tasks_v3, task_comments_v3, task_events_v7, roads_v3, world_features_v6.
- Spatial read model: world_chunk_entities_v11, deterministic terrain, generated surfaces/decorations.
- Legacy compatibility: projects, sprints, tasks, task_comments, roads, events, idempotency.
- Client runtime: bootstrap/session, plan tree, resident chunks, Pixi scene, realtime invalidations.

## Relevant files

- `src/shared/contracts.ts`
- `src/server/db.ts`, `auth.ts`, `app-service.ts`, `routes.ts`, `mcp.ts`, `index.ts`
- `src/server/world/*`
- `src/client/App.tsx`, `components/PlanDrawer.tsx`, `components/WorldCanvas.tsx`, `world-camera.ts`
- `tests/*`, `playwright.config.ts`, `scripts/seed-test.ts`, `scripts/worldgen-scale-smoke.ts`

## Open audit questions

- Все ли UPDATE/CASCADE paths поддерживают spatial membership?
- Может ли socket подключиться к чужой country room или остаться в старой после select?
- Может ли late chunk response пережить LOD/country transition?
- Есть ли stale legacy tables/scripts, которые всё ещё нужны для migration compatibility?

## Resolved findings

- CSRF bypass через raw `X-Forwarded-Host` — исправлен каноническим `APP_ORIGIN` check.
- Socket после logout/member revoke — отключается runtime hooks.
- Stale spatial membership после geometry UPDATE — добавлены V12 triggers и negative-coordinate test.
- Полная пересборка Pixi entity layers — заменена id/signature reconciliation.
- Повторная materialization чанков — bounded LRU 64.
- Неполный asphalt metric — теперь учитывает все видимые asphalt/driveway surfaces.
- Транзитивный Hono ReDoS — override 4.12.34, audit clean.
- Legacy hex tables — не удаляются: возможны локальные данные, безопасного export/removal migration пока нет.
