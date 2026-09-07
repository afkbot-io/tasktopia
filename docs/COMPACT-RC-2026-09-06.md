# Compact world — local release candidate, 2026-09-06

**Historical baseline:** subsequent local block-infill/forest/public-space changes
supersede this source fingerprint. This report does not approve the current dirty
checkout for release. See [the incremental delivery](BLOCK-INFILL-2026-09-06.md)
for implemented behavior, fresh evidence and remaining scope.
The later [building-diversity pass](BUILDING-DIVERSITY-PASS.md) publishes23
families/115stages; counts and test logs below describe this historical baseline.

The local implementation is complete for this slice. This is a verified
working-tree candidate, **not an approved immutable production release**.
Production has not been changed. Base Git HEAD is not the tested source: the
checkout includes the preceding uncommitted compact-world redesign.

## Delivered

- Ten additional individually AI-authored homes and six additional services
  (police, school, shop, railway, airport, administration): 21 total families,
  105 stage images, 308 catalog runtime PNGs plus 129 generated road-atlas PNGs
  (437 published PNGs); assetRevision `0912ab37de3e0fa5`.
- Footprints remain 6×3, 6×4 or 6×6 cells (48×24/32/48 native pixels). Each
  identity follows reviewed 5→4→3 sources; stages 0–2 use shared lot/worksite
  composition. No stretched palette variants count as new architecture.
  See [authored catalog](art/COMPACT-AUTHORED-CATALOG.md).
- Seventeen compact tree species: 16×16 canvas, at most 12×14 visible pixels,
  centered anchor, deterministic crown-aware spacing, coherent groves and
  path/lot/furniture clearance. Four obsolete V6 sources were recoverably
  archived outside the repository; no V6 runtime fallback.
- Accepted code-generated terrain and roads retained after real-map review.
  Trees/buildings were adapted to them. Chunk-edge tree context has a bounded
  lookup halo, not extra browser requests. Removed obsolete PARK_DECOR handling.
  Rare shore species lazily sample missing terrain out to ten cells; the crown
  halo stays two cells. A focused RED→GREEN regression reproduces an omitted
  willow at a boundary and caps its sample probes at 40, with no HTTP involved.
- One civic reservation after 18 occupied city blocks; migration 0028 accepts
  CIVIC. Infrastructure is assigned to a subsequently added task, not an
  automatically invented task. Existing placements do not reroll.
- COUNTRY/PLANET use the authored airport terminal instead of the old row-house
  glyph. Completed task airports drive bounded flight routes.
- Operator audit performs no migration or repair and exits nonzero on invariant
  failure. Fixed its false assumption that PLANNED always means never started:
  it means currently inactive sprint. Switching preserves task progress and
  geometry; inactive stage writes still fail with DISTRICT_NOT_ACTIVE.
  The regression covers audit, unchanged progress and reactivation.

## Fresh evidence

Paths are repository-relative. JSON names without a directory below are under
`docs/evidence/compact-rc/`. Earlier failed attempts remain diagnostic evidence,
not successful acceptance. All fixtures are local and synthetic.

| Gate | Result / evidence |
| --- | --- |
| Unit/integration | 151 files, 767 tests passed; `tmp/compact-rc-final-tests.log` |
| Build/static checks | Types, ESLint, production build and asset audit pass; `tmp/compact-rc-production-build.log`, `tmp/compact-rc-final-lint.log`, `tmp/compact-rc-assets-verify.log`; `git diff --check` clean |
| Art provenance/geometry | All 21 families pass; `tmp/compact-rc-authoring-final.log`; source/runtime SHA256 reviews |
| Twenty-sprint city | 480 tasks, 80 blocks, 42 chunks; `large-city-fixture.json`; read-only audit zero violations in `large-city-audit.log` |
| Real new-home stages | 30 successful building clicks and screenshots, 10×3 stages; `final-browser.json`; each family's visual-review pins screenshot hashes |
| Whole city / districts | `whole-city-browser.json`; `screenshots/compact-rc-final/{city-whole,districts-whole}.png` |
| Dense 1000-task server | `server-scale-1000.json`: accepted, no budget failures; task-read p95 17.31 ms, warm scene p95 3.74 ms, cold scene 738 ms / 20 queries |
| Dense browser | `scale-browser.json`: final build cold complete CITY 2588 ms; 30 warm roundtrips with zero extra map reads; post-GC heap growth 0.57% |
| Traffic | `mobility-browser.json`: 120 seconds, 82 completed trips, 582 crossings, safety assertions pass; simulation-step p95 1.1 ms. Normal light waits remain: peak vehicle 11 s, pedestrian 7.15 s |
| MOVE/RUIN/HOTFIX/task errors | `lifecycle-browser-final.json`: 6/6 pass; real history and incident screenshots in `screenshots/compact-rc-lifecycle-final/` |
| Airports / flights | `airport-browser.json`: 1/1 pass; two task-backed airports, CITY flights, one COUNTRY connection, two PLANET terminal markers |
| New service art | `service-art-browser.json`: all six authored service families selected by exact buildingType, completed stage visible and correct task opened; reviewed screenshots in `screenshots/compact-rc-service-art/` |
| Wheel / mobile PWA | `pwa-wheel-final-browser.json`: 6 passed, 2 explicit WebKit lifecycle skips; wheel burst/reversal, Chromium and WebKit touch/layout, Chromium offline shell and gesture-gated push opt-in/out |
| Migration / restore | `cutover-55349104b9c6/local-cutover-rehearsal.json`: final built CLI, pre-compact backup, migrations through 0028, regeneration, preserved business hashes, zero audit violations, restored-table hash equality: PASS |

The 480-task visual run had concurrent verification and is not the cold-load
performance gate. The 1000-task run is the declared browser workload. Local
timings do not promise identical device or production performance. Synthetic
restore starts before permanent sites existed; current MOVE/RUIN occupancy and
history are separately covered by current-schema integration/browser tests.

## Deliberate boundaries

- A mandatory service role can retain a compatible structural-family image if
  the next existing slot has another footprint. It is not stretched/deferred;
  no phantom block/task is created just to display a new sprite.
- Stage 0 is a reservation, not a finished house. The 20-sprint fixture includes
  unfinished work and unused slots; it does not depict every planned slot built.
- Compact emergency responders are bounded visual incident effects, not a full
  road-routed emergency-dispatch simulation.
- Masks verify dimensions/anchors/alpha/palette. The 45-degree camera remains
  a visually reviewed art convention, not a recovered 3D camera measurement.

## Production gates requiring the actual environment

Follow [the production runbook](COMPACT-PRODUCTION-RUNBOOK.md).

1. Review/freeze the entire candidate as a Git commit and image digest. Do not
   deploy the old base HEAD or an unidentified dirty directory.
2. Identify/authorize the destination, restore-test its real full backup and
   repeat regeneration/hash comparisons on a production-sized isolated copy.
3. Verify a real installed-PWA upgrade from the deployed version and real push
   delivery/navigation on supported devices. Local offline/touch/permission
   flows do not prove delivery by the production push provider; WebKit skips
   unsupported service-worker/push lifecycle emulation.
4. Freeze writers; deploy matching client/server/static assets; regenerate under
   the release lock; audit all countries and compare durable data before
   reopening. On failure restore matching database + image + static release.

No production deployment, provider task update, push/MR or implicit approval
occurred. External gates cannot be labeled PASS using local synthetic evidence.

Final local source/build/asset/migration fingerprints are recorded in
[`release-fingerprints.json`](evidence/compact-rc/release-fingerprints.json).
The code index was force-refreshed from this working tree and RepoWise doctor
passed. See [scoped code/visual review](evidence/compact-rc/REVIEW.md).
