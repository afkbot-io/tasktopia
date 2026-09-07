# Compact courtyard furniture

Implementation checkpoint:2026-09-07. Three ordinary AI-authored props, not
new domain tasks, construction stages or natural world scatter.

| Key | Native canvas / occupied | Footprint | Anchor |
| --- | --- | --- | --- |
| `courtyard-picnic-table` |16×16 /14×12|2×2|8,16|
| `courtyard-square-planter` |8×8 /7×8|1×1|4,8|
| `courtyard-cycle-rack` |16×8 /14×5|2×1|8,8|

The family lives in
`assets/pixel-city-pack/reference/ai-authored/compact-courtyard-furniture-v1`.
`geometry.json` owns dimensions and hard-alpha normalization;
`visual-review.json` pins accepted source/runtime hashes and records independent
parent and author review at native1×/nearest8×. Picnic/planter bytes are unchanged
from their first accepted review. The lime planter is one small controlled
accent, never repeated into a carpet.

The rack's first source passed the old numeric dimensions but lost its outer
supporting legs after nearest sampling. B was too short, C had a diagonally
attached cap, and D contained a painted checkerboard. These remain under
`rejected/`; no rejected source is cataloged. The accepted E was authored through
the built-in ImageGen tool, including explicit magenta-background recovery.
No structural pixel was painted by code. E keeps all six legs, three closed
rectangular U-hoops and a common base. The strict native gate checks a single
4-connected opaque body plus three enclosed rectangular openings with
edge-connected tops and supports. This is a raster safeguard, not a substitute
for judging camera or style.

## Publication

`scripts/courtyard_furniture_contract.py:publish_courtyard_furniture` invokes the
family verifier with `--require-complete --require-review`, checks immutable
geometry and copies normalized PNG bytes unchanged. It updates only these three
authored prop entries and runtime/public paths. The main builder must call it
before `pack_props`, so frames share the existing atlas and asset revision.
There is no separate browser request per furniture object.

Run the global build and audits serially with the main integration owner; do
not publish in parallel with another family's build. The isolated publisher
test writes only a temporary pack and verifies byte identity, geometry and
rejection of stale reviews.

## Protected placement

- Task parks reserve their finished composition before tree placement. These
  props are revealed only at stage5; stages3/4 retain the same tree identities.
  The existing36-object cap, full crown masks, footprint holes, centerpieces,
  light spacing and path exclusions remain in force. At most one of each new
  object is tried: picnic needs at least36cells, rack24cells, and one planter
  may fit smaller beds. A site can reject any candidate; space is never forced.
- Building frontage reserves at most one new object. Its one south-frontage
  origin is chosen from complete task geometry/seed, independently of chunk
  visibility. If that point lacks safe paving, it is skipped rather than
  selecting a second position on another chunk. Large frontages prefer a picnic
  table if its2×2 footprint fits, otherwise rack/planter; compact homes use the
  smaller shapes. It consumes one of the existing2–4 frontage positions.
- The geometry-only `src/shared/courtyard-furniture.ts` table is shared by the
  worker generator and park composer; it does not import the large prop catalog.
  A publisher test compares its dimensions with accepted runtime metadata.
- A separate hard furniture mask in the materializer protects actual roads,
  permanent MOVE/RUIN footprints and access, and planned sites even where old
  paving remains underneath. Task footprints/access and visible crowns are
  independently excluded. There is no wire-field, query or physics addition.

### Halo producer and coordinated cutover

`src/server/world/decoration-halo.ts` is the actual AppService producer for
`decorationContext.blockedCellRuns`. It contains only roads and occupied task/
feature footprints/access outside the current chunk, plus reserved-site masks
clipped to the chunk **and** its four-cell halo. Planned-site entities remain
origin-owned: a site starting at x60 with width12 must still mask x64..71 in
the neighbouring chunk without adding a duplicate marker or entity.
Paving is carried exclusively by `surfaceHaloRuns`. The worker reconstructs the
previous combined mask for ordinary trees, lamps and landforms, but uses the
hard subset for furniture. A rack at x63 cannot extend into an occupied x64 cell
even when that cell still has old paving; safe x64 paving remains usable.

This is a coordinated RC read-model cutover, not a compatibility adapter.
The existing `block-v1`/tree7 identity guard alone also accepts old mixed-mask
payloads; restarting a process or changing the asset revision does not rebuild
those persisted chunks. Before reopening maps, run the existing authorized
regeneration workflow with **`REGENERATION_FORCE=1`** and a fresh release run ID.
The default non-forced command can preserve a valid world and is insufficient
for this semantic correction. Successful regeneration deletes that country's
`world_chunk_payloads_v1`, emits `country.regenerated`, advances worldVersion,
and invalidates local projections; Redis keys include that new worldVersion.
Rebuilt content hashes include both halo fields. No global Redis flush, extra
GET, speculative version bump or legacy decoder was added. A deployment that
skips this rebuild has not passed this cutover gate.

## Verification scope

`courtyard-furniture-art.test.ts` proves rejectedA/C fail, acceptedE has all
supports, isolated publication preserves bytes and stale review cannot publish.
It also checks all three live catalog entries, unchanged public PNG hashes and
pixel-identical crops in the shared prop atlas after the owner's serial build.
`courtyard-furniture-placement.test.ts` proves stage gating, fixed tree positions,
bounded count, paths/crowns, historical/planned/road protection and identical
new furniture across a12×6 building's chunk seam over24seeds.
The actual hard-halo producer is serialized to JSON and consumed by the real
materializer for external MOVE, RUIN, feature/task access, road and reserved-site
cases over old paving; it also proves safe paving and bounded reservation clipping.
The seed23 FOREST regression additionally protects the full crown area inside
an adjacent chunk whose planned-site DTO is empty. Before the correction,49
tree crowns overlapped that12×12 reservation; after it, none do. Natural trees
elsewhere remain possible, terrain/paving stay unchanged, and no marker is duplicated.
Existing decoration, task-public-space, chunk-materialization, path and lamp
suites remain separate regression gates. Global pack publication and actual
developed-city browser screenshots are required next; a mostly-planning scale
fixture or source preview alone is not runtime visual acceptance.

### Developed-art browser fixture

`scripts/seed-courtyard-art-preview.ts` requires
`SEED_COURTYARD_ART_PREVIEW=true` and an unscoped local `tasktopia_test` URL.
It always creates a fresh random `courtyard_art_preview_<uuid>` schema, retains
failed schemas for diagnosis, and never resets a preserved world. Seed424242 is
explicit. The48 requested examples cover thirteen published building families and
three public-space variants at stages3/4/5; stages advance via AppService and the
three sprints activate sequentially, retaining previous task states. Only an
actual `INFRASTRUCTURE_RESERVATION_CONFLICT` can add a named normal service task
in the same sprint before retrying an explicit family; at most24 are allowed for the48-case matrix,
and each must receive a real reserved role. Every extra ID/role/retry is logged.
No slot coordinates, role overrides or SQL task transitions are seeded.
The earlier48-case attempt stopped at the old12-connector cap; its schema
`courtyard_art_preview_af0b86e131a549b5ba76f7e8db16ec43` and RED log are preserved.
The approved24 cap changes only the disposable fixture, not production policy.

The script writes exact IDs, scene/asset revision, actual furniture and audit
results to `tmp/courtyard_art_preview_<uuid>.json`. The gated read-only
`tests/e2e/courtyard-art.spec.ts` consumes that artifact through
`COURTYARD_ART_FIXTURE_JSON`; use `E2E_COURTYARD_ART_FIXTURE=true` and the exact
matching local schema URL. Run Playwright with Node24's `--import tsx` for the
shared JSON-backed art catalog. The browser uses real pointer pans/wheel zoom,
one scene request, stage screenshots, finished-task clicks, all three native
furniture pixel probes, and warm CITY/COUNTRY/PLANET return. No production-only
debug hooks, fake scene responses or geometry mutation are used.

The first actual local fixture is
`courtyard_art_preview_0fd33b77ccf9429982a2274a546f7192`, seed424242,
assetRevision `b7badd00f2877456`, sceneRevision
`cd284056b5fa346dfa1f80a37cb3ee27a9d2d9a6a493b3a4b5de99838b5e2cab`.
It contains33 requested cases plus8 actual service-reservation tasks, three
sprints and15 new furniture placements; the read-only world audit returned0.
Each mutation uses its normal AppService transaction: a caught reservation
conflict must roll back before the explicit fixture adds its service task.
An earlier failed fixture transaction is retained separately for diagnosis.

This is a developed-art matrix, **not a fully built or maximally dense city**.
The12 saved V3 blocks contain104 parcels, of which41 have tasks;16 building
and47 park parcels remain reserved for future real tasks. Infill is enabled.
For example the U-stage5 block has2 occupied and7 future parcels. Their grass
is not missing finished-park rendering and does not authorize automatic tasks.

#### Native atlas filtering regression (browser verified)

The production R3 browser completed all33 stage views and11 finished-task
clicks, but its strict native pixel gate found shared prop-atlas smoothing:
only1/42 rack opaque pixel centres matched at actual4× zoom (2.38%). The
standalone task-park picnic PNG passed the same >95% gate. The native rack and
its atlas crop are identical, so the failure is in rendering, not authored art.
The failing daylight frame remains at
`screenshots/courtyard-art-runtime-day/courtyard-cycle-rack-native4x.png`.
Daylight is a declared fixed Date (09:00 UTC), with real animation timers;
the earlier ordinary dawn/night frames are retained separately.

Both resident static props and padding trees had inherited Pixi's linear
source filter. `pixelAtlasFrame` now sets nearest on the shared leased source
before creating resident/padding/day/night subframes. Frame-wrapper disposal
still preserves shared source ownership. Actual Pixi tests proved linear→RED,
nearest→GREEN;17 scoped regression tests, typecheck and scoped lint passed.
No source PNG, density, camera, geometry or pixel threshold changed. The final
35-family production build repeated the strict native4× gate successfully:
picnic141/141, rack42/42 and planter54/54 opaque pixel centres match exactly.
An additional fixed interior ROI on the vertical stage3 building matches
3696/3696 pixels. Native1× views were captured separately. The48-case matrix
and follow-up mobile/overview evidence are recorded in
`docs/QA-COURTYARD-ART-48-2026-09-07.md`.

The fixture deliberately has no MOVE/RUIN history; those negative hard-halo
cases are proved by the producer→serialized-runs→materializer regression,
not claimed as historical-site visual coverage in this matrix.
