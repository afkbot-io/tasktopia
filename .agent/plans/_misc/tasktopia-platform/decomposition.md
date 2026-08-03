# MR/PR decomposition

> **Geometry update 2026-08-02:** hex-задачи ниже заменены срезами из `../square-world-generation-v3/decomposition.md`.

## Decomposition Verdict

- Recommended shape: hybrid — additive foundations merge independently, затем короткая stacked цепочка вертикальных срезов.
- Reason: worldgen, renderer и domain contracts можно безопасно подготовить отдельно, но project/sprint/task должны доказываться через MCP → DB → world → WebSocket → UI.
- Plan source: `overview.md`, `architecture.md`, `graphics-pipeline.md`, `world-generation.md`, `api-mcp.md`.
- Main risk: слишком большой общий worldgen/graphics diff, который нельзя проверить независимо.

## Dependency Graph

```text
MR-1 -> MR-2 -> MR-5 -> MR-6 -> MR-7 -> MR-8
MR-1 -> MR-3 -> MR-5
MR-1 -> MR-4 -> MR-5
MR-5 -> MR-9
MR-8 -> MR-9 -> MR-10
```

## Slices

### MR-1: Monorepo, contracts and domain foundation

- Outcome: сборка, тесты, БД skeleton, базовые DTO/state machines без включения поведения.
- Owned surfaces: root config, `packages/contracts`, `packages/domain`, `infra`.
- Dependencies: none.
- Target/base: main.
- Interface contract: ids, errors, event envelope, axial directions, task statuses.
- Rollout: internal-only.
- Verification: lint/test/build, migration dry-run.
- Docs/MR notes: ADR по monorepo/stack.
- Risk: преждевременные абстракции; ограничить только подтверждёнными контрактами.
- Out of scope: UI, MCP tools, world generation.

### MR-2: Authentication, country bootstrap and token UI

- Outcome: пользователь входит, получает одну страну и может выпустить/revoke MCP key.
- Owned surfaces: `apps/web` auth/settings, `apps/api` auth, country tables/application.
- Dependencies: MR-1.
- Target/base: main после MR-1.
- Interface contract: authenticated principal, country context, API key scopes.
- Rollout: internal/local.
- Verification: signup/login/ensure concurrency/token redaction E2E.
- Docs/MR notes: local setup and token safety.
- Risk: tenant leakage; country id всегда выводится из principal, не только из input.
- Out of scope: MCP endpoint and game map.

### MR-3: Deterministic chunks and PixiJS read-only map

- Outcome: seed создаёт воспроизводимый terrain; viewport лениво грузит и выгружает чанки.
- Owned surfaces: `packages/worldgen`, `packages/renderer`, read chunk API.
- Dependencies: MR-1; может разрабатываться параллельно MR-2.
- Target/base: main после MR-1.
- Interface contract: ChunkDTO, generator version, coordinate math.
- Rollout: debug route/feature flag.
- Verification: golden seeds, negative coordinates, culling benchmark.
- Docs/MR notes: performance baseline.
- Risk: renderer связывается с React; держать scene graph внутри renderer package.
- Out of scope: cities, roads, buildings.

### MR-4: Asset contract, road baker and perimeter generator

- Outcome: единый style contract, 64 корректных road overlays, внешний polyhex perimeter.
- Owned surfaces: `packages/asset-pipeline`, asset registry, CI visual fixtures.
- Dependencies: MR-1; параллельно MR-2/MR-3.
- Target/base: main после MR-1.
- Interface contract: sprite dimensions/anchors, road mask bit order, perimeter segments.
- Rollout: build-time tooling only.
- Verification: structural/style/road/scene validators.
- Docs/MR notes: generation prompts and provenance.
- Risk: визуальные проверки слишком мягкие; обязательна фиксированная composite scene.
- Out of scope: 50 уникальных финальных зданий.

### MR-5: MCP foundation and project-to-city vertical slice

- Outcome: authenticated MCP `project.create` создаёт project, job, city boundary и локальную дорогу; веб показывает результат.
- Owned surfaces: MCP adapter, application project commands, worker city placement, realtime gateway, sidebar city read.
- Dependencies: MR-2, MR-3, MR-4.
- Target/base: stacked on all foundations, затем main.
- Interface contract: project tools, operation status, project/city events.
- Rollout: local/internal key scopes.
- Verification: MCP client E2E, idempotency, city placement, WebSocket update.
- Docs/MR notes: client configuration example.
- Risk: слишком длинная synchronous command; city generation всегда operation/job.
- Out of scope: intercity connection and sprint.

### MR-6: Global road network and bridges

- Outcome: второй город подключается к существующей сети без изменения terrain seed.
- Owned surfaces: road graph, A*, bridge selection, road events.
- Dependencies: MR-5.
- Target/base: main after MR-5.
- Interface contract: road cells/masks and invalidated chunks.
- Rollout: new cities only; existing city unchanged.
- Verification: seeded network fixtures, reciprocal masks, water crossings.
- Docs/MR notes: generator version/rollback note.
- Risk: дорогой pathfinding; macro corridor ограничивает detailed search.
- Out of scope: tunnels, ferries, highway hierarchy.

### MR-7: Sprint-to-district vertical slice

- Outcome: MCP создаёт/активирует sprint, contiguous district появляется у дороги с одним внешним fence.
- Owned surfaces: sprint domain/application, district generator, MCP tools, read sidebar.
- Dependencies: MR-5; bridge enhancements MR-6 необязательны для dry-land fixture, но нужны перед общий релизом.
- Target/base: main after MR-5 or stacked if MR-6 touches same generator files.
- Interface contract: sprint state, district cells/perimeter, capacity.
- Rollout: internal.
- Verification: district property tests + MCP/browser E2E.
- Docs/MR notes: active sprint semantics.
- Risk: конфликт parallel placements; `reserved_cell` transaction.
- Out of scope: manual district editing.

### MR-8: Task-to-building and progress vertical slice

- Outcome: MCP создаёт task, выбирает/размещает building, а status/progress/comments меняют stage на открытой карте.
- Owned surfaces: task models, catalog, placement, task MCP tools, outbox, task modal.
- Dependencies: MR-7.
- Target/base: stacked on MR-7, затем main.
- Interface contract: task tools, five-stage mapping, building DTO, task events.
- Rollout: feature flag по country.
- Verification: full MCP → modal flow, reconnect replay, placement concurrency.
- Docs/MR notes: task examples and state transition guide.
- Risk: catalog scoring непрозрачен; возвращать `selectionReasons` в debug/audit, не в обычном UI.
- Out of scope: AI-generated description inside platform.

### MR-9: Scale and reliability hardening

- Outcome: representative country остаётся плавной и восстанавливается после разрывов/worker retries.
- Owned surfaces: Redis Streams adapter/outbox, LRU, observability, load fixtures.
- Dependencies: MR-5, MR-8.
- Target/base: main after feature slices.
- Interface contract: snapshot reconciliation and metrics.
- Rollout: internal → beta gate.
- Verification: 2 000 sprites, 4×4 chunks, reconnect, retry, duplicate event tests.
- Docs/MR notes: SLO/performance report/runbook.
- Risk: оптимизация без baseline; сначала измерение.
- Out of scope: global multi-region deployment.

### MR-10: Catalog expansion, accessibility and beta release

- Outcome: минимум 30 catalog entries, 8–12 visual families, keyboard-accessible read UI и release proof.
- Owned surfaces: catalog/assets, accessibility DOM, docs/QA.
- Dependencies: MR-8, MR-9.
- Target/base: main.
- Interface contract: catalog v1 and asset pack v1.
- Rollout: beta.
- Verification: visual regression, browser matrix, security review, release smoke.
- Docs/MR notes: changelog, MCP onboarding, asset provenance.
- Risk: asset scope; количество domain entries не связывать 1:1 с уникальными sprites.
- Out of scope: 100 уникальных построек и full 3D.

## Rejected Splits

- Отдельный backend без observable flow: слишком долго не доказывает продукт.
- Все assets до domain work: высокий риск сделать дорогой набор до проверки gameplay.
- UI CRUD отдельным MR: противоречит MVP.
- Один «worldgen MR»: непроверяемый blast radius; terrain, road и district разделены.
- MCP после всей бизнес-логики: MCP является основным write surface и должен появиться уже в первом вертикальном срезе.

## Execution Notes

- Suggested order: MR-1; затем параллельно MR-2/MR-3/MR-4; затем MR-5→MR-8; MR-9→MR-10.
- Parallelizable: auth, renderer/chunks и asset tooling после общих contracts.
- Required decisions: название продукта, точный art style token pack, email provider, публичный OAuth timing.
- Cleanup trigger: после MR-5 статический prototype переносится в `examples/` или удаляется отдельным cleanup diff после подтверждения нового renderer.
