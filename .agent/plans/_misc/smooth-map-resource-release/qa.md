# QA

## Preconditions

- Production build, PostgreSQL test fixture: 1 city / 10 districts / 20 tasks.
- Desktop 1600×900, mobile 390×844, normal and reduced motion.

## Positive scenarios

1. Login with 450 ms chunk delay: loader remains until first painted ground.
2. Pan beyond prefetch while requests are delayed: old ground remains, new ground appears progressively.
3. Zoom repeatedly around LOD threshold: bounded requests, no black frame, final LOD stable.
4. Pan away/back: recently used chunks do not refetch.
5. Fresh console: no CSP data-image error and no Pixi cache warning.
6. Toggle plan/boundaries: pointer, focus, visible state and `aria-pressed` agree.
7. First country management open has immediate visible feedback; second open remains instant.
8. Hide tab/offscreen canvas and return: ticker pauses/resumes; no extra canvas/listeners after cycles.

## Negative scenarios

- Aborted/stale request may not overwrite a newer LOD.
- Failed chunk leaves retained ground and exposes recoverable loading state.
- Cache limits hold under bounded 100-step pan/zoom stress.

## Operational checks

- `docker inspect` confirms Tasktopia CPU/RAM limits.
- Both project health endpoints remain 200 during bounded smoke.
- Host load, memory, swap and container restarts remain stable.

## Local release evidence — 2026-08-05

- `git diff --check`, typecheck, lint: pass.
- Vitest: 19 files / 72 tests pass.
- Production Playwright: 12 pass / 1 opt-in growth checkpoint skipped.
- Map streaming regressions: delayed pan, reduced motion, terminal retry, progressive reverse LOD and realtime invalidation pass.
- Production build: pass; `WorldCanvas` remains a separate 246.61 kB / 72.31 kB gzip chunk.
- Dependency audit: 0 vulnerabilities.
- MCP smoke: 20 tools, modern + legacy protocols, strict Bearer, Origin, revocation, scopes and resources pass.
- `docker compose config`: app 1.5 CPU / 1 GiB / 160 PIDs; PostgreSQL 0.75 CPU / 768 MiB / 100 PIDs.

## Production evidence — 2026-08-05

- Pre-release PostgreSQL custom-format backup created and validated with `pg_restore -l`.
- GitHub `main` and `/srv/tasktopia/app` synchronized at `1e30bbd`; public health reports `1.3.2`.
- Tasktopia app: 1.5 CPU / 1 GiB / 160 PIDs; PostgreSQL: 0.75 CPU / 768 MiB / 100 PIDs; both healthy, restart 0, OOM false.
- Neighboring Eternal World app, daemon, MongoDB, Centrifugo and Redis: all healthy, restart 0, OOM false.
- Host after release: 9.6 GiB available RAM, 12 KiB swap used, load 2.33 / 3.17 / 3.02 on 8 vCPU.
- Public CSP contains `connect-src 'self' data: ws: wss:` and `worker-src 'self' blob:`; MCP without Bearer returns 401.
- `https://tasktopia.online/ai.md` reports version 1.3.2; TLS certificate valid through 2026-11-02.
