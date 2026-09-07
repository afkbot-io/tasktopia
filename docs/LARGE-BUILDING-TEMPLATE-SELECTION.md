# Building-aware new-block selection

Scope: choose a fitting new block before terrain/frontier search, preserving
the declared orientation, construction envelope and entrance access. Existing
blocks, placements, MOVE/ruin reservations and template-v2 decoding stay intact.
No database/API change, asset publication, regeneration or deployment.

Implementation order:
1. Test ordered candidates for ordinary, wide, tall and courtyard envelopes.
   Candidate dimensions must satisfy the same initial free rectangle as the
   parcel packer; prove all four packing corners.
2. Route new compiler allocations through those candidates using the requested
   catalogue family's approved shape. Keep local frontier before city frontier
   and fail with a placement error if no candidate fits.
3. Run compiler/persistence/packing/service regression tests and typecheck/lint.
   Inspect source diff for stale duplicate template lists and placement drift.

Art remains a separate acceptance gate: generate a long finished building,
check fixed geometry, then derive 4 and 3 only from the accepted source.
Reject incorrect roof/facade proportions rather than stretching the image.
Unapproved art must not enter the runtime catalogue.

Rollback: revert only this candidate-selection change; persisted plans do not
change shape. Do not downgrade the existing template-v3 reader.

## Implemented / review

`buildingBlockCandidates()` filters residential templates by requested approved
footprint before terrain search. It shares `buildingShapeFitsBlock()` with the
packer: footprint plus7 cells per axis for perimeter access/construction.
No rotation, clipping or fallback to another family. Ordinary house ordering
and public-space template selection remain unchanged. The compiler resolves
catalogue aliases and raises `BlockPlacementError` if no template fits.

Removed the duplicate residential-key list from the compiler. No database/API,
authorization, dependency or network changes. Filtering checks at most seven
rectangles. Existing v2 decoding remains necessary for durable placements.
Tests use12×6,6×12,18×6,12×9,25×25 geometry fixtures, not published assets.

Art experiments4–7 remain unapproved. Machine reports for6/7 are under
`tmp/long-building-art/attempt-{6,7}/`:6 occupies86×48 instead of94–96px width;
7 retains background pixels that spoil the shared frame. Native review also
found disappearing window colors. No reverse stages were derived and no
published asset/catalogue was changed.

Browser regression passed on the existing isolated96-task/3-sprint fixture,
desktop1600×1100/mobile390×844: parks, task dialogs, boundaries, four lighting
phases, CITY→COUNTRY→PLANET→CITY. One scene/overview/atlas read each, no chunk
or viewport reads, no captured page/console/request errors. Screenshots are in
`screenshots/large-building-selection/`. This is not a long-building preview.

Visual follow-ups remain: country tiles are oversized relative to block icons;
there is no visible intercity road exit. Accepted long/L/U art and reverse
stages, central road connections and traffic frame pacing remain open.
Production was not changed; complete release acceptance is not claimed.

## Fresh verification (2026-09-06, dirty task branch)

- TDD red:5 new candidate tests failed on the missing export; green:27 packing/
  plan tests. Final scope grew to6 candidate cases and one compiler replay case.
- Full `npm test`:825 tests/163 files passed,170.52s.
- `npm run build` (including TypeScript) and `npm run lint -- --quiet`:passed.
- Playwright `tests/e2e/block-infill.spec.ts --project=chromium`:1 passed,16.0s.
- `git diff --check`:passed. Main-agent review of the scoped source/test edits:
  no unresolved blocker; unapproved geometry integration remains explicitly out.
- Logs:`tmp/large-building-selection-{tests,build,lint,browser}.log`.

Full asset publication/audit was not run: published PNGs and catalogue were
unchanged, and the draft numeric/semantic gate failed. No release, migration
or regeneration rehearsal was performed in this slice.
