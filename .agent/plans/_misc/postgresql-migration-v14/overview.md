# PostgreSQL migration V14

## Goal

Полностью заменить runtime и test persistence SQLite на PostgreSQL без потери доменных данных, транзакционной idempotency, chunk index и MCP/session security.

## Decisions

- PostgreSQL 16, не MongoDB: модель реляционная и транзакционная.
- Асинхронный pooled driver; блокирующий SQLite API не эмулируется.
- Forward-only numbered SQL migrations; schema и data transfer разделены.
- JSON payload сначала сохраняет публичный контракт, но хранится как `jsonb`.
- Unit/integration tests используют изолированные PostgreSQL schemas.
- Legacy SQLite читается только одноразовым migration CLI; приложение больше не открывает `.sqlite`.

## Acceptance

- `DATABASE_URL` — единственный runtime database contract; секрет не логируется.
- PostgreSQL schema, constraints, indexes and spatial triggers reproduce all invariants.
- App/auth/MCP/routes/seeds/world audit работают через async transaction context.
- SQLite transfer CLI поддерживает dry-run, batches и сверку row counts/FK.
- Docker Compose содержит PostgreSQL healthcheck и persistent volume.
- Fresh PG tests, coverage, build, scale, E2E and MCP smoke pass on small world.

## Non-goals

- MongoDB compatibility.
- PostGIS geometry rewrite; chunk membership remains integer spatial read model.
- Multi-node Socket.IO event broker; PostgreSQL removes DB single-node limit, not in-memory websocket rooms.
- Automatic destructive deletion of the old SQLite file.

## Status

Implementation in progress.
