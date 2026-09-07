# Dense city and multiscale delivery

Status: implemented and verified locally on 2026-09-05, not released. Extends the
compact block cutover, without restoring the removed organic planner or realistic catalog.

The subsequent car/pedestrian controller replacement and people registration
revision have their own current acceptance record in
[`CITY-MOBILITY-DELIVERY.md`](CITY-MOBILITY-DELIVERY.md). The counts and screenshots
below describe this earlier dense-layout checkpoint, not the later traffic audit.

## Confirmed requirements

- Fill the current district's available block slots in task order before growth.
  Deterministic mixed rectangles replace sparse identical parcels. Small usable
  residual rectangles become task-linked parks, not phantom completed tasks.
- Reserve infrastructure for the next user-created task. Never create tasks
  automatically. Existing task content/status/history remain authoritative.
- AUTO consumes the preplanned slot irrespective of words in the task title or
  description. An explicit `visualKind`, `parkVariant` or building family is a
  separate constraint; the removed keyword classifier cannot bypass a service
  reservation. Conflicting explicit families fail transactionally with a clear
  `INFRASTRUCTURE_RESERVATION_CONFLICT` response.
- Native cell remains 8 px. Initial extra authored building targets are 6×3
  cells / 48×24 px / one floor and 6×4 / 48×32 / two floors. Existing 6×6
  stays supported as a real compact family, not a compatibility fallback.
  Buildings preserve the accepted high frontal-top camera, 5 px floor rhythm,
  axis-aligned windows/doors and a one-cell construction envelope.
- Keep approved procedural terrain and square striped trees. Remove tiny
  decorative grass/stone/flower scatter; no replacement object spam.
- COUNTRY summarizes one block as one building; PLANET summarizes one district
  as one building. Both project canonical geography and semantic city data.
- Tiny top-down people, vehicles, aircraft and mostly static animals must be
  newly authored, not shrinking the old realistic source art.

## Ordered vertical slices and acceptance

1. **Dense semantic layout.** Shared slot geometry and server compiler own
   packing, order, clearances, residual parks and connected streets. Tests cover
   deterministic regeneration, non-overlap, entrance reachability, bounded
   allocation, task ordering and unchanged old positions during normal growth.
2. **Authored building variety.** Accept finished family 5 first, derive 4 then
   3; preserve source frame and masks. Generalize the catalog/verifier only
   through explicit family geometry. Native/nearest previews plus runtime
   populated-block screenshots are the acceptance evidence.
3. **Infrastructure reservations.** Implemented deterministic defaults: shop every
   two blocks; education after eight building tasks, health after eleven,
   fire after fifteen, police after nineteen; railway at six blocks; airport
   at three nonempty districts. Pending roles do not bypass task authorization,
   create business records or pretend an unbuilt service is operational.
4. **Multiscale projection and navigation.** Reuse canonical block/district
   bounds in coarse maps; no city-detail props at coarse levels. Make task
   dialog opening independent of city-scene loading. Cache/prefetch bounded
   authorized data, invalidate on revision/country/session changes. Measure
   cold and warm paths separately; never claim zero network latency.
5. **Micro ambient and flight routes.** Integrate newly verified art; only
   completed task-linked airports may originate flights. Shared route geometry
   drives position, heading and takeoff/landing size. Static animals avoid gait
   frame churn. Remove retired references/assets after their consumers migrate.
6. **Integrated acceptance.** Actual CITY/COUNTRY/PLANET screenshots, building
   click and direct URL task journeys, repeated level transitions, no missing
   assets/console errors; full tests, contract tests, asset audits, lint/build,
   independent review and stale code/docs audit.

## Performance and data boundaries

Measure locally with the seeded 40-task/three-district city and 100-task service
workload. Warm navigation should not refetch unchanged city scenes; task dialog
shell should appear on the next render without waiting for terrain. Record actual
timings and visual-ready status rather than asserting an unmeasured “instant”.
Keep blocks/placements/road segments semantic in PostgreSQL, derive raster data
per bounded scene/chunk and cache against world revision. Do not store tile arrays
or duplicate city simulations for COUNTRY and PLANET.

## Implementation and review evidence

- Finite dense templates use 8-cell parcel modules, one-cell construction
  clearance and shared one-cell paths. Paths use shortest BFS to a perimeter
  sidewalk; the measured longest fixture path fell from 35 to 17 cells.
- Global task-number replay is shared by incremental growth and regeneration.
  Interleaved 90-task / three-district tests preserve infrastructure identity,
  block parameters, placements and the road network after replay.
- Current wire contracts: CITY **v3** with bounded real `airportConnections`,
  COUNTRY **v5** with one house per occupied block, PLANET **v4** with one house
  per nonempty district. Airports use the same canonical slot center.
- A retained CITY renderer is paused offscreen. Warm return keeps its canvas,
  texture residency and scene data. The latest fixed zoom floor is `0.8`.
  Visible out-of-scene padding uses local seed terrain, not extra scene/chunk
  reads. See `WORLD-FINISHING-2026-09-06.md` for current verification status.
- Browser checks include delayed terrain with an already-open task card,
  pending-task camera focus, persistent 503 recovery, reduced motion and ten
  level cycles. Functional assertions are supplemented with actual screenshots;
  a visible SVG node alone did not prove its texture had decoded.
- SCALE100, Node24/macOS, seed424242, one city / ten districts / 100 tasks:
  13 blocks, 100 placement rows, one road-network row, 128 road segments.
  Generation 5,981ms (20,000ms budget); cold nine-chunk read 169ms (1,500ms),
  worst of five cached reads 36ms (50ms), RSS279MB (850MB local budget).
  These are local workload measurements, not production latency guarantees.

### Final local verification, 2026-09-05

- Full Vitest run: **104 files, 557 tests passed**, no failed or pending tests.
  Machine-readable evidence: `tmp/dense-vitest-final.json`.
- Production Chromium: **10/10** compact-city, map-streaming and chunk-pipeline
  scenarios; **6/6** multi-city country-overview scenarios, plus a successful
  isolated repetition of the renderer-memory scenario. Separate preview schemas
  and ports were used; both suites consumed the same completed production build.
- Build, TypeScript, full ESLint, `assets:verify`, `assets:compact:verify` and
  `git diff --check` passed. Asset audit: 3 families, 15 stages, 105 props,
  36 micro sprites, 220 main-pack PNGs, no missing references or orphan PNGs.
  Pillow deprecation notices are toolchain warnings, not asset-validation failures.
- Measured warm COUNTRY→CITY return: **371.3 ms**, same canvas retained, just
  **one scene request** across initial load and return. Sampled missing ground:
  **0%** before and after the transition. See
  [`metrics.json`](../screenshots/dense-city-final/metrics.json).
- Reviewed actual application screenshots:
  [dense city](../screenshots/dense-city-final/city-blocks.png),
  [ten-city country](../screenshots/dense-atlas-final/country.png),
  [planet](../screenshots/dense-atlas-final/planet.png), and
  [all building stages](../screenshots/compact-building-five-stages.png).
  COUNTRY labels are screen-space packed without moving geographic anchors;
  PLANET labels exclude countries outside the visible globe aperture.
- Final independent read-only review of COUNTRY label packing, PLANET visibility,
  AUTO placement and reservation conflicts found no actionable issues. README
  resource counts were checked against files and the manifest. RepoWise fast
  index was refreshed after the final changes (388 files, 1,628 symbols).

Documentation surfaces: README, Unreleased changelog, generation specification,
cutover/migration instructions, QA procedures and applicable map/art skills were
updated. Prior generation notes are explicitly historical. No MR description or
release record was updated because no MR or deployment was performed.

## Deliberately separate from this local cutover

- Service reservations and task lifecycles are real, but services currently
  reuse the three compact building families. Unique school/station/airport
  architecture, a physical runway and railway-track gameplay are separate art
  and feature work; do not describe them as already delivered.
- Stage updates keep their existing transactional full semantic sync. The
  measured workload passes; a stage-only database compiler shortcut still
  requires a separate consistency/performance regression seam.
- No production deployment, production database wipe, remote MR or task closure
  has been performed. Old art was moved to recoverable temporary archives;
  business tasks, history and idempotency data were not deleted.

## Rollout, rollback and stop conditions

No production writes or release are part of the current local implementation.
Cutover uses the documented database snapshot, paused map traffic, derived-layout
regeneration and exact verified release revision. Preserve business records and
seed. Restore snapshot/revision if verification fails. Do not publish unreviewed
art or claim unfinished transport/infrastructure is complete. Any changed wire or
durable schema needs explicit contract/migration tests; no old-runtime fallback.
