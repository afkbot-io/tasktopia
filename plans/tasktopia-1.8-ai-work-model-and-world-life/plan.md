# Tasktopia 1.8 — AI work model and living world

## Outcome

Расширить Tasktopia до полноценной модели AI-разработки и одновременно оживить карту без возврата к тяжёлой загрузке всего мира.

## Domain contract

- Страна остаётся продуктовым проектом, но в UI называется только страной.
- Город остаётся эпиком/подпроектом, но в UI называется городом.
- Район остаётся спринтом/итерацией, но в UI называется районом.
- Здание остаётся задачей; тип работы хранится отдельно: `TASK`, `BUG`, `RELEASE`, `HOTFIX`.
- Связанный дефект — отдельная дочерняя сущность `TaskDefect`, а не второй тип задачи.
- `capacitySp` — только ориентир нагрузки. Сервер не ограничивает сумму SP.

## Deliverables

1. PostgreSQL migration with backward-compatible defaults for country, city, district and task planning fields plus task defects.
2. Service methods and HTTP/MCP contracts to read and update the new fields, including defect lifecycle.
3. UI presentation/editing for country context and complete task details; plan lists expose city/district context and deadlines.
4. Public `/ai.md`, MCP documentation and installable Tasktopia skill updated with field semantics and progress workflow.
5. World simulation fixes: world-space aircraft, bounded contrail, three aircraft variants, centered car lanes, more but capped wildlife, extra bushes, city-sign and district hover help.
6. Deterministic native sprite pack rebuilt and audited; no runtime-generated imagery.
7. Unit/integration/E2E verification on a small world. Heavy scale checks remain opt-in.
8. Production resources raised modestly, release deployed, health and coexistence with the second project verified.

## Acceptance criteria

- Existing rows migrate without data loss and regeneration preserves all non-spatial fields and defects.
- MCP can create/update/read all planning fields and create/update/list defects using scoped personal tokens and idempotency keys.
- A plane is a child of the world coordinate system; panning does not re-anchor it to the viewport. Contrail count is bounded.
- Cars use a deterministic lane offset away from road edges on horizontal and vertical segments.
- Animals use at least four species, remain capped, and do not respawn or restart merely because zoom changes.
- City signs display the city name on hover. Visible district boundaries display district name and deadline on hover.
- Chunk streaming, partial realtime invalidation and one-city loading behavior remain intact.
- `npm run lint`, `npm run typecheck`, `npm test`, asset audit and targeted browser tests pass.

## Work breakdown

- [x] Data contracts and migration
- [x] Domain service and preservation during regeneration
- [x] HTTP and MCP tools
- [x] UI and tooltips
- [x] Native sprites and simulation behavior
- [x] Documentation and public AI skill
- [ ] Verification, review, release and production rollout

## Risks and controls

- Migration drift: additive columns/tables only, defaults on every new scalar, migration test coverage.
- MCP tool sprawl: one patch tool per aggregate and a small defect CRUD surface; schemas remain strict.
- Rendering regression: no per-frame allocation for lane offsets; contrail uses a bounded ring of graphics; agents are reconciled, not recreated on camera motion.
- Resource contention: only moderate container limit increases and post-deploy inspection of both Compose projects.
