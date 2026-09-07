# Rectangular public spaces — local implementation draft

Status: partially implemented locally on2026-09-06 after the user's explicit
instruction to continue without a tracker binding. This remains the accepted
full plan; [delivery/evidence](../BLOCK-INFILL-2026-09-06.md) distinguishes the
implemented infill/corners/stages/forest/plaques from unfinished attached-house,
elongated-family and district-corridor work. No production change is authorized.

## Intent and allocation boundary

Fill usable residual land inside a block with rectangular, task-owned parks,
fountain squares, gardens or promenades assembled from the current terrain tiles.
One parcel is one building identity, not one task or database row per tile.

Keep the earlier product choice: reserve a parcel for a subsequently added task;
never automatically create tasks or depict an unassigned park as completed.
Unassigned public-space reservations use the planned-site presentation (stage 0).
After assignment they own selection, transfer and ruins. The latest user request
changes public spaces to THREE visual development stages: preparation, partial
landscaping and completed space. Draft mapping from unchanged task progress is
task stages1–2 → public-space1,3–4 → public-space2,5 → public-space3; stage0 is
an unassigned reservation, not a fourth progress stage. Do not apply this change
to ordinary houses, or silently change task workflow/status semantics.

Distinguish residual land from unoccupied but already reserved house/service
slots. Do not silently replace the latter: the screenshots include both cases.
Covering every visible grass patch with finished parks would require a different
product rule. Existing tasks, future service reservations, MOVE/RUIN sites,
entrances, walkways and construction clearance remain protected.

## Existing implementation and gap

`src/shared/block-templates.ts` currently adds a residual PARK only at the bottom
of a packing column when `row >= 2 && remaining <= 7`. It does not partition all
remaining interior land. `connectSidewalks` computes entrance routes afterwards.
Consequently a new fill pass must reserve these routes before placing parks,
not treat access land as an empty rectangle.

Reuse `task-park-catalog.ts`, `task-park.ts`, semantic slot kinds, task visual keys
and the existing public-space lifecycle described in `TASK-PUBLIC-SPACES.md`.
No alternative sprite renderer, per-cell persistence or per-park HTTP request.

## Ordered implementation slices

1. **Occupancy and residual rectangles.** Build a bounded cell mask from the
   block interior, complete reserved site bounds and connected entrance paths.
   Extract deterministic non-overlapping rectangles with a stable area/position
   tie-break. Require construction clearance and a reachable entrance. A narrow
   unusable fragment remains ground/path, never an unreachable task slot.
   Verify full cell accounting, no overlap and all entrances reachable across
   every template and a declared seed corpus. Do not claim a greedy partition
   is mathematically optimal; measure usable-area coverage and fragmentation.
2. **Stable parcel identity and assignment.** Append public-space reservations
   without renumbering existing slots or changing their geometry. Persist the
   generated layout/version boundary explicitly; do not reinterpret existing
   version-2 blocks by editing their seeded geometry in place. Select the park
   theme once from dimensions/seed, retain it after assignment and reload.
   Verify task insertion fills a compatible reservation before block expansion,
   with no automatic tasks and no reuse of MOVE/RUIN or service land.
3. **Whole-rectangle terrain composition.** Fill the entire parcel with native
   lawn/paving/water tiles. Use shape-appropriate compositions: small square
   fountain plaza, narrow promenade, larger garden. Centerpieces must fit; omit
   a fountain rather than clip it. Preserve paths and staged furniture positions.
   Verify the reservation and all three public-space visual stages, task clicks,
   transfer/deletion and native pixel cohesion in
   actual CITY screenshots, not ImageGen mockups.
4. **Scale and release gate.** Recheck 20-sprint/480-task and 1,000-task fixtures,
   serialized layout size, generation time, request counts and warm map changes
   against the existing recorded baseline. Capture close and whole-block views.
   Produce fresh migration/regeneration/rollback evidence and release hashes if
   code or persisted geometry changes. No production operation is authorized.

## Stop conditions

Resolve the tracked delivery task and applicable project capabilities before
runtime implementation. Stop on an occupied-site shift, blocked entrance,
automatic business-task creation, an unversioned layout reinterpretation or a
need to replace reserved future houses without an explicit product decision.

## Expanded request: diverse dense blocks and coherent forests

Status: read-only analysis and local plan only; production code is unchanged.
The latest instruction leaves current house artwork unchanged. The preceding
restyle is NOT approved for publishing.

### Confirmed source observations

- `blockSlots()` fills columns starting at the upper-left. `chooseTemplate()`
  normally cycles court32×32,row32×24,pair24×32; smaller fallback templates
  exist, so the generator is not literally single-sized.
- `COMPACT_BUILDING_SHAPES` has only6×6,6×3,6×4. Vertical and whole-block
  architecture require new explicit geometry/assets, not bitmap rotation.
- Independent one-cell site envelopes plus corridors are tested invariants.
  Merely reducing spacing would overlap fences or block entrances.
- Task input is already sorted by durable task number, but compatibility and
  infrastructure priority can assign a later task to an older block. Existing
  numbers are identities, not values to renumber for nicer labels.
- `forestGrove()` varies candidate density spatially, then
  `compactTreeCandidate()` retains only local minima among eight neighbours,
  including neighbours that might never become trees. This is a plausible
  contributor to sparse coverage, not a measured browser diagnosis.
- The CITY boundaries button controls both boundary and tooltip layers;
  `drawDistrictBoundary()` traces actual district cells and uses a territory
  hit area. The code inspection alone does not prove browser interaction works.

### Ordered next slices and acceptance

1. **Packing policy.** Add seeded upper-left, upper-right, lower-left and
   lower-right traversal, while preserving each sprite's frontal-top camera and
   south entrance. Direction is allocation order, NOT rotation of a finished
   layout including entrances. Choose among compact courts, dense perimeter
   rows, passage blocks, horizontal strips and vertical strips, with variable
   dimensions. An existing city must not re-roll on task progress or reload.
   Prove multiple layouts per seed corpus, valid access and bounded generation.
2. **Dense and attached houses.** Introduce an explicit shared-clearance policy
   for attached rows and block-external worksite fencing where needed. Keep
   roofs, task hit areas and entrances separate. Ordinary detached lots retain
   their current clearance. Test neighbours in different construction stages,
   fire presentation, clicks and transfer/ruins; no invisible overlapping fence.
3. **Residual land.** Cover all non-protected leftover land using rectangular
   public-space parcels. Tiny/narrow rectangles use paving or planted strips
   without an oversized centerpiece; allow a theme to span connected residual
   pieces only if one clear owner/entrance can be maintained. Every cell must
   be accounted for as site, path, reservation or public space. Never cover a
   road/entrance or manufacture an automatically completed business task.
4. **Task sequence and block plaque.** Allocate tasks in ascending number into
   the current compatible block before expansion, retaining explicit service
   and size requirements. Preserve all existing task numbers and historic sites.
   Render a small terrain-cohesive plaque outside entrances. Use212–231 ONLY
   for a genuinely consecutive membership; represent gaps as separate ranges
   or a compact first range plus count with exact membership on selection.
   Empty blocks show no fabricated task range. Test interleaved sprints, large
   explicit tasks, deletion, moves, overflow, zoom readability and no new fetch.
5. **Long vertical/block-wide buildings.** Define new dedicated elongated
   footprints and authored stages5→4→3 with the existing pixel grammar. A
   block-wide building is one task and excludes other lots inside its site;
   external street/sidewalk and entrance remain available. This is an explicit
   exception to the former six-cell maximum, never a stretched existing sprite.
   Current house art is retained; new family acceptance is a separate gate.
6. **Forest density field.** Introduce occasional dense cores, normal woodland,
   soft sparse edges and clearings with stable species clusters. Determine
   eligible candidates before spacing suppression. Use actual crown geometry
   so neighbouring crowns can touch without arbitrary dead margins; no trunks
   or crowns hide tasks, roads or water. Fix per-chunk candidate/draw budgets
   and verify chunk-order/reload determinism. Compare canopy coverage by zone
   in native-scale screenshots, not only a minimum tree count.
7. **District separation and boundary UX.** Prefer neighbouring block groups
   belonging to the same sprint; separate different groups with a connected
   street corridor rather than interleaving them. Preserve reachability and
   declared terrain constraints. Boundaries must outline true occupied groups,
   not the empty enclosing rectangle. Browser-check toggle on/off, pointer
   and touch task selection with boundaries enabled, tooltip cleanup after
   city switching, detached groups, overlapping sprites and20sprints.
8. **Joint acceptance.** Unit/property tests for occupancy, stage mapping,
   numbering and canopy selection; database tests for assignment/idempotency,
   MOVE/RUIN and allocation concurrency; real browser city closeups and whole
   districts, COUNTRY/PLANET regression, workload480tasks/20sprints and1000tasks.
   Record screenshot, console/network and timing evidence against the baseline.

New geometry requires a reviewed cutover version and regeneration plan; do not
retain a silent old-layout fallback or reinterpret persisted version2 records.
Preserve business tasks, immutable numbers and permanent historical occupancy.
Back up and prove restoration before any separately authorized production run.

### Historical planning gate (superseded for local development)

At the earlier planning pass, RepoWise doctor passed on2026-09-06. No Tasktopia provider tool or project task
mapping was found. The subsequent user instruction explicitly authorized local
implementation without that binding. Provider writes and production operations
remain unauthorized; see the linked current delivery report.

Read-only baseline verification: `npx vitest run tests/dense-block-packing.test.ts
tests/compact-forest-spacing.test.ts tests/district-territory.test.ts
tests/world-layer-order.test.ts` exited0:4files,23tests passed (2026-09-06).
These test current invariants, not the proposed features. Browser boundary UX,
new art, allocation changes and new performance workloads were not executed
in this planning pass; no implementation/visual acceptance is claimed.

## Building concept scope (superseded by keeping current art)

The accompanying AI image is a single preview, not an accepted runtime asset.
Explore cream/apricot walls, muted teal roof, chunky square pixels and a high
frontal-top camera. Keep the compact footprint and reduce apparent facade height.
Before integration, inspect at native size beside terrain and trees, verify the
existing geometry contract and only then derive independent stages 5 → 4 → 3.
This draft does not approve new sizes, overwrite catalog art or change the world.
