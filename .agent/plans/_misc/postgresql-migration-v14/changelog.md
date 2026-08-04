# V14 changelog

- Replaced runtime/test SQLite persistence with pooled asynchronous PostgreSQL 16.
- Added checksum-protected migrations under an advisory transaction lock and JSONB spatial triggers.
- Added a read-only, batched and verified legacy SQLite import command.
- Added isolated PostgreSQL test schemas, Compose/CI services and production health dependency.
- Preserved MCP Bearer authentication, expiry/scopes, sessions and idempotent country-level mutation serialization.
