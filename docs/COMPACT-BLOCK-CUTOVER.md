# Compact block runtime cutover

Status: implementation in the working branch, 2026-09-07. This document defines
the current contract and release gates; it is not a production release report.

## Accepted outcome

Replace the organic complex generator with city → district → rectangular block →
typed slot allocation. A task occupies the earliest compatible vacant slot; only
when no such slot exists does the district publish another adjacent block and its
perimeter streets. Existing placements never move during ordinary growth.
The current procedural terrain/road materials remain authoritative.

The dense follow-up uses block-template version 3 for new stored parcel plans,
while preserving existing version-2 column plans, on an 8-cell module. Residential
rectangles span 2–4 modules per axis, packed with reviewed catalog footprints
(currently6×3,6×4,6×6,12×6,8×8,12×8 and6×12), a one-cell construction envelope and reachable pedestrian
aisles. Suitable residual parcels become staged pocket-park slots; tiny leftover
fragments are landscaping, not phantom tasks. Normal growth preserves existing
placements and extends shared semantic streets, rather than routing a road to
each individual building.

The user explicitly authorizes removing the large legacy building catalog and
resetting spatial data at deployment. Task IDs, numbers, content, statuses,
documents, dependencies, city/district identity and history must survive.

## Evidence and decisions

- `d7dc76cf` replaced the previous block planner with organic complex growth.
- `a6b9fbef` added block-v1 shadow tables while AppService still used organic
  placement and persisted road cells. That shadow path did not supply the
  production scene; the current cutover makes semantic layouts authoritative.
- `33853e03` introduced a separate preview, reverted by `987b47ac`; the new work
  integrates the real task/scene lifecycle instead of reviving that preview.
- Native cell remains 8×8. The first family is 48×48, footprint 6×6, one-cell
  construction clearance and roof-dominant 45° frontal-top orthographic
  projection. The measured door leaf is 4×3 inside a 7×5 portal; windows have
  paired 2×2 panes. The accepted roof region is 30 px, its open plane 25 px,
  facade 15 px and floor rhythm 5 px. These dimensions supersede the old
  18-cell residential width and 16-pixel door-height rules. See the
  [art contract](art/COMPACT-BUILDING-ART-CONTRACT.md) and its hash-pinned review.
- Stage 0 means an unoccupied planned slot, not a task status. Stages 1–5 retain
  the existing task-status mapping. Stage 1 is a fence; stage 2 adds a compact
  crane, hut and materials; authored stages 3–5 preserve one identity and anchor.
- Two additional independently authored families are now registered:
  `compact-row-v1` 48×24 / 6×3 cells / anchor [24,24] and
  `compact-wide-v1` 48×32 / 6×4 / [24,32]. Their facades are one and two 5 px floors;
  roof regions 17 px and 22 px dominate. Per-family door/window measurements and
  deliberate transparent clearances are in the art contract. Never stretch an
  apartment image to fill these slots.
- Park/water/parking slots are planned alongside building slots and are occupied
  by tasks. Their construction progress is task-owned, never inferred from an
  average district status.
- Roads are semantic shared edges of blocks; cells, masks and sidewalks are
  derived render/navigation data. Store blocks/templates and occupied slots;
  version3 freezes all local parcels in the block's `parameters.sitePlan` JSON,
  not separate database rows for empty slots or asphalt tiles. See
  [rectangular-plan decision and rollback](RECTANGULAR-BLOCK-PLANS.md).
- Stages are derived in reverse order 5 → 4 → 3 with one common source frame.
  Stage 4 has roughly half a roof and no final roof equipment; stage 3 has no
  roof, roughly half the masonry and opaque room floors at unchanged depth.
  Assembly percentage is not the percentage of occupied image height.

## Infrastructure reservation, not task creation

The compiler records a pending service role on the next already planned vacant
building slot. It never creates a business task or a block merely to satisfy a
quota. The next eligible authorized building task occupies that reservation;
park/water/parking tasks remain separate. Completed appearance and operational
airport eligibility come from that task's lifecycle, not the reservation alone.

- District building-task thresholds: after 8 reserve `EDUCATION`, after 11
  `MEDICAL`, after 15 `FIRE`, after 19 `POLICE` (nominal 9th/12th/16th/20th building).
- Every second nonempty district block queues a `SHOP` reservation.
- Six nonempty city blocks queue `RAILWAY`; three nonempty districts queue
  `AIRPORT`. Pending roles are serialized into existing free parcels and
  trigger IDs prevent repeats; competing roles may delay the nominal ordinal.

These semantic roles select the registered compact service families, including
school, medical, fire, police, shop, railway, airport and administration art.
One civic reservation is also queued after18 occupied city blocks. Every
published family has its own reviewed reverse construction stages. No automatic
task creation or silent completion of a service is authorized.

## Map and ambient contracts

- CITY scene schema 4 carries atomic chunks plus deduplicated completed-district
  task snapshots and bounded `airportConnections`; camera movement does not request more city chunks.
  Eligible routes join completed active task-airport slot centers in the same
  country, with at least one endpoint in the selected city (up to four remote
  pairs / eight directed routes). A remote endpoint does not load another city.
- COUNTRY overview schema 7 projects one semantic block as one building icon,
  retaining canonical geography and explicitly completed task-airport points.
- PLANET atlas schema 4 projects one district as one building icon from the same
  world coordinates. Aircraft endpoints come only from completed task-backed
  airports; a role reservation or viewport-edge flyby is not an airport.
- Canonical country ground routes are stored separately from flights. CITY
  approaches/exits and COUNTRY road projections derive from the same accepted
  terrain-safe routes. Bounded search/projection failures remain explicit;
  islands or exhausted search budgets do not generate fake straight bridges.
  GET requests read the versioned road snapshot, never run route planning.
- `TASKTOPIA_MICRO_TOPDOWN_CARTOON_V1` contains 36 newly authored directional
  micro images: four car variants, two people variants, eight static animals
  and one aircraft. Native people/cars/animals use 8×8 canvases, aircraft 16×16;
  they do not shrink the retired frontal art. See the
  [micro contract](art/MICRO-AMBIENT-ART-CONTRACT.md).
- Sparse ground variation belongs to deterministic terrain raster. General
  tiny flower/stone/reed sprite scatter is removed; square striped trees,
  coarse relief, and intentional content inside task-owned parks remain.

The `160×100` initial CITY composition is distinct from its resident scene
extent. The minimum camera scale is fixed at `0.8`, maximum at `4`.
Visible outer terrain/trees use the same seed and native materials without
adjacent entity/chunk reads. A bounded native first-visible layer covers ordinary
camera misses until baking finishes: both new-per-frame and retained temporary
tiles are capped at8,192. Larger jumps may explicitly defer; there is no claim
that arbitrary unbounded movement renders instantaneously. An outward zoom
step at the fixed level threshold transitions to COUNTRY. See the current
padding/performance evidence for tested viewport and drag sizes.

## Delivery slices and proof

1. Deterministic block templates, stable allocation and connected orthogonal
   road graph. Prove multi-district growth, varied rectangles, slot compatibility,
   no overlaps, unchanged old placements and deterministic regeneration.
2. Active storage/task CRUD cutover. Prove atomic allocation under the existing
   country transaction lock, task conservation on regeneration, status updates,
   deletion-to-ruin lifecycle and absence of legacy road writes. Migration 26
   adds permanent, country-owned site history and atomic same-city sprint
   relocation; see [permanent task sites](PERMANENT-TASK-SITES.md) for its separate
   contract and verification evidence.
3. Compact family and shared construction kit. Verify hard alpha, dimensions,
   registered paths, consistent anchor/identity and native-scale readability.
4. Production scene/client cutover, planned slots and task-backed green areas.
   Verify real browser loading, task interactions, connected roads, full
   sidewalks, compact scale and screenshots from the application.
5. Remove obsolete generator/catalog paths, reconcile docs, build/lint/test and
   run a repeatable local migration rehearsal. Regeneration is transactional;
   production rollout uses the existing managed deploy path and DB snapshot.

## Deployment boundary

Migration `0023_compact_block_cutover.sql` is deliberately destructive to derived
spatial state: it removes old road/feature tables, spatial task/district columns,
shadow layouts and cached chunk payloads, and replaces retired building keys.
It does not delete task product rows, task IDs/numbers, content, statuses,
documents, dependencies, history, city/district identity or the terrain seed.
All city layouts must be rebuilt before map traffic resumes. An ordinary task
mutation preserves old placements; an explicit regeneration may replan them.

The cutover preserves durable command identities: `city.create.v3`,
`district.create.v3`, `task.create.v3`, `country.regenerate.v1` and existing
deletion receipts. Do not delete or rewrite request hashes to reset geometry.
An old worker lease resumed after its product transaction committed must replay
the same entity, never create another task/city. Cached spatial DTOs and completed
generation-job results are reprojected from their current country-scoped entity
IDs, including HTTP/MCP polling. Old 18-cell footprints cannot re-enter through
these responses. A deleted target returns `NOT_FOUND`; a previously completed
deletion returns its original receipt. Non-spatial document/checklist/defect
results remain unchanged, and replay does not repeat mutations or history.

Before rollout, take a complete database snapshot and rehearse migration plus
regeneration against a disposable copy. Use the managed release path with map
traffic paused; run `npm run worlds:regenerate` from the built revision with an
explicit `REGENERATION_RUN_ID` and `REGENERATION_FORCE=1`, then require a clean
world audit and conservation checks before restoring traffic. Never run these
commands against an unidentified database. Rollback restores the pre-cutover
snapshot and application revision together; there is no old-world renderer or
down-migration fallback. No production release is performed by this change.

The ordinary updater fails closed while `0023`/`0024`/`0029` are pending,
checksummed differently, or leave missing layouts/placements/networks. Every
country with actual active blocks needs a canonical `country_road_snapshots_v1`
record with matching country/seed and the current compressed plan field types.
Migration `0029` creates the table but does not populate it. Empty worlds may
omit a snapshot; a valid empty route list or explicit disconnected/unreachable
result is not rejected. The guard neither rasterizes roads nor repairs data.

A previous running image also needs the same three migrations and declared
readers for block templates 2/3, CITY schema4, COUNTRY schema7, and the canonical
snapshot table. A template-v3-only image is not a safe image-only rollback.
The previous image must also declare every candidate structural shape with
matching dimensions/floors, and contain every candidate authored family with
identical footprint/sprite/anchor/entrance geometry and five existing ordered
stage paths. The public-manifest comparison is bounded to 128 families and a
64KiB compact descriptor, uses no network/server startup, and does not require
matching RGB or asset revisions.
These checks do not certify terrain, topology freshness or old decoration-halo
contents. This RC still requires `REGENERATION_FORCE=1` plus conservation/world
audits, even when preflight passes: the old mixed `blockedCellRuns` cannot be
distinguished reliably by the retained cache version. First cutover therefore
uses the authorized maintenance procedure in DEPLOYMENT.md; there is no bypass
flag. Regeneration's
release-wide lock uses a dedicated pinned transaction before opening the
migrating application pool, not a session lock on an arbitrary pooled backend.

## Verification entrypoints

Run `npm run assets:compact:verify`, then `npm run assets:build`, then
`npm run assets:verify` serially. `npm run assets:storybook` produces a catalog
review, not a generated-world acceptance screenshot. Geometry/alpha acceptance
and manual source review remain separate gates.

`tests/compact-release-preflight.test.ts` executes the shell guard with an
isolated Docker substitute and the actual embedded previous-image inspection
program. `tests/compact-release-plan-db.test.ts` runs the real SELECT against a
disposable PostgreSQL schema, covering current v2/v3 plans, malformed road
snapshots, valid empty/disconnected routes and another developed country with
a missing snapshot. These tests do not contact a deployment environment.

The focused database tests are `compact-city-runtime.test.ts`,
`compact-city-cache.test.ts` and `app-service.test.ts`; compiler/template tests
check deterministic slots, connected roads and terrain safety. The browser gate
is `tests/e2e/compact-city.spec.ts` against the current demo fixture: wait for
ground bake queue zero as well as buildings before capturing the city.
See [QA](QA.md) for commands. Full tests, build and real-browser/release evidence
must be recorded from the final revision, not inferred from this checklist.

## Current limits and boundaries

- Cross-city task relocation. Current relocation is intentionally between
  eligible sprints of the same city/project; it leaves an occupied MOVE marker.
  The marker opens limited history and resolves the current task when available.
- Automatic business-task creation for school/kindergarten/hospital or civic
  schedules remains prohibited; semantic next-slot reservations above are
  implemented, not automatic service completion. A periodic6/12-block park/lake
  policy is not claimed here; the18-block civic reservation above is implemented.
- The local pack contains35 published building families (27 residential and eight
  service families) across seven structural shapes. Compact service art,
  completed task-airport flights and canonical intercity ground roads are
  implemented, not deferred as a whole. Physical runway and railway-track
  gameplay are not implied by those contracts. See the
  [current art integration checkpoint](art/COMPACT-EXTENDED-BUILDINGS-2026-09-07.md)
  for the completed48-case R3 stage matrix,100% exact sampled native-pixel
  checks and the independent21-frame visual review. The original PLANET
  capture was rejected because a transition overlay covered it; the scoped
  ready-state overview recapture subsequently passed and its three new images
  were independently reviewed. This is not physical-device installed-PWA
  acceptance or a production release.
