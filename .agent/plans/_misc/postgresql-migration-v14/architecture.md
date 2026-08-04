# Architecture

## Runtime

`Fastify -> services -> Db adapter -> postgres pool -> PostgreSQL 16`

The adapter exposes parameterized `get/all/run` and an AsyncLocalStorage-bound transaction. Domain code receives one `Db`; queries inside `transaction()` are routed to the checked-out transaction connection.

## Migrations

Immutable files in `migrations/postgres`, recorded in `schema_migrations`. Advisory lock serializes startup migration runners. DDL is transactional unless a migration explicitly declares otherwise. Future large indexes use separate `CREATE INDEX CONCURRENTLY` migrations.

## Data transfer

The transfer command reads legacy SQLite read-only, writes dependency-ordered batches to an empty PostgreSQL schema, resets sequences where applicable, and compares counts plus foreign-key violations. The source file is never deleted or mutated.

## Rollout

1. Backup SQLite and provision PostgreSQL.
2. Stop writers.
3. Apply PostgreSQL schema migrations.
4. Run transfer dry-run, then transfer and verification.
5. Start V14 with `DATABASE_URL`.
6. Keep SQLite backup until operational validation completes.

Rollback is application rollback plus returning to the untouched SQLite backup before new PostgreSQL-only writes are accepted.
