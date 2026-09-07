# Complete release scope — 2026-09-07

The user's latest request supersedes the earlier proposal to defer unfinished
features. This is the active acceptance ledger, not a release-ready claim.
Existing evidence is a baseline until the final integrated revision is tested.
Production deployment and real notification delivery are not authorized here.

Final local implementation/verification summary:
[COMPACT-RC-FINAL-2026-09-07](COMPACT-RC-FINAL-2026-09-07.md).
All current local gates pass; physical-device/provider acceptance, identified
target backup/capacity and approved immutable release remain external gates.

## Ordered work and acceptance

1. **District streets.** Add terrain-validated separation corridors for new
   sprint groups without moving old blocks, task sites or permanent MOVE/RUIN
   markers. Persist the approach and its reservation, connect both ends to the
   existing road graph, and prohibit later infill of the corridor. On a narrow
   dry shelf retain connected compact growth rather than inventing a bridge.
   Test incremental growth, clearances, old addresses and 20-district load.
2. **Intercity ground network.** One canonical terrain-safe route must drive
   COUNTRY roads and CITY approaches/exits. Flight connections are separate.
   Nearest-land marker snapping is not a continuous road projection: resolve
   that contract before rendering lines. Cover islands/no feasible route,
   city growth, country authorization, cache invalidation and query/CPU limits.
3. **Overview material scale.** COUNTRY 4×4 and PLANET 2×2 same-family patches
   preserve geographic cells and IDs. Verify real screenshots, negative-cell
   masks, warm transitions, DOM/raster memory and large-country frame cost.
4. **Distinct extended buildings.** Finish the eight named stage-5 drafts
   (garden-house, ivory-library, olive-cafe, plum-workshop, rose-clinic-annex,
   rust-loft, sand-balcony, teal-mansard), or replace a failed draft with a
   genuinely distinct accepted family; each requires independently verified
   reverse stages, not merely a new key or palette. Accept long horizontal, vertical,
   L and U architecture in the fixed compact style. Derive each accepted 5→4→3
   source, never stretch an old family or relax door/camera targets to pass it.
   Integrate all stages, footprint-safe packing, decor and real city previews.
   The first 12×6 gallery now has independently approved source stages 5/4/3
   and catalog/runtime integration with 118 passing focused tests. It appears
   in 20 real generated slots in the 1,000-task fixture; actual-map review is
   still required. Existing 23 families stay intact. The L-shaped court and
   ivory library now have all three independently accepted reverse stages
   and local catalog/runtime integration. Six new court packing/lifecycle
   tests went red before registration; all76 focused tests pass after it.
   The U/garden integration brought the catalog to28 families (revision `b447c524028d99be`), including
   the complete U-court and garden-house families. Six new U packing/lifecycle
   tests failed before registration; all76 tests in the four integration suites
   pass after it. Asset build and complete asset/style audits pass. The long
   vertical wing initially had accepted stages5/4 while stage3 corrections
   were under review. Rust-loft and sand-balcony then gained accepted
   stages5/4/3 and publication. That intermediate catalog had30families/150building
   stages,106props, asset revision `b7badd00f2877456`;82focused integration tests
   and full asset build/audits pass. The last five families (olive-cafe,
   rose-annex, teal-mansard, vertical slate wing and plum-workshop) now have
   all three source stages independently accepted and are registered. The
   final asset build passes with35families/175building stages,106props and
   510runtime PNGs, revision `750f26edc463160e`. The new vertical envelope is
   6×12cells/48×96pixels, not a rotated or stretched horizontal bitmap.
   The immutableV2 shape list stays unchanged; V3 and rollback capability
   metadata know all seven structural shapes. Final integrated verification
   and the48-case real-map art fixture were the remaining gates at that
   checkpoint; the fresh48-case result is recorded below.
   Failed drafts remain unregistered rather than passing under a
   wider geometry tolerance.
   The three-piece AI-authored courtyard furniture set is published with
   stage5-only, footprint/access/crown protection and a canonical cross-chunk
   anchor. Tests exposed and fixed a hard-halo bug where old paving could hide
   a permanent/planned-site or road exclusion;57targeted tests pass. Furniture
   is decoration inside existing task parcels, not invented tasks. A guarded
   33-case real-application art fixture exercised all cases and11finished-task
   clicks, then its strict native-pixel gate found a real PROP_ATLAS filtering
   defect. Shared resident/padding/night subtextures now use one nearest-frame
   factory; actual Pixi tests and independent ownership review pass. Browser
   rerun on the final48-case/35-family build now passes the strict pixel gate.
   Unassigned building
   and park parcels remain future stage0 task reservations, not automatically
   invented tasks; the fixture is not a fully built maximum-density city.
5. **Performance and feature regressions.** Attribute previous frame stalls
   before changing a ticker. Run the unchanged 40-task/3-district mobility
   workload for 300 seconds, and the large-city/database workload separately.
   Check map switching, task/deep-link/history clicks, infrastructure, staged
   public spaces, lamps/MSK time, aircraft, incidents and notifications.
6. **Release and recovery.** Refresh all tests, contracts, lint/typecheck/build,
   source/published-art audits and independent fixed-diff review. Rehearse
   current migrations/regeneration and matched database/image/static restore
   on disposable local databases. Freeze an exact reviewed revision and hashes.
   Real installed-PWA/background push and target backup availability remain
   external acceptance gates, not something mocked browser tests can certify.

## Ownership and rollout

The server owns durable occupancy, route identity and versioned read models;
the renderer may abstract scale but must not invent roads or free parcels.
Block parameters hold reserved corridor geometry; no per-tile database table.
Any new public schema deploys with all consumers in one coordinated release.
Old business data and site history survive layout regeneration. Rollback needs
the matching database, application image and static assets, not old code alone.

Heavy asset builds, production browser tests, full suites and cutover rehearsals
run serially. Draft art and local synthetic fixtures are not production changes.

## Current execution evidence (not final acceptance)

- FinalR5 whole-suite passes193files/1,088tests in166.65s after the CSS-source
  boundary fix. Whole-repository lint and the production build/typecheck pass.
  Logs: `tmp/release-final35-suite-r5-20260907.log`,
  `tmp/release-final35-lint-r5-20260907.log` and
  `tmp/release-final35-css-build-20260907.log`. The final browser replay on the
  host output proven byte-identical to the localR4 image also passes:48art
  cases, settled overviews,4focused deep-link/mobile/offline cases and one
  explicitly unsupported WebKit worker-lifecycle skip. All four native-pixel
  probes again match100%; errors/failed requests/domain writes are zero.
  Final screenshots are in `../screenshots/courtyard-art-48-final-r4/` and
  `../screenshots/courtyard-art-48-final-r4-overviews/`.
- Final artifact comparison found a reproducibility defect after the passing
  pointer-fix tests: Tailwind scanned an authored-art `PROMPTS.md` outside the
  shipped application and generated an extra254-byte `shadow/glow` rule only
  on the host. Independent comparison proved that removing that rule made the
  CSS identical; JS and sourcemap contents matched after normalizing the
  dependent hashed filenames. The build now explicitly scans `src/client`
  and `index.html`, not arbitrary local documents/tools. A real installed
  compiler/scanner regression went RED→GREEN; scoped review is clean.
  Rebuilt host and container now match all601built files exactly. The built
  asset synchronization CLI also materializes the identical511-file revision
  in a disposable128MiB tmpfs, without network, host mounts, database or server.
  Final local image is `tasktopia:compact-local-final35-r4-20260907`,
  `sha256:03537a60affa4ab51964a6d95cdaa0e5c28ef71ad32a21e8c7dd4cedfadb351f`
  (linux/arm64, Node24.20.0, uid1000). See
  `evidence/compact-rc/final35-r4-image-static-audit.json`.
  The earlierR3 mismatch report is retained, not presented as final acceptance.
  The final CSS-source-boundary change has its fresh whole-suite and browser
  replay recorded above; it does not change the traffic engine or server bundles.
- Final server-scale repeats pass on the same existing-only local workloads:
  1,000tasks/20districts and100cities/300districts/1,000tasks. Source hashes are
  unchanged during sampling and both budget-failure arrays are empty.
  Task-open p95 is7.20/3.09ms with two SQL statements; warmCITY1.96/1.34ms,
  warmCOUNTRY4.32/9.53ms and PLANET4.03/9.30ms. ColdCITY is396.8/75.4ms,
  separately measured, not p95. These are local service timings, not WAN,
  browser, target-capacity or universal instantaneous-load guarantees.
- Final whole-suite replay after the pointer fixes and frozen48-case harness
  passes all192files/1,087tests in167.00s (Node24, isolated PostgreSQL fixtures,
  serial execution). Log: `tmp/release-final35-suite-r4-20260907.log`.
  Earlier RED runs and the preceding1,081-test checkpoint are retained below
  as history, not substituted for this final result.
- Final35-family/pointer-fix traffic replay passes300.020s on the preserved
  Riverside40-task/3-district scene:14cars and25walkers remain stable and both
  populations move in all30 ten-second windows. It completes217trips and
  1,513crossings with zero measured unsafe/wrong-way/off-path violations;
  peak waits are9.15s/8.90s. Simulation p95/max is1.0/2.6ms, RAF p50/p95/max
  is16.7/25.0/33.7ms, with zero long tasks and one retained road-network build.
  The real clock has reached DAWN, unlike the earlier NIGHT run: stored
  geography/population/camera are unchanged, but this is not an identical
  lighting/trajectory benchmark or a60fps guarantee. See
  [the final traffic report](QA-TRAFFIC-FINAL35-2026-09-07.md) and
  `../screenshots/world-finishing-final35-traffic-300s/metrics.json`.
- Final48-case real-application replay is GREEN on the pointer-fix build:
  all13building families and three park themes at stages3/4/5 are captured
  unobscured, with the target fully on-screen and correct finished-task clicks.
  The native opaque-pixel probes match100%: picnic141/141, rack42/42,
  planter54/54 and vertical stage3 interior3696/3696. The acceptance threshold
  remains greater than95%; no source art or tolerance was changed to pass.
  Evidence is `../screenshots/courtyard-art-48-final-r3/evidence.json` and
  `stage-matrix-evidence.json` in the same directory. The synthetic66-task
  fixture includes18 actual service-reservation connectors and creates no
  automatic production tasks. Exactly one CITY, COUNTRY and PLANET read was
  observed, with zero viewport/chunk reads, application errors, failed requests
  or domain writes. Night at21:00MSK retains the same canvas,42lamps and
  1,000static decoration particles with intensity1. Physical-device behavior
  and nativeGPU performance are not inferred from Chromium/SwiftShader.
  Manual screenshot review rejected the original `planet.png`: it was captured
  before the transition overlay disappeared despite data readiness. Its48-art
  and native-pixel results remain valid. The separate settled recapture now
  passes, with zero transition overlays and exactly one read per map level:
  `../screenshots/courtyard-art-48-final-r3-overviews/evidence.json`.
  Main-agent review confirms the new `planet.png` shows the complete planet,
  not the release/loading overlay. The premature frame remains historical
  evidence, not the final screenshot. Independent art review sampled21 other
  real frames without new actionable geometry, clipping or stage defects.
- Four focused browser cases pass after the pointer fix: task deep link while
  terrain is still loading; mobile controls/touch zoom in Chromium and WebKit;
  and the real revisioned service-worker/offline shell in Chromium. The WebKit
  worker lifecycle is explicitly not certified by an equivalent engine test.
  No external push provider was contacted or claimed verified.
- Final35-family asset build, complete source/review contracts and runtime
  asset/style audits pass at revision `750f26edc463160e`. Seven focused
  integration files pass69tests, including all nine vertical-envelope
  packing/lifecycle checks and unchangedV2 coordinates. Fresh dependency
  audit reports zero known advisories. This was the focused integration
  checkpoint; final whole-suite,48-case browser and image verification after
  the pointer/CSS fixes are recorded above.
- Independent review identified and fixed a road-continuity defect:
  resident chunks include canonical transit roads, but CITY padding received
  only routes incident to the selected city. A B→C route crossing A could
  therefore stop at A's resident boundary. A bounded producer→padding
  regression and compressed-route selection fix pass20focused tests, types
  and scoped lint. No new
  terrain search, extraDB query or remote-city entity loading is authorized.
- A real cross-chunk reserved-site exclusion defect was also fixed: an
  origin-owned12×12 planned site spanning a64-cell chunk seam previously
  admitted49 forest crowns in the neighbouring chunk. Its bounded hard mask
  now includes clipped internal reserved cells; the replay produces zero
  overlapping crowns without duplicated markers or extra queries.56focused
  tests, types and lint pass. Mandatory FORCE=1 rebuilds old cached masks.
- The first final35-family whole-suite run passed1,076tests and failed three
  test fixtures. The AUTO fixture incorrectly capped20building tasks at40
  total tasks despite new park reservations; a finite80-task fixture cap
  preserves its exact20-building assertion and all four tests now pass.
  Two FIRE-reservation fixtures now pin accepted V3 parcels with two real
  permanent wide-site markers, rather than assuming a seed leaves a free
  incompatible slot. Their nine tests retain exact next-task reservation,
  old placements/markers and no-new-block assertions and pass. No production
  allocation code changed. This first full run remains recorded as RED.
- Release container context now excludes local diagnostics, RepoWise/agent
  caches and local .env overrides while retaining example configuration and
  public runtime assets. All26deployment-config tests pass; no local files
  were deleted and no production image was replaced.
- The real container build exposed two missing typecheck inputs in its old
  asset allow-list: micro-ambient-manifest.json and the vertical family's
  geometry.json. They now have narrow metadata-only inclusions; the authored
  source-image tree stays excluded. The initial Docker run and added metadata
  regression are retained as RED. The corrected container build passes:
  `tasktopia:compact-local-final35-20260907`, image
  `sha256:15276ee801919fd00b7a20c5c3b60bd8fbaca522878bf3a4c93bcbad30c0f4f4`.
  This checkpoint predates the later pointer-gesture fixes and is not the
  final candidate image; rebuild and fingerprint the final source before release.
  This is a local linux/arm64 image, Node24.20.0, uid1000, not a pushed
  production digest. A no-network/read-only static inspection confirms35/175,
  absence of source/evidence/config directories, and exact equality of all
  five executable bundles with the verified host build. Match the target
  architecture before deployment. Independent context/fixture review is clean.
  The second whole run passed1,080tests; only an obsolete blanket directory
  exclusion assertion failed. Its metadata-only/source-PNG exclusion test was
  corrected without changing the Docker rules or runtime. The third whole
  replay passes all192files/1,081tests in166.43s. The subsequent48-case fixture
  connector/retry corrections are test-harness-only and have focused checks.
  The later real pointer-gesture fixes changed production runtime and required
  a fresh whole-suite and image build, now passed and recorded above.
- The real48-case browser review caught an unwanted task modal after a slow
  drag. Gesture recognition checked individual deltas rather than displacement
  from the contact origin; many1px moves could pan the map and still select a
  building on release. Movement is now sticky for the whole contact sequence,
  suppresses selection while held, and preserves the existing500ms release
  guard. Stationary jitter and a subsequent ordinary click remain supported.
  Review then found a related two-contact case: the first release could select
  a building before a transform or final release occurred. Navigation now
  signals once when the second contact starts, without a synthetic camera move.
  Both regressions have RED→GREEN tests;14focused pointer/wheel tests, scoped
  lint/types and the production build pass. Independent review is clean.
  The final browser replay additionally requires every art capture to be
  unobscured with its target fully visible, plus real slow-drag and synthetic
  DOM multi-pointer checks. The latter is not physical-device acceptance.
- A further occupied-lot concern was disproved by a public AppService scene
  and serialized materializer regression: the full park mask retains all
  three park furniture pieces, and the canonical south-frontage rack lies
  outside the building lot's footprint.21targeted tests/types/lint pass.
  No production change was made for this disproved hypothesis.
- The final35-family production build and its built-CLI cutover rehearsal
  pass. `evidence/compact-rc/cutover-de3c0017b463/local-cutover-rehearsal.json`
  records migration through0029, conserved business hashes, zero world
  violations and exact original-table equality after dump restore. Three
  disposable databases were removed; the synthetic backup/report remain.
  This is local recovery evidence, not a target production restore test.
- Whole-suite replay after the30-family/furniture integration:188files and
  1,022tests pass (163.29s, Node24/local PostgreSQL5432). The initial16failures
  were traced to obsolete catalog/profile/schema counts, fixed-seed packing
  expectations and a reset-vs-incremental test contract. Fresh tests retain
  exact ordinary-update placement/geometry, all durable infrastructure
  identities on explicit reset, and exact deterministic second-reset plans.
  Publication/profile negative checks remain strict. New release-preflight
  work below is not included in this whole-suite result.
- Release review found that the ordinary updater still checked only0023/0024,
  although CITY4/COUNTRY7 require the canonical snapshot introduced by0029.
  The fail-closed migration/snapshot/previous-reader gate now passes27 focused
  shell/isolated-PostgreSQL tests, typecheck, scoped lint and shell syntax.
  Rollback also requires the old image to contain the candidate structural
  shapes and every authored family's geometry and five stage files. Public
  metadata is bounded; the old image is inspected without network, DB,
  host mounts or application startup. This is not a terrain/freshness audit.
  Production is untouched. Mandatory FORCE=1 still covers the hard-halo rebuild.
- Fresh production buildR3 and the built-CLI migration/regeneration/restore
  rehearsal pass. Evidence is
  `evidence/compact-rc/cutover-f33322699ee0/local-cutover-rehearsal.json`.
  The synthetic pre0023 database migrates through0029; durable task/content
  hashes survive regeneration and the world audit reports no violations.
  Restoring the retained synthetic dump reproduces all original table hashes.
  All three disposable databases were removed; the backup and report remain.
  This validates the current30-family build, not the upcoming final art batch,
  and is not a production backup/restore or old-image runtime test.

- District separation is implemented and focused tests/small-city screenshots
  pass. The fresh1,000-task/20-district server workload and read-only geometry
  audit now pass with19 persisted separators. The real browser now confirms
  all1,000 tasks,20district IDs,100block plaques and20rendered boundary groups.
  Waiting for the actual overlay frame exposed5,750 district-colored pixels;
  the earlier immediate screenshot was not evidence that boundaries failed.
- Canonical intercity storage, CITY schema 4, COUNTRY schema 7, dry projection
  and cross-city cache invalidation are implemented. The first real six-city
  browser fixture renders four accepted routes; seven explicit bounded-search
  failures leave two components. Do not describe this as a fully connected
  six-city network. A 60-second mobility run passed without unsafe motion,
  with no viewport/chunk reads and a 328 ms warm return in local Chromium.
- Screenshot review found a real rectangular material seam between resident
  CITY terrain and local camera padding. The padding used a different seed
  material, despite roads being correct. The shared atlas path and nearest
  sampling at render-texture creation now pass the six-city pixel/browser
  checks; main screenshot review confirms the material rectangle is gone.
  Natural-tree padding now also reuses the real seeded decoration generator,
  protected roads and depth ordering; main screenshot review confirms canopy
  continuation. The cache is finite (32→12→32 chunks during pan/prune/return),
  and11,691 active tree views have now passed explicit prune/return/logout
  checks. Repeated identical cycles initially exposed a real17MB/cycle leak:
  Pixi retained batch buffers for each fresh offscreen bake root. A reusable
  renderer-lifetime public-API root now gives51.93→52.12→52.17MB restored JS
  heap (0.24MB spread); logout leaves18.1MB with zero asset leases/tree views.
  These are forced-GC JS heap measurements, not GPU memory measurements.
  A deliberately fast197.53-cell drag on a1,600×2,800 viewport originally exposed
  four pending chunks for eight frames. The bounded first-visible native tile
  path now passes87 sampled frames with zero untextured frames:5,250 temporary
  cells peak, then zero after baking. Both new-per-frame and retained temporary
  cells are capped at8,192; larger misses remain explicitly deferred, not an
  unbounded instantaneous-render guarantee. Actual framebuffer capture while
  the temporary layer is live matches396/396 native-atlas sample pixels.
  Whole synchronous preparation peaked at14ms locally; GPU time is separate.
  The post-fix300.008s traffic run passes on the preserved40-task/3-district
  scene:14cars/25pedestrians,30/30ten-second windows with both populations
  moving, zero measured safety violations, zero long tasks, RAF median16.7ms,
  p9518ms/max33.3ms. Simulation whole-sample p95/max is1.3/2.1ms. Geography and
  population match the baseline, but a different ambient session seed means
  the trajectories are not bit-identical. This precedes the final art batch.
- Long gallery source geometry is 96×48 pixels / 12×6 cells. The three stages
  share the exact alpha foundation rows, a 3×3 leaf and 5×5 door frame, with
  roof coverage approximately 0/53/100%. The optional common source frame is
  checked without changing any of the 69 existing normalized building PNGs.
  Exact facade masonry-pixel identity is not claimed.
- Frame pacing was measured for 300 seconds on the unchanged forty-task
  workload; local software-renderer limits and the passing safety counters
  are recorded in `FRAME-PACING-AND-PWA-AUDIT-2026-09-07.md`. This predates the
  latest padding/extended-building changes and is not the final integrated run.
- Fresh server/database scale gates pass for both1,000 tasks in20 districts
  and100 cities/300 districts/1,000 tasks. Exact timings, query counts,
  read-only whole-world audits and limits are in `SERVER-SCALE-2026-09-07.md`.
  These are local service timings, not claims about browser/WAN latency.
- Real100-city browser checks now pass desktop/touch COUNTRY and PLANET:
  300district glyphs, exactly one scene/overview/planet read, no console errors,
  warm CITY return260ms. COUNTRY projects91 of92canonical roads; one has an
  explicit `NO_ORDERED_CORRIDOR` projection failure. The canonical network
  itself has eight components and37bounded-search failures, so neither the
  screenshots nor the passing tests certify universal road connectivity.
- Fresh regeneration regressions now also cover MOVE/RUIN history together
  with canonical intercity roads, idempotent replay and an injected failure
  at final road publication. All rebuilt cities and history roll back in
  that case. `REGENERATION-HISTORY-2026-09-07.md` records the two passing tests;
  the separate built-release dump/restore rehearsal has passed with the
  byte-identical current CLI; target production restore remains external.
