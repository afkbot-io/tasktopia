# V12 audit changelog

## Fixed

- Geometry UPDATE поддерживает chunk membership без stale rows.
- E2E selectors и bounded overview expectation синхронизированы с малым prefetch.
- Asphalt audit соответствует фактическому renderer surface.

## Performance

- Bounded 64-entry chunk LRU.
- Differential Pixi entity reconciliation.

## Security

- Canonical-origin CSRF check, strict cookie, production Secure default.
- Socket revocation on logout/member removal.
- Patched transitive Hono; audit clean.

## Tests and documentation

- Spatial UPDATE/negative chunk and realtime revocation tests.
- Coverage tool/gate, architecture/entity lifecycle document and QA updates.

## Migration note

- Новые triggers additive. V11 backfill остаётся одноразовой startup-транзакцией.
