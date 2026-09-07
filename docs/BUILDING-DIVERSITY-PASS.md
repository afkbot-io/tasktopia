# Building diversity continuation

Local scope, existing integration branch; preserve tasks and occupied sites.
No production deployment, database reset or tracker mutation.

1. Audit all registered five-stage families; finish independently authored
   alternatives with different roof/frontage architecture, reverse5→4→3.
2. Fix measured palette loss in draft normalization: median-cut removes all
   thirteen native teal window pixels in copper-court. An explicitly declared
   maximum-coverage palette retains them without repainting any geometry.
   Existing reviewed families keep their original transform and hashes.
3. Select least-used compatible homes inside each new block, then seeded
   tie-break. Preserve explicit requests, service roles and prior assignments.
4. Publish only fully reviewed families, run serial asset gates, tests/build,
   real-world stage previews and map round-trip screenshots.
5. Reassess open road/overview/performance/release gates against fresh evidence;
   do not declare the whole release complete while any remain unverified.

No new business concepts, database fields or network calls are needed for the
art/selection slice. Rollback matching client/server assets together; retain
the template-v3 reader for existing city plans. Stop asset publication if any
source fails frame, alpha, native readability or stage-identity acceptance.

## Implemented and reviewed

- `compact-blue-bay-v1`: blue balcony frontage, inset terrace and skylights.
- `compact-copper-court-v1`: ribbed olive roof, recessed pergola and cream ledges.
- Both use independently corrected5→4→3 sources, unchanged6×6 envelope and
  native48×48 canvas. All native foundation masks match exactly. Failed source
  attempts were not admitted by widening geometry tolerances.
- Copper's rare teal accents survive opt-in MAXCOVERAGE; all older families
  retain MEDIANCUT and accepted hashes. Its dark magenta background uses the
  existing explicit hue-family key, with magenta reserved for background.
- Least-used compatible HOUSE selection per block, seeded ties, one O(n)
  initialization of counts and O(1) count updates. Existing assignments,
  infrastructure reservations and explicit family requests stay authoritative.
- Review found that AUTO parks carry a non-rendered building placeholder.
  That placeholder must not count as an apartment. A RED regression with a
  reduced compatible pool reproduced changed house choices when only that
  placeholder changed; checking the actual slot kind fixed it. Incremental
  additions and bulk compilation now agree in both explicit/AUTO tests.
- Registered package:23families,115building-stage PNGs,447total published PNGs,
  assetRevision `8959092800adc456`. No runtime files were retired by this build.

## Browser evidence

Node24, local production build, Chromium, no production requests/mutations.

- `scripts/seed-block-plan-preview.ts`:96tasks/3districts/6blocks/51park tasks
  in new isolated schema `block_plan_preview_4c0df1863d704824bb056fd3b158a67b`.
  Domain audit reports no violations. `block-infill.spec.ts` passes; captures
  city/districts/country/planet, MSK phases and390px mobile, checks task dialogs,
  one scene/overview/atlas read and zero chunk/viewport reads.
- `scripts/seed-building-diversity-preview.ts`: new schema
  `building_diversity_1a505ee7470f4585868530b82e5bcdfd`,10explicit art tasks plus
  real infrastructure tasks where required. The fixture honors reserved sites
  instead of clearing their roles to force art placement.
- `building-diversity-art.spec.ts` passes all10stage clicks. All6late-stage
  assets were fetched successfully from the immutable revision path; no
  unexpected API writes/browser errors. Evidence and separately inspected
 360px crops: `screenshots/building-diversity-art/`.
- Visual review: full opaque rooms, no external magenta, consistent small
  doors and south paths, separate construction fence, stage2crane/cabin,
  legible badges. Stages1–2 share the intended kit, not duplicated final art.

## Verification results (final local source)

- Node `v24.19.0`, macOS, local PostgreSQL `tasktopia_test:5432`.
- Full suite:835tests/163files pass, `tmp/building-diversity-tests-reviewed.log`.
  Initial invocation without the local DB override failed on unavailable55432;
  that environmental run is retained, not reported as a code regression.
- Build/typecheck and lint pass: `tmp/building-diversity-build-final.log`,
  `tmp/building-diversity-lint-final.log`.
- Serial world-generator gate:29tests/4files pass,
  `tmp/building-diversity-worldgen.log`.
- Serial compact verification → asset build → whole-pack verification pass:
  `tmp/building-diversity-compact.log`, `tmp/building-diversity-assets-build.log`,
  `tmp/building-diversity-assets-verify.log`. Older accepted runtime hashes match.
- Final rebuilt browser runs pass: map round-trip15.8s,
  `tmp/building-diversity-browser-final.log`; new-family all-stage journey17.7s,
  `tmp/building-diversity-art-browser-final.log`. These are test durations,
  not application-latency guarantees.
- Existing warmed CPU benchmark:1000tasks/20districts,5samples,
  compile p50=84.13ms/p95=89.78ms; stored-plan read p95=0.063ms;
  forest64² p95=7.04ms. All existing local budgets pass.
  `tmp/building-diversity-cpu.json`. Previous same-harness local report
  `tmp/rectangular-plans-benchmark-final.json` had compile p95=89.98ms;
  different run conditions and only5samples do not establish a speedup.
  This is not a DB/end-to-end/60fps load test.
- Main-agent scoped review covered selection/persistence, park-counter
  regression, palette defaults, source/runtime provenance, fixture guards,
  all10new stage screenshots and the map/mobile/lighting screenshots. No
  remaining blocking finding in this slice; broader release gaps remain below.
- RepoWise structural refresh/doctor and `git diff --check` pass. The indexed
  Git base is `b42fe594`; it is not an immutable snapshot of this dirty tree.

## Still open — not a completed production release

Eight other newly drafted families need approved reverse stages. Long/tall/
L/U architecture remains unregistered: additional long-roof generations in
this pass still changed their canvas/proportions or door scale, so were rejected.
The three physical footprint classes have not been expanded by these two homes.

Fresh COUNTRY/PLANET screenshots still show oversized country terrain cells
relative to city miniatures. Real shared intercity road geometry/CITY exits,
overview scale refinement and attribution of the earlier frame stalls remain
open. This art pass does not claim to fix them, remeasure traffic or validate
production PWA/notification behavior. See WORLD-FINISHING-2026-09-06.md.

No migration/reset is needed for this slice. Deploy matching client/server
catalog and immutable asset revision together only as part of an authorized,
verified release. Existing sites keep their recorded family. Any requested
whole-world regeneration still needs its own backup/rehearsal/rollback gate;
do not treat these two new assets as authorization to wipe placement data.

Documentation reconciliation: README/live catalog/geometry contract/changelog
updated; earlier RC counts explicitly historical. API/DB/MCP contracts unchanged.
No new flags or compatibility renderer introduced. No commit/MR or release
approval has been claimed for the large pre-existing dirty integration branch.
