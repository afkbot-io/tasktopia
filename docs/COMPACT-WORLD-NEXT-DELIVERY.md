# Compact world: next delivery slices (2026-09-05)

Update2026-09-06: the later directional-block/public-space pass is tracked in
[BLOCK-INFILL-2026-09-06.md](BLOCK-INFILL-2026-09-06.md). It changes forest density
and public-space presentation and invalidates the older RC as current-release
evidence. Attached/elongated buildings and new district corridors remain pending.

Status: local implementation and candidate verification completed on
`codex/task-14-block-runtime-integration`; production release gates remain open.
The ten-home, six-service and seventeen-tree expansion is now implemented.
Current evidence and remaining release gates are tracked in
`COMPACT-RC-2026-09-06.md`; the ordered slices below preserve the product intent,
not a claim that already delivered catalog work is still unimplemented.
The preceding release-readiness reports are baseline evidence, not verification
of this new revision. No production mutation, deployment, or task-provider write
is authorized by this implementation document.

## Authoritative product intent

- A district is a sprint with explicitly assigned tasks; a block is spatial
  packing, not a new sprint. Do not create sprints to hide allocation failures.
- Keep compact 8 px cell footprints and the approved frontal-top 45-degree art
  convention. New AI-authored architecture must be genuinely distinct and more
  expressive, cohesive with the chunky cartoon terrain and trees. Palette swaps
  and stretched copies are not new building families.
- Construct each accepted building from the same registered source identity:
  stage 5, then dismantle to 4, then 3. Stages 0–2 remain lot/worksite composition.
- Moving a task to another sprint leaves a permanent occupied MOVE location with
  a link to the canonical task. Deleting leaves permanent occupied ruins and a
  limited historical snapshot. Neither location can be allocated again.
- Infrastructure reserves a slot for a subsequently added task; it does not
  create tasks automatically. Preserve infrastructure identity on relocation.
- PLANET, COUNTRY and CITY share geography, and wheel transitions preserve focus
  and consume one transition per physical scroll burst.

## Ordered, independently verifiable slices

1. **Permanent site history and task transfer.** Audit existing marker lifetime;
   migrate durable country-owned history, enforce permanent occupancy in all
   relevant allocators, provide atomic same-city sprint transfer and authorized
   marker DTOs. Preserve task identity and rollback the whole move on failure.
   Client MOVE opens the current task; ruins open only the retained snapshot.
   Country/account deletion still follows privacy deletion, not indefinite data
   retention. Test repeat moves, delete-after-move, site overlap, failed moves,
   service-role preservation, and unauthorized access.
2. **Compact incident presentation.** Replace old tall-building effect geometry
   with bounded integer-pixel effects and explicit BUG/HOTFIX/defect lifecycle
   states. Distinguish report, repair, verification and active emergency. Do not
   show a burning finished roof over an empty fenced lot or a park. Cleanup must
   react to status, stage, visual kind, position and defect changes. Test native
   bounds, capped responders and update/disposal behavior.
3. **Geography and navigation.** Canonical four-connected continent groups and
   shared city projection, no invented sea bridges, cursor-aware wheel switching
   with shared burst gating. Verify large positive/negative deltas, ocean hit
   tests, reverse direction, level loading and warm cache transitions.
4. **AI building catalog.** Start with independently designed fire station and
   clinic, accept stage 5 in native and enlarged previews before deriving 4→3.
   Delivered2026-09-06: ten further homes and six further services, for21total
   families. Numeric geometry, palette, alpha and visual acceptance remain
   separate. All30new-home3/4/5variants were inspected in the real480taskcity;
   source and screenshot hashes are retained in each home's visual review.
5. **City growth and transport.** Reproduce 20-sprint allocation failure before
   changing spatial policy. The user approved separate connected-by-road groups
   of blocks within the same sprint on 2026-09-05. Prefer its adjacent frontier,
   then the city's buildable frontier; never move old tasks or invent a sprint.
   Intercity roads must connect real city endpoints through valid terrain rather
   than viewport edges. Keep unintegrated proposals out of active runtime.
6. **Compact trees and forests.** After the current public-space integration,
   redraw trees at the low-rise building scale and replace trunk-only spacing
   with crown-aware forest placement. See the accepted next-slice contract
   below. Implemented2026-09-06:17new16×16species, crown-aware clearance,
   deterministic groves and two-cell chunk halo. Real three-level/mobile QA
   passed, including the480task/20sprint city. Final production approval is
   separate from local visual acceptance.
7. **Release verification.** Run unit/integration/contract tests, migration and
   restore checks, lint/typecheck, asset verification and production build.
   Recheck browser CITY/COUNTRY/PLANET, task/site clicks, notifications, mobile,
   PWA, traffic/aircraft and declared dense-world workloads. Capture real runtime
   screenshots and network/console/performance evidence. Report failures and
   unexecuted gates explicitly; do not call the whole project release-ready from
   a subset of passing checks.

## Boundaries and review

Server owns occupancy and snapshot authorization; client visuals cannot free a
site. Snapshot fields are limited to historical task number/title, building
family, stage and recording time. Current task links must be resolved through
the existing authorized resolver. No resurrection of deleted tasks.

The new client and server contract deploy together. A new schema migration needs
its own forward/rollback evidence; do not reuse the previous 25-migration report.
Existing unrelated worktree changes must be preserved. After implementation,
audit replaced runtime paths and stale documentation, perform independent review,
and distinguish local acceptance from a separately authorized managed release.

## Current slice: district overflow and task-owned public spaces

User-approved scope: append new blocks when a sprint's compatible slots run out;
add small/large parks, fountains and monuments as task-owned occupied parcels.
The task owns stage, number, click target, transfer history and deletion ruins.
Decor inside that parcel is a deterministic projection, not another task.

1. Reproduce the enclosed-sprint boundary, then prove at least 1,000 tasks across
   20 existing sprints, stable old addresses and a connected terrain-valid road
   graph. District envelopes are navigation extents, never exclusive territory.
2. Centralize public-space variants, size intent and labels. Preserve an assigned
   variant on later synchronizations; choose new automatic variants only at
   first occupation. Small spaces fit compact parcels; a requested large park
   requires a suitably large parcel, not a renamed pocket park. Do not repack
   previously assigned version-2 blocks.
3. Compose a final park plan once, reserve the entrance and walkable routes,
   and reveal it by stages so trees/furniture do not move when a centerpiece
   appears. Generate native AI fountain/monument layers separately, stages5→4→3,
   with shared frame; stages1–2 use the current construction kit.
4. Verify public contract validation, persistence/reload, growth, transfer/delete,
   collision-free decor and continuous paths. Use isolated local fixtures and
   real browser screenshots; collect console/network evidence. No production
   reseed, provider task mutation, new dependency or deployment in this slice.

Storage: reuse semantic block parameters and the existing task visual key;
migration27 widens the explicit variant CHECK (the old database also rejected
the already advertised lake/parking variants). No geometry reset, per-tile
database rows or extra per-park fetch. Changes deploy together.
Rollback of code must not reinterpret new persisted variant/template keys;
local verification is not authorization for a production cutover.

## Next accepted slice: compact trees and coherent forests

Added from the user's actual service-art CITY screenshot on 2026-09-05. The
previous crowns visually dominated low-rise buildings, overlapped densely and hid
task sites. Implemented2026-09-06 under
`art/COMPACT-TREE-ART-CONTRACT.md`. Native art, spacing and a real30-task
three-sprint scene passed; this is not final release/20-sprint acceptance.

1. **Scale/art benchmark.** Redraw trees for the compact scene; do not just scale
   the old sprite at runtime. Preserve the high45 frontal-top axes, square crown
   planes, restrained horizontal bands and upper-left lighting. Reduce crown
   volume and contrast/saturation against the accepted terrain and buildings.
   Starting study target: native16×16 canvas,1×1 planting cell, bottom-center
   anchor8,16, roughly8–12px visible crown and10–14px full tree. These are draft
   measurements, not an approved replacement contract: compare at1×/4× next to
   row48×24 and wide48×32 before fixing species-specific bounds. Do not interpret
   the user's typo as an instruction to divide every dimension by exactly3.
2. **New source families.** Generate several genuinely distinct species in the
   shared compact scale. Register alpha/crown/contact masks and source hashes;
   update the tree skill, manifest, planting verifier and contact sheets together.
   The16×32contract is superseded by V7; all17runtime tree keys now use16×16.
3. **Forest placement.** Use seeded clusters of compatible species with a dense
   core, broken edges, clearings and occasional isolated trees. Keep ground
   contacts centered on grid cells, but vary occupied cells and patch outlines
   so forests are not rectangular rows or a random multicolored mixture.
4. **Visible clearance.** Reserve actual crown bounds/masks as well as trunk
   cells. Reject overlapping crowns and preserve clearance from building roofs,
   entrances, construction fences, sidewalks, public-space objects and water.
   Respect biome/species eligibility. Spatial bucketing and a fixed candidate
   budget keep this deterministic and bounded across chunk boundaries.
5. **Acceptance.** Test dense/sparse forests, neighbouring chunks, coasts,
   tiny pocket parks and a20-sprint city. Verify scale next to both low-rise
   benchmarks, no hidden task number/entrance, no conflicting crown masks, and
   stable placements after reload/stage changes. Capture real CITY/COUNTRY/PLANET
   views, measure placement/bake time and active object counts against the
   current fixture. Only then remove superseded tree sources/runtime paths with
   a recoverable archive. Do not regenerate business tasks or release to prod.

Sequence: finish the current growth/public-space tests and integrate accepted
park layers first, then this tree pass before claiming final visual acceptance
or release readiness for the city. Current evidence:
`screenshots/compact-rc-trees/`; older2026-09-05screenshots are baseline only.
