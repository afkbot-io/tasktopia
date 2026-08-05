# QA

## Preconditions

- PostgreSQL test container healthy.
- Representative fixture seeded only in the isolated test database.
- Browser available through Playwright.

## Positive scenarios

- Register with country and city; map opens with both names.
- Open `/ai.md` anonymously and copy a valid client configuration.
- Create a personal token, connect official MCP v2 client, list 17 tools and read resources.
- Run read operations with read scopes and writes with the matching write scope.
- Pan and zoom the map while resident chunks stay bounded; process a spatial WebSocket event.
- Generate one city, ten districts and the bounded task fixture.

## Negative scenarios

- Reject missing Bearer, `X-API-Key`, bare token, expired token and revoked token.
- Reject an invalid Origin with 403 for MCP requests.
- Reject write tools for read-only/viewer scopes.
- Roll back registration if first-city generation fails.
- Reject reused idempotency keys with changed payload.

## Logs and audit checks

- No unhandled errors, negative-timeout warnings, secrets or authorization headers in logs.
- Production worktree has no generated backup inside tracked checkout expectations.
- `npm audit --omit=dev` reports no vulnerabilities.

## Expected results

- All default gates pass; scale remains a separate sequential gate.
- Production `/health`, `/ai.md`, HTTPS and MCP auth boundary are green.

## Local release evidence — 2026-08-05

- Typecheck, lint, build and dependency audit passed; production audit reports
  zero known vulnerabilities.
- Unit/integration: 67/67 passed; 84.29% statements, 88.84% lines and 91.76%
  functions.
- Playwright: 7 passed; the opt-in deterministic growth screenshot was skipped.
- Asset audit: all 343 runtime PNGs referenced, zero missing/orphan files and
  zero palette/grid violations.
- Isolated scale: 1 city, 10 districts, 25 tasks, 9 chunks; generation 6.613 s,
  first chunk 125 ms, cached chunk 4 ms, RSS 295 MB.
- MCP production-build smoke: modern and legacy clients, 17 tools, resources,
  strict Bearer, GET/POST/DELETE Origin checks, revocation and least-privilege
  scope denials passed.
- Independent spec and standards re-reviews have no remaining P0–P3 findings.

## Production evidence — 2026-08-05

- Database backup: `backups/tasktopia-2026-08-05-100708.dump` (56 KiB).
- Health: version 1.2.0; app and PostgreSQL containers healthy.
- Public `/ai.md`: HTTP 200, `text/markdown; charset=utf-8`.
- Live modern/legacy MCP smoke passed all 17 tools, resources, strict auth,
  revocation, scopes and GET/POST/DELETE Origin checks; the temporary smoke
  account was deleted after verification.
- Anonymous MCP challenge: HTTP 401 with `WWW-Authenticate: Bearer`.
- nginx config and certbot timer are healthy; TLS certificate is valid through
  2026-11-02; Node is exposed only on `127.0.0.1:3000`.
- Post-deploy application logs contain no error-level entries or unhandled
  warnings.
