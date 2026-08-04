# QA

- Migrations are idempotent and serialized by advisory lock.
- Two isolated schemas can run tests concurrently without leakage.
- Register/login/session/token expiry/scopes survive PostgreSQL restart.
- Mutation, event, idempotency response and worldVersion commit or roll back together.
- Spatial triggers cover negative coordinates and JSONB geometry updates/deletes.
- SQLite transfer dry-run makes no target changes; real transfer preserves row counts.
- Scale remains 1 city / 10 districts / 20–25 tasks in default gate.
- Docker health depends on PostgreSQL health.
