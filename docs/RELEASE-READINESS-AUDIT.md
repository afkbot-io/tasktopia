# Release-readiness audit — 2026-09-05

Historical checkpoint. For the current implementation and remaining release
gates use [the September7 completion ledger](RELEASE-COMPLETION-2026-09-07.md).
The district-growth restriction and earlier catalog counts below are not
current open defects.

This is the preceding performance/release baseline. The later permanent-site,
incident, geography and service-art changes have separate evidence in
[COMPACT-WORLD-NEXT-VERIFICATION](COMPACT-WORLD-NEXT-VERIFICATION.md); do not
attribute the timings or migration-25 rehearsal below to migration 26.

Status: local verification completed in slices; **production release blocked** by
the district-growth policy and the external gates below. Base HEAD
`b42fe5946350897dbb9b3bb904b0262dd591783d`; the working tree contains the compact
world redesign and is not an immutable release revision. No production changes,
deploy, external notification delivery or release approval are implied.

## Ordered delivery and acceptance

1. Reproduce correctness/security failures before optimizing: retained realtime
   batches, authoritative task links, bounded push delivery and subscription
   ownership, completed-airport route lifecycle. Add regression tests first.
2. Measure server hot paths on isolated PostgreSQL fixtures; fix measured
   locality, query-count, cache and indexing defects without weakening membership
   checks, command idempotency or atomic construction allocation.
3. Scope client invalidation, deduplicate navigation/data requests, retain warm
   projections and task details with explicit invalidation. Verify actual browser
   requests, first-frame timing, stages and selected geography after reconnect.
4. Check renderer/simulation workload and bounded resource use; audit migrations,
   conservation, backup/restore rehearsal and safe release/rollback instructions.
5. Freeze source, run lint/typecheck/tests/assets/build serially, then browser and
   load tests. Review the fixed diff, fix findings, reconcile evidence and report
   remaining deployment gates. An incomplete/failed check is never a pass.

## Declared local performance workload

PostgreSQL test database only, isolated task-specific schemas. Tiers: one city
with 100 tasks/6 districts; one with 1000 tasks/20 districts; 10 cities × 100
tasks; 100 cities × 10 tasks. Fixtures are synthetic, not production copies.
Measure cold projection separately from persisted/warm cache hits, use 3 warmups
and 20 samples where practical, plus eight concurrent task reads and paired
stage mutations. Record query counts, SQL/lock time, payload/gzip bytes and RSS.
SELECT-only EXPLAIN ANALYZE is bounded by a five-second statement timeout.

Provisional local p95 budgets: task details 100 ms; warm CITY/COUNTRY 150 ms;
warm PLANET 100 ms; cold CITY 2 s; cold COUNTRY 2 s at ten cities / 5 s at one
hundred cities; stage mutation 250 ms at 100 tasks / 750 ms at 1000 tasks.
These are test targets, not measured results or remote-network guarantees.
Browser checks distinguish cold first-frame, warm transition, task modal shell,
task details, request count and animation frame time. Heavy browser/build/load
runs are serialized to avoid misleading contention on the shared workstation.

## Scope and external release gates

Preserve approved terrain/trees/compact art and existing business tasks. Service
roles reserve the next task's slot; no automatic task creation. Unique transport
complex art, physical runway/rail gameplay and task relocation are not silently
declared delivered. See COMPACT-BLOCK-CUTOVER.md for explicit limitations.

Production approval requires an exact committed/reviewed candidate, resolved
managed-release authority, a verified identified backup/restore plan, migration
and regeneration acceptance with traffic paused, configured push credentials if
Web Push is enabled, target-environment smoke/observation and authorized rollout.
Local tests cannot stand in for these external gates.

## Bootstrap evidence

The stale ignored RepoWise cache was recoverably archived to
`/tmp/task14-repowise-backup.pNh9fm/repowise`. Fresh no-seed fast structural
index: 407 files / 1646 symbols; doctor JSON `ok: true`, current base HEAD.
No credentials or project policy were intentionally changed. The final forced
no-seed/no-editor structural refresh initially indexed 461 files / 1745 symbols and passed
doctor at the same base HEAD; its preceding generated cache is recoverable at
`/tmp/task14-repowise-final.JPfUIq/repowise`. A HEAD-only `update --index-only`
reported no changes despite dirty sources, so it was not accepted as freshness
evidence. Existing untracked editor files were preserved, not attributed to the
application change or included in the release candidate.
After the dense COUNTRY slice, a further forced fast refresh indexed **478
files / 1749 symbols**; `repowise doctor --format json` again returned `ok: true`.
Structural unused/unreachable heuristics are leads, not proof that a dynamic
entrypoint may safely be deleted; no bulk deletion was made from those counts.

## Confirmed corrections

- A task detail read is one authorized MVCC aggregate of its child collections;
  warm requests use two SQL statements instead of nine. Same-stage progress no
  longer recompiles unchanged district/block/road geometry (64 → 17 statements).
- COUNTRY cold projection batches active city layouts instead of querying them
  per city (100-city fixture: 205 → 8 SQL statements).
- Additive migration `0025` gives comment history its missing
  `(task_id, created_at, id)` index. A bounded real EXPLAIN with 10,001 comments
  changed from a sequential scan / 173 buffer hits / 10,000 filtered rows to an
  index scan / four buffer hits / zero filtered rows.
- New-city site search keeps the existing inner search ranking, then searches
  two bounded outer annuli (radius 32 and 64). It never moves existing cities,
  changes terrain seeds or bypasses dry-footprint/separation checks. The old
  radius-16 cap prevented creation of city 48 in workload D; D now reaches 100.
- Task URLs resolve immutable IDs under membership checks; bare task numbers are
  scoped to an explicit or active country, never guessed across memberships.
- Push endpoints are provider-scoped, subscription ownership is atomic, network
  sends have a five-second wall-clock bound, and shutdown cannot accumulate an
  unbounded delivery queue. Provider delivery has not been exercised externally.
- The release regeneration mutex now owns a dedicated pinned PostgreSQL
  transaction; a pooled idle/lifetime reconnect cannot silently release it.
- The normal deploy updater rejects a pending compact contract cutover and an
  incompatible previous runtime. Initial destructive migration needs the
  explicit maintenance procedure in `DEPLOYMENT.md`, not image-only rollback.
- CITY texture preparation reuses worker-materialized terrain. Only external
  neighbour coordinates use memoized seed fallback, with exact seam/mask tests.
  Initial atomic preparation has a soft 4 ms / at most three-job frame budget;
  interactive work remains one job per frame. A synchronous job is not
  preemptible: the final observed 21.2 ms maximum batch is not claimed to meet a hard
  4 ms deadline. Geography, tile masks and texture resolution are unchanged.
- Dense COUNTRY (>10 cities) shows at most twelve non-overlapping map labels,
  with an 18% viewport-area budget and 64 px leader limit. Every city remains in
  the unchanged geographic miniature and a searchable, keyboard/touch-accessible
  local directory. Search/list scrolling does not fetch data or recreate the
  map; unreconciled labels cannot receive focus/clicks while images load.

## Local verification results

Source freeze includes the final terrain sampler, initial-bake scheduler and
dense COUNTRY directory with its pre-ready hit-target correction.
Node 24.19.0, local production build, Chromium/SwiftShader; no competing heavy
browser/load jobs. This is not mobile-hardware or remote-network certification.

- Full unit/integration suite: **660/660 tests, 126 files**, 98.54 seconds;
  `tmp/release-unit-density-final.json`. Earlier 654/654 evidence remains in
  `tmp/release-unit-final.json`. Whole-repository ESLint, TypeScript, production
  build and `git diff --check` passed.
- Asset verification passed: three compact families / fifteen stages, twelve
  terrain families, 36 micro actors, hard-alpha/palette/geometry checks and
  hash-pinned art review. Missing assets and orphan/contract violations: zero.
- Dependency audit: zero known advisories after the targeted patch upgrades.
- Server SQL workloads D/E passed their declared budgets; detailed evidence,
  source fingerprints, query counts and EXPLAIN plans are in
  [the SQL report](../screenshots/release-readiness/sql/README.md).
- Large browser CITY: **1000 actual generated tasks / one district**, mostly
  stage 1, 64 resident chunks; final cold login-to-complete frame **2836.3 ms** against
  an unchanged **3000 ms** budget. Before this optimization: **3301 ms, failed**.
  Thirty warm CITY/COUNTRY/PLANET round trips: zero repeated map reads, one
  retained city renderer, no page errors; post-GC JS heap
  219,907,816 → 221,174,056 bytes (**+0.576%**), DOM nodes 1278 → 1319,
  document count stayed at one. No unbounded-growth conclusion is inferred
  from a finite thirty-cycle sample.
  Terrain plus overlay RGBA estimate is **128 MiB**, not a measured GPU-memory
  value; it excludes CPU canvas backing and sprite textures. See
  `screenshots/release-readiness/scale-final/browser-scale.json` and
  `scale-density-final.json` (**1/1 passed, 37.6 s**). The prior passing run
  (2849 ms / +0.505% heap / 19.7 ms maximum batch) remains in
  `scale/browser-scale.json` / `scale-playwright-final.json`.
  The failing baseline remains in
  `scale/cold-before-batching.json` and `scale-before-batching-playwright.json`.
- Nine browser movement/compact-map/streaming scenarios passed on the
  sampler/scheduler build, before the COUNTRY-only presentation fix. During
  120.01 seconds: 67 completed trips, 534 completed crossings,
  every ten-second window had both cars and walkers moving, and all sampled
  collision/wrong-way/off-path counters remained zero. Simulation step p95
  **1.1 ms**, maximum 5.7 ms; maximum waits 5.95 s for vehicles / 9.7 s for
  pedestrians. RAF p95 **25.5 ms** on software rendering; this is not a 60 FPS
  claim. No >50 ms long tasks during the sample. The road network was compiled
  once, paused off-screen and reused after atlas return.
  Evidence: `screenshots/release-readiness/mobility/metrics.json`, complete
  temporal samples and `mobility-playwright-final.json`.
- Browser console evidence retains four specific SwiftShader startup
  ReadPixels warnings. Instrumentation observed zero application readback calls;
  no such warnings appeared during measured movement and no other GL/Pixi errors
  passed the gate. The initial anonymous-bootstrap 401 is expected.
- Mobile Chromium: three PWA/touch/consent scenarios passed. Offline shell uses
  the actual service worker; push permission/subscription APIs were mocked in
  the browser, and actual provider delivery was **not** exercised.
- Navigation regression previously passed queued pre-ready events, unrelated
  comments without card reload, warm task opening (2.5 ms / zero additional GET)
  and persistent failure → explicit Retry. Its first run caught and fixed a real
  callback-identity reactivation bug; that failure trace is retained under
  `navigation-first-failure/`. Final-source navigation rechecks are recorded
  separately below.

## Final UI and construction acceptance

- Dense COUNTRY browser gate: **3/3 passed, 8.2 s** on the built candidate.
  Delayed atlas PNGs left 100 label DOM nodes but zero visible/focusable label
  targets. Desktop pan/zoom, all 100 directory IDs, native wheel scrolling,
  zero search GETs and actual selection passed. At 390×844, real Chromium
  touch dispatch scrolled the directory without zooming/panning the map;
  keyboard selection opened city 100. Evidence: `density-playwright.json` and
  `density/` under `screenshots/release-readiness/`. Desktop/mobile screenshots
  were visually inspected; physical-phone performance is not inferred.
- COUNTRY 100-city navigation on the final build: **1/1 passed, 32.5 s**, cold
  login→COUNTRY frame **437.7 ms** (one sample), first return 134.8 ms. Thirty
  warm cycles: p95 CITY **226.7 ms**, COUNTRY **139.1 ms**, PLANET **171.1 ms**,
  all below the unchanged 250 ms warm budget; zero map/select requests. City 2
  and its renderer were retained. `country-100-navigation-density-final.json`
  includes every timing sample; its directory-selection setup happens before
  arming click-to-CITY timing, not inside the measured render latency.
- Ten-city atlas regression on the final build: **6/6 passed, 31.3 s**
  (`atlas-density-final.json`): accessible non-overlapping labels, unchanged
  miniatures, bounded camera, one atomic CITY read, zero pan data reads, paused
  retained renderer, city-load Retry and bounded replacement across ten cities.
- Final pre-ready realtime/cache/Retry and compact navigation regression:
  **2/2 passed, 26.5 s** (`navigation-density-final.json`). Warm task open
  **2.9 ms / zero additional GET**. Intentional reconnect bootstrap reads,
  revision refreshes, the injected 503 and explicit Retry are recorded; this
  scenario is not falsely described as zero network I/O throughout.
- Final SHOP tests cross 1→2→3→4 nonempty blocks, reserve after blocks 2/4 and
  consume the next authorized task (3/6), without phantom tasks or relocation.
  Actual airport lifecycle 4→3→4→5 is checked across CITY/COUNTRY/PLANET; the
  forbidden 5→4 transition leaves revisions, events and routes unchanged.
  Both focused files passed **14/14**, then joined the full 660-test suite.
- Main app/auth/mobile run passed twelve scenarios; its remaining case used
  obsolete district names, then an ambiguous task-title selector (1.1 vs
  1.10–1.14). Test-only selectors now match the real compact fixture and exact
  task number. The focused full app flow passed **1/1, 10.9 s**; both failures
  remain in `app-mobile-playwright.json` / `app-flow-retest.json`, and the pass
  in `app-flow-final.json`. Test-created countries/keys belonged only to the
  isolated `release_ui_20260905_final` schema.
- WebKit iPhone viewport/three-map touch journey: **1 passed, 2 explicitly
  skipped**, 5.6 s (`mobile-webkit.json`). Container WebKit does not verify
  standalone Safari service-worker or push delivery; those are external gates.
  The final build repeated both mobile projects: Chromium **3/3 passed**,
  WebKit **1 passed / 2 explicit skips**, total **4 passed / 2 skipped, 17.4 s**
  (`mobile-density-final.json`, screenshots in `mobile-final/`). No production
  provider notification was sent by these tests.

Build fingerprints: `dist/server.mjs`
`369cd504e67e429b4c00824097809cfa993fef152328aec214ec5044cc90f06a`;
regeneration CLI remains the rehearsed hash below. Final client entry
`index-CkYMwLo9.js` (261.80 kB / 81.28 kB gzip), CITY
`WorldCanvas-D5hpUY46.js` (167.35 / 56.05 kB), COUNTRY
`CountryOverviewCanvas--_oj1qO1.js` (15.80 / 6.12 kB). These are per-chunk sizes,
not total transferred bytes. The dense UI did not change CITY simulation/art
source; its two-minute mobility evidence remains valid for that unchanged path.

## Actual local cutover and restore rehearsal

The **built** `dist/regenerate-worlds.mjs` was executed against a restored,
isolated synthetic pre-cutover database (migrations 0001–0022). Opening the audit
with `migrate: false` verified all 25 applied migration names/checksums against
current sources, so the audit could not repair a stale CLI silently. Three tasks
at stages 1/3/5 and ten durable-content table digests survived; the world audit
ended with zero violations. A separate rollback restore matched all 41 table
digests, including the old road table. All three scratch databases were cleaned
up; the synthetic dump remains owner-only and gitignored for repeatable review.

Report: `screenshots/release-readiness/local-cutover-rehearsal.json`, completed
2026-09-05 12:05:57.845 UTC. Bundle SHA-256:
`c11e6b9a1b9a89721f32b671901974fcb368f8d087a514fb1d37b7d4a2bd4b65`.
This does not substitute for an identified production backup, maintenance-window
approval, target-environment rehearsal, or coordinated image/database rollback.

Independent findings, closed corrections and reviewed fingerprints:
[review record](../screenshots/release-readiness/independent-review.md).

## Dependency security review

On 2026-09-05 the initial npm audit found three affected runtime packages
(one high, two moderate). Targeted updates, without major-version migration or
unrelated dependency refresh, produced Fastify 5.12.3, fast-uri 3.1.7 / 4.1.4,
and xmldom 0.8.15. The direct Fastify minimum was raised and the lockfile pinned
the resolved fixes. Full `npm audit --json` now reports zero known advisories;
this is not a claim that unknown vulnerabilities cannot exist.

Primary patch references:
[Fastify validation advisory](https://github.com/fastify/fastify/security/advisories/GHSA-w2qp-rph6-63g4),
[fast-uri normalization advisory](https://github.com/fastify/fast-uri/security/advisories/GHSA-f65p-4m7j-42xc),
[xmldom serialization advisory](https://github.com/xmldom/xmldom/security/advisories/GHSA-6gmq-8vp8-gcm6).
Evidence: `screenshots/release-readiness/dependency-audit.json`.

## Remaining product capacity blocker

Workload B (1 city / 20 interleaved growing districts / target 1000 tasks)
stops at 220 tasks; workload C (10 cities / 6 districts each / target 100 tasks
per city) reaches 966 tasks before one district loses its expansion frontier.
These are reproducible geometric allocation failures, not accepted performance
results. A previously placed district can be surrounded on all sides by newer
districts while connectedness, non-interleaving and fixed old placements are
preserved. The 1000-task single-district workload E passes and does not invalidate
this failure. Choosing a reserved-growth policy, a detached district extension,
or a new-district workflow changes product behavior and awaits the user's choice.
Do not advertise unbounded district growth or release readiness until resolved.

Recommended next decision (not implemented without product agreement): reserve
growth land when creating a district and offer creation of a new district once
that explicit capacity is filled. This preserves connected districts and old
placements, but is a finite-capacity product rule, not an unlimited-growth fix.

## Screenshot evidence

These are actual local application captures, not AI-generated previews. CITY and
district share the 40-task compact fixture; the following COUNTRY/PLANET pair
uses the separate ten-city/three-country atlas fixture. They are not presented
as one continuous camera journey between different fixture countries.

- [City, mixed construction stages](../screenshots/release-readiness/mobility/city.png)
- [District close-up](../screenshots/release-readiness/mobility/district-Квартальный-район-1.png)
- [Country, ten cities](../screenshots/release-readiness/atlas-final/country.png)
- [Planet](../screenshots/release-readiness/atlas-final/planet.png)
- [Country, 100 cities](../screenshots/release-readiness/density/country-100-cities.png)
- [Mobile searchable directory](../screenshots/release-readiness/density/country-100-cities-mobile-directory.png)
- [Scale CITY, 1000 task sites](../screenshots/release-readiness/scale-final/city-1000.png)

## Reproduction boundaries

Use Node 24 and a dedicated **local test database/schema**. Full unit/integration
gate: `npm test -- --reporter=dot --reporter=json
--outputFile=tmp/release-unit-density-final.json`, with `CI=true` and explicit
`TEST_DATABASE_URL` / `DATABASE_URL`; then `npm run lint` and `npm run build`.
Browser reporters retain the executed specs/projects and their evidence;
fixture identities are stated in the workload sections and SQL report. Existing-fixture
runs use `E2E_SEED_COMMAND=true` and a built production server, with a separate
loopback origin and `E2E_DATABASE_URL` search_path for each fixture. Do not run
the demo seed or destructive rehearsal against a shared/production database.
SQL reproduction and constraints are in the linked SQL report; migration
rehearsal safety checks are built into `scripts/rehearse-compact-cutover.ts`.
