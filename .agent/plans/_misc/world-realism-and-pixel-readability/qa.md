# QA

- Focused Vitest regression suite must fail before the fix and pass afterward.
- Full unit/integration suite.
- Asset audit and production build.
- Playwright smoke and visual screenshots at overview/detail zoom.
- Check initial request count, visible chunk count, frame responsiveness, and missing-asset warnings.
- Production health, CSP console, map pan/zoom, task hover/click, bridge and district inspection.

## Evidence

- `npm test -- --run`: 83 passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run assets:build && npm run assets:verify`: 373/373 referenced PNGs, 0 violations.
- `npm run build`: passed.
- Playwright with isolated PostgreSQL: 12 passed, 1 opt-in growth screenshot skipped.
- Production `https://tasktopia.online/health`: version 1.5.0, healthy.
- Production asset manifest: no curb tile, 8 animal directions, 3 path finishes.
- Production anonymous browser smoke: title/layout/HTTPS load, no failed requests; the initial bootstrap 401 is the expected unauthenticated probe.
- Production authenticated visual pass was not repeated because no test account exists on production; the equivalent authenticated flow passed against the production build locally.
- Host after deployment: Tasktopia 66.66 MiB / 1 GiB, PostgreSQL 33.41 MiB / 768 MiB; second project remained healthy.
