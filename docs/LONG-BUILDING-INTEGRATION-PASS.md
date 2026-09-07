# Long-building continuation — local work, not a release

## Scope and sequence

1. Author a genuine12×6-cell /96×48px house, then derive4→3 from accepted5.
   Keep the existing draft contract: shared frame/foundation, roof36–38px,
   facade9–11px, door3×3 in a5×5 frame. No stretched art or relaxed review.
2. Make the publisher's five-stage review sheet preserve rectangular native
   images. Existing fixed56px columns clip96px images; prove the correction
   using synthetic raster fixtures, independently of unapproved art.
3. Exercise12×6 and6×12 construction envelopes, south gate, full prop canvases,
   shared stages1–4 and removal at5 through `constructionStageLayout()`.
4. Register a new geometry only after all three authored stages pass numeric
   and individual visual review, then test packing and live five-stage scenes.

No database/API changes, city regeneration, production deployment or runtime
art replacement are part of the review-sheet slice. Existing accepted images
must retain their hashes. Use the current publisher and construction composer;
do not introduce another asset renderer or old-family fallback.

## Acceptance / verification

- Public contact-sheet output retains every pixel in horizontal96×48 and
  vertical48×96 five-stage rows, including first/last columns and mixed sizes.
- Existing48px-family layout remains identical; inputs are never resized.
- Rectangular construction tests cover boundaries, gate clearance, non-overlap,
  required crane/hut/materials, determinism and stages0–5.
- Focused tests, lint/typecheck and the serial asset verification/build/audit.
- Art is not published while doorway/projection/stage verification is incomplete.

Rollback is the scoped code change; this slice does not change stored plans.
Release/MR/production gates remain separate from these local checks.

## Implemented continuation

- The public `building_contact_sheet()` composer now allocates a common
  column width from the widest native sprite and independent row heights.
  The original48px-family layout is unchanged. The mixed96×48/48×24/48×96
  regression preserves every pixel; its first run reproduced clipping and
  complete overpainting of the middle row.
- Rectangular construction tests pass for12×6 and6×12 across40 deterministic
  seeds: full pad, one-cell external fence, two-cell south gate, all mandatory
  details, non-overlapping canvases and removal of temporary art at completion.
- Review found a second defect: the standalone published-pack audit accepted
  contradictory doorway/camera annotations when all file hashes matched.
  Six negative fixtures reproduced it. Both audit paths now share the same
  projection-record contract; these checks do not claim raster AI validation.

API, database, stored layouts, runtime catalog and release migration are
unchanged. Browser journeys need no new acceptance for this tooling-only
slice: no renderer or published pixels changed. Live acceptance of a future
long building is still mandatory before it can be announced as integrated.

## Current art finding

Attempts12–15 reached the intended96×46 occupied box in a96×48 canvas with
roof-dominant camera and zero alpha holes. Native review still rejects the
door: two- or four-pixel width/height, not the contracted3×3 opening. A further
local edit reduced it too far and lifted it off the foundation. These are
drafts, not accepted stage5; deriving4/3 or registering them would be premature.
Explicit broad magenta chroma and32-color quantization are mechanical source
normalization, not permission to alter the architectural contract.

## Verification evidence

Local dirty integration branch `codex/task-14-block-runtime-integration`, base
HEAD `b42fe5946350897dbb9b3bb904b0262dd591783d`; no new commit or deployment.

- Focused regression run:41 tests /5 files passed,
  `tmp/long-integration-focused-final.log`.
- Final complete test run after all code fixes:847 tests /165 files passed
  in169.60s, `tmp/long-integration-tests-final.log`; local test PostgreSQL on5432.
- Production build/typecheck and lint: passed,
  `tmp/long-integration-build-final.log`, `tmp/long-integration-lint-final.log`.
- Serial source audit → publication → complete pack audit: passed,
  `tmp/long-integration-compact-final.log`,
  `tmp/long-integration-assets-build-final.log`,
  `tmp/long-integration-assets-verify-final.log`.
- Catalog remains23 families /115 stages; publisher revision remains
  `8959092800adc456`, retired-art backup is null. No accepted runtime image
  was changed or removed.
- Style audit errors:0. Four existing identical-alpha-silhouette groups remain
  warnings: clinic/fire/railway; apartment/blue-bay/courtyard-apartment;
  bungalow/row/terrace/workshop-home; corner-balcony/wide. They are not suppressed
  or presented as completed unique massing. Long/L/U architecture remains open.
- Scoped code review: checked publisher spacing, source/audit contract parity,
  park normalizer consumer and cleanup of the superseded duplicated checks.
  The park consumer's runpy import regression was reproduced and fixed; its
  CLI is now tested from outside the repository. No full-branch release review
  is implied by this scoped review.
- RepoWise refresh/doctor passed; `git diff --check` passed. Browser/production
  smoke and load tests were not rerun because this slice does not modify those
  paths; earlier measurements are not fresh acceptance of the broader release.
