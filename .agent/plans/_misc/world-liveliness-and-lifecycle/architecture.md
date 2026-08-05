# Current boundary

`AppService` owns placement and mutations, PostgreSQL triggers maintain chunk indexes, MCP exposes operations, and `WorldCanvas` renders only visible chunks.

# Target boundary

- Capacity is advisory domain metadata.
- Destructive operations run through idempotent AppService mutations with exact confirmation and affected-bounds events.
- Procedural generation decides deterministic placement; the asset manifest remains the only runtime sprite registry.
- Chunk-local decorations encode ecology/urban furniture without persisted rows or global payloads.

# Alternatives considered

- Removing `capacitySp` from storage: rejected because it breaks clients and removes useful workload context.
- Blind cascade delete: rejected because accidental MCP calls would be irreversible.
- Persisting every boat/person: rejected because it increases database and websocket churn for decorative life.

# Rollout and rollback

Backup PostgreSQL before deployment. Runtime assets and code deploy atomically. Migration `0003_feature_ownership.sql` only adds nullable ownership FKs/indexes and backfills green features; application rollback is compatible with those columns. Restore the database backup only if the migration itself fails or data verification detects a cascade error.
