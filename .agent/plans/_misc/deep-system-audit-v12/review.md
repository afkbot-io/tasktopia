# Findings ledger

## Verdict

- Mode: diagnostic-full with implementation.
- Merge readiness: ready with documented operational risks after final gate.
- Reviewed: domain/data, generator, HTTP/MCP/Socket.IO, client/chunks/Pixi, security, dependencies, tests, docs and stale surfaces.

## Resolved findings

1. **P1 / security / high confidence — CSRF origin bypass.** `routes.ts` accepted a caller-controlled `X-Forwarded-Host`. Fixed by exact canonical `APP_ORIGIN`; regression test covers the spoof.
2. **P1 / security / high confidence — realtime access survived revocation.** Socket auth existed only at handshake. Logout/member removal now disconnects matching sockets; long-lived sockets revalidate session and active country every minute.
3. **P2 / data / high confidence — stale spatial membership after geometry UPDATE.** V11 indexed insert/delete but task/feature UPDATE was uncovered. Additive triggers rebuild membership; test covers negative chunks, move and delete.
4. **P2 / performance / high confidence — full Pixi entity churn.** `renderEntities` cleared all entity layers for one changed chunk/status. Replaced by id/signature reconciliation with layer-specific signatures.
5. **P2 / performance / high confidence — repeated chunk materialization.** Every revisit rebuilt terrain/surfaces. Added bounded 64-entry LRU; scale revisit is 0 ms in the control run.
6. **P2 / performance / high confidence — uncompressed chunk JSON.** Fastify/nginx path had no compression. Added global compression above 1 KiB; live detail response confirms Brotli.
7. **P2 / security / high confidence — known transitive ReDoS.** `hono 4.12.33` had a moderate advisory. Override uses 4.12.34; npm audit is clean.
8. **P2 / quality / high confidence — asphalt metric undercounted visible paving.** Audit counted only roads. It now includes asphalt task platforms, service pads and driveways; control maximum is 11.02%.
9. **P3 / tests / high confidence — E2E contradicted chunk optimization and overwrote release artifacts.** Bounded overview expectation fixed; screenshots require explicit opt-in; strict locator fixed.

## Covered or accepted risks

- **Accepted P2:** V11 spatial backfill is one `BEGIN IMMEDIATE` startup transaction. It is atomic/idempotent but can delay startup proportional to existing geometry; a future online/batched migration is needed for truly large imported databases.
- **Accepted P2:** `/api/plan/cities` is not paginated. It is explicit user-driven metadata without geometry and acceptable for current gradual growth, but should gain cursor pagination before thousands of cities per country.
- **Accepted P3:** `WorldCanvas` remains a large lazy module (~230 kB raw / ~68 kB gzip). Runtime churn is reduced, but movement simulation and rendering should be split before major new map systems.
- **Accepted P3:** Legacy hex tables are unused by runtime. They remain to avoid destructive loss of local pre-V3 data; delete only with an export/removal migration.

## Review coverage

- Lanes: correctness, architecture, contracts, data/migration, security, silent failure/error paths, performance, tests/coverage, stale code and docs.
- External dependency state: `npm audit` and `npm outdated`; no blind major upgrades were applied.
- Not production-load tested: multi-process SQLite and thousands of cities are explicit non-goals of the current single-node architecture.
