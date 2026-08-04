# V13 changelog

## Implemented

- Added compatible `VIEWER` role migration; legacy `MEMBER` remains editor.
- Added selectable MCP scopes, 30/90/365-day expiry and current-role scope caps.
- Enforced scopes on tools and resources; rejected malformed scope storage safely.
- Added stable `(created_at, id)` city cursor endpoint and paged Plan UI loading.
- Converted spatial membership backfill to resumable 250-entity transactions.
- Extracted generic Pixi entity reconciliation with focused unit coverage.
- Updated public MCP, access, architecture and QA documentation.

## Verification

- Typecheck and ESLint pass after the final security-smoke change.
- Vitest: 18 files / 59 tests pass; coverage 84.47% statements, 88.93% lines.
- V13 focused set: 5 files / 15 tests pass.
- Production build passes; initial app chunk 301.20 kB, lazy `WorldCanvas` chunk 230.15 kB.
- Asset audit: 343/343 runtime PNG, no missing/orphan files or violations.
- npm audit: 0 known vulnerabilities.
- Scale: 1 city, 10 districts, 25 tasks, 9 chunks; 2780 ms generation, 33 ms uncached chunk, 0 ms cached chunk, 377 MB RSS under 512 MB.
- Playwright: 4 passed; the opt-in large growth capture is skipped by default.
- Live MCP: 17 tools, revoked token rejection, read-only mutation rejection and protected-resource scope enforcement pass on the 1-city/10-district/20-task fixture.
