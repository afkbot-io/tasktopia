# Implementation checkpoints

> **Geometry update 2026-08-02:** hex-worldgen checkpoints ниже являются историей MVP. Новая последовательность находится в `../square-world-generation-v3/tasks.md`.

Статусы: `[ ]` pending, `[x]` complete, `[~]` intentionally limited in MVP.

## Рабочий MVP

- [x] React/Vite shell, PixiJS renderer, Fastify server, TypeScript contracts.
- [x] Регистрация, login/logout, одна автоматически создаваемая страна.
- [x] MCP token create/list/revoke, hash-only storage, scopes and rate limits.
- [x] Stateless Streamable HTTP `/mcp` и 13 tools/resources.
- [x] Идемпотентные project/sprint/task mutations.
- [x] Детерминированный terrain, negative chunks, viewport loading/unloading.
- [x] Город на 30 гексах, land-aware site selection и соединение следующих городов.
- [x] Топологические road masks, bridges on water, визуальная сшивка без seams.
- [x] Район из 14 связных buildable cells возле дороги и расширение city boundary.
- [x] Девять расширяемых building catalog entries, footprint 1/2/3 и пять платформ.
- [x] Пять стадий задачи и карточка с комментариями.
- [x] Socket.IO invalidation/reload карты и открытой задачи.
- [x] Docker/Caddy HTTPS, healthcheck, persistent volume и GitHub Actions CI.
- [x] Unit/domain/catalog tests, Playwright desktop/mobile flow и MCP smoke.

## Осознанно ограничено

- [~] Процедурные здания вместо сгенерированного production sprite atlas.
- [~] SQLite и один app process вместо PostgreSQL/outbox/worker.
- [~] Snapshot reload по событию вместо точечных chunk deltas/event replay.
- [~] Девять зданий вместо планируемых 50–100.
- [~] Прямая hex-line дорога вместо costed A* с обходом сложного рельефа.
- [~] Только desktop/mobile read-only UI; нет collaborative roles и нескольких стран.

## Следующий этап

- [ ] Версионированный sprite atlas и автоматический style/anchor/contact-sheet validator.
- [ ] 30–50 каталог-записей: клиника, скорая, школа, офисы, склады, порт, аэропорт.
- [ ] PostgreSQL migrations, transactional outbox, worker and event replay.
- [ ] A* road routing с turn/water/terrain cost и gate planning.
- [ ] Динамическое расширение района при физической нехватке footprint.
- [ ] OAuth 2.1 для публичного remote MCP.
- [ ] Load/perceptual/accessibility suites из расширенного `qa.md`.
