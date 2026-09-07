# Rectangular block plans

Follow-up: [building-aware template selection](LARGE-BUILDING-TEMPLATE-SELECTION.md)
now filters new-block candidates before terrain search; large art remains draft.

## Decision (2026-09-06)

New template-version-3 blocks own an explicit, versioned local parcel plan in their existing
`parameters_json`. Task placements still refer to stable `slot-N` keys. The plan
records the footprint, construction clearance, permitted use and structural
family; service reservations and authored variants remain separate metadata.

The packing algorithm accepts independent width and depth for each approved
shape. It splits free rectangles with a one-cell connected circulation aisle,
without rotating the building projection. Remaining usable ground is filled by
the existing staged public-space allocator, then frozen in the same plan.

Alternatives rejected: stretching existing sprites into longer houses; adding
unapproved catalogue entries; recomputing occupied parcels from a mutable art
catalogue; resetting existing cities to adopt a different packing algorithm.

Version 3 requires a valid plan; version 2 rejects a version-3 plan. Existing
version-2 blocks without a stored plan retain their exact column-plan
interpretation. This is a durable spatial record, not an alternate renderer.
Do not remove that interpretation before an explicit, verified data migration.
No city reset or production data migration is part of this change.

## Delivery and acceptance

1. Test a pure rectangular packer with wide/tall synthetic shapes, all four
   packing corners, deterministic ordering, clearance, containment and routes.
2. Persist the complete plan when the compiler creates a block. Validate stored
   data before materializing cells; reject malformed, overlapping, out-of-bounds
   and unreachable parcels rather than silently replacing them.
3. Verify previous task placements and permanent sites remain unchanged across
   insertion, stage changes, database reload and additional blocks. Run existing
   grid/service/public-space regressions and the production build.
4. Separately author and approve long, L-shaped and U-shaped building families
   and their 5→4→3 stages. Synthetic test shapes are not runtime artwork.

## Rollout and rollback

Deploy matching server/client revisions because both interpret block plans.
Existing JSON storage needs no schema migration. The template-version bump makes
older readers reject new blocks rather than silently applying the column recipe.
New plans must not be edited by
an older compiler: after new blocks have been saved, roll back to a revision that
understands `sitePlan`, or restore the pre-release database snapshot together with
the old application. A code-only downgrade that discards plans is unsafe.

No production release is authorized or claimed by this document. Release still
requires an exact tested revision, backup/restore rehearsal, complete accepted
artwork and the outstanding performance/visual gates.

The updater checks both the contract migration hashes and the previous image's
`package.json.tasktopiaRuntime.blockTemplateVersions`. Missing v3 capability
blocks ordinary image-only updates even while the database still contains only
v2 blocks. Its real PostgreSQL query also rejects missing, empty or malformed
plan envelopes. Full parcel geometry remains the world audit's responsibility.

## Scope review

Implemented: general width/depth packing, four-corner placement, durable v3
parcels, immutable v2 interpretation, validation/gates, CPU benchmark and a new
local-only preview fixture. No runtime asset/catalog or terrain changes.

Preserved intentionally: the exact v2 column decoder and shape ordering, because
existing task/MOVE/ruin coordinates depend on them. It is not used to generate
new blocks. Remove it only after a separate data-conserving migration.

Not completed: approved long/vertical/L/U families and their three authored
stages, large-family-aware template selection on constrained terrain, central
intercity road exits and the outstanding frame-time investigation. The packer
tests do not substitute for those integration/art deliverables.

Review checks covered actual callers, storage read/write, slot-kind/service/art
overrides, public-space gates, version rejection and downgrade behavior. The
rollout capability gap found during review was fixed before handoff. No provider
task/MR updates, commits, production commands or database resets were performed.

## Local evidence (2026-09-06)

Dirty integration worktree based on `b42fe5946350897dbb9b3bb904b0262dd591783d`,
Node24.19.0/macOS, local PostgreSQL5432. This is not an immutable release revision.

- `npm test`: **818 tests /162 files passed**,152.38s,
  `tmp/rectangular-plans-release-tests.log`. The earlier failure in the malformed
  override test was fixed by retaining the required plan while corrupting only
  the metadata under test; assertions were not weakened.
- Production build/typecheck: exit0, `tmp/rectangular-plans-release-build.log`.
  Lint: exit0, `tmp/rectangular-plans-lint-final.log`. Final shell-program regex
  cleanup also reran all12 preflight tests, exit0,
  `tmp/rectangular-plans-preflight-final.log`.
- Pure geometry corpus: all11templates ×4corners ×16seeds match the existing
  approved art's exact geometry; synthetic18×6 and6×12 parcels keep their
  dimensions, construction envelope and south routes. No fake runtime family.
- Actual PostgreSQL lifecycle tests retain saved plans through task stage
  updates and transfers; permanent MOVE/ruin lifecycle regressions pass.
  Release SQL is executed against valid v2/v3 and malformed test records.
- New fixture: schema `block_plan_preview_c8cd2e57dc21439293e448d4571448fd`,
  96tasks /3sprints /6v3blocks,51task-owned public-space parcels; world audit
  has zero violations. Details: `tmp/rectangular-plans-fixture.json`.
- CPU-only benchmark, no concurrent full suite/build/browser in the final run:
  40samples after warm-up, stored read P50/P95 **0.033/0.091ms**, repeated infill
  **0.270/0.484ms**, new plan creation **0.248/0.319ms**. Sample plan1544JSON bytes.
  Pure compiler1000tasks/20sprints:5samples, P95 **89.98ms**. All declared budgets
  pass; `tmp/rectangular-plans-benchmark-final.json`. Not API/database/FPS proof.
- Browser production-build test exercises actual CITY, day/dawn/dusk/night,
  task clicks, district boundaries, COUNTRY, PLANET and390×844mobile. Screens
  and request assertions are separate from the CPU benchmark. Source artwork
  was unchanged, so no asset republishing was performed in this slice.
  Final run passed in13.0s, `tmp/rectangular-plans-browser-final.log`, screenshots
  in `screenshots/rectangular-plans-final/`. One scene/overview/atlas request
  each; no viewport/chunk requests or browser/API errors.
- RepoWise was force-refreshed without editor setup; read-only doctor returned
  `ok:true`, `tmp/rectangular-plans-doctor.json`. `git diff --check` passed.

Screens inspected: dense rectangular sites remain aligned, gate paths are
unobstructed, plaques stay readable and night lamps remain visible. Country and
planet retain their existing abstraction; this test does not certify the
outstanding overview-art refinement or intercity roads as complete.
