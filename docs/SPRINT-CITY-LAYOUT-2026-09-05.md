# Sprint-owned tasks and physical city layout — 2026-09-05

Status: the user explicitly approved separate physical groups of blocks owned
by the same sprint. Append-only allocator implementation is in the working
branch. No production deployment or spatial reset has been performed.

## Product language

- A **city** is the durable project/world container.
- A **district** is a **sprint**: a durable grouping of explicitly assigned
  tasks, with its own identity, order, lifecycle and metadata. It is not a
  capacity overflow bucket created by the renderer.
- A **block** is a physical planning rectangle. Its streets and typed parcels
  organize placement; a new block does not create a new sprint or business task.
- A **slot** is a compatible physical parcel. Occupancy belongs to one existing
  task or a durable ruined-site marker, not to generated filler work.

Never move a task to another sprint, create a replacement sprint, reorder
business work or relocate existing task footprints to escape a placement error.
The earlier release-audit suggestion to open another district when a spatial
quota fills is not a valid automatic fallback under this clarified model.

## Reproduced baseline and root cause

The existing local release fixtures were generated through AppService on seed
424242; their earlier reports remain in `screenshots/release-readiness/sql/`.

| Fixture | Requested workload | Committed state at first failure |
| --- | --- | --- |
| B | One city, 20 interleaved sprints, 1,000 tasks | 220 tasks; task 221 fails |
| C | Ten cities, six interleaved sprints each, 100 tasks per city | 966 tasks total; city ten fails at its task 67 |
| E, control | One city, one sprint, 1,000 tasks | All 1,000 tasks generated |

These are allocator limitations, not the 256-chunk CITY scene cap. In B, the
city origin is `(96,-128)` and its bounds are `(29,-163)..(195,-29)`; the first
sprint is enclosed by newer sprints. C has the same blocked-frontier mechanism.
E's success does not resolve B/C.

Before this change, `nextBlockOrigin` in `src/server/world/block-layout-compiler.ts`:

1. Generates the expansion frontier from the current sprint's blocks only.
2. Rejects any candidate whose enlarged sprint bounding rectangle overlaps
   another sprint's bounding rectangle, even when actual blocks would not
   overlap.
3. Requires that sprint to remain a single connected physical cluster.

These physical-territory assumptions were stronger than sprint ownership.
They were removed only after the user explicitly approved detached physical
blocks; this is not a silent capacity workaround.

## Approved policy and implemented allocation

One sprint may own several separate physical groups of blocks,
while the **city's complete street graph stays connected**. Preserve current
placements. Prefer a usable adjacent frontier of the same sprint; when it is
enclosed, choose a compact, buildable frontier of the existing city network.
Every new block retains the requesting task's original sprint ownership.

Invariants:

- Sprint bounding boxes may overlap and include blocks owned by other sprints;
  they are derived navigation envelopes, not exclusive land reservations.
- Actual block footprints, construction envelopes and task occupancy remain
  non-overlapping. Terrain, city separation and road access remain mandatory.
- Selection/highlighting must use actual sprint-owned blocks, not paint or
  claim the entire bounding box as that sprint's land.
- Ordinary growth preserves block IDs, task IDs/numbers, assignment, old slot
  coordinates and existing streets. Explicit full regeneration remains a
  separately authorized operation.

The allocator exhausts compatible templates on the requesting sprint's own
edge frontier first. Only when none fits does it try the finite edge frontier
of all existing city blocks. Candidates share an actual existing street edge;
there is no disconnected jump, speculative bridge or intervening land claim.
On each frontier candidates are ranked by the city's resulting maximum
dimension, bounding area, distance from the fixed city origin, then coordinates.
The unchanged terrain/other-city/permanent-site predicate is applied before
acceptance. A fully inaccessible frontier still raises `BlockPlacementError`.

There is no data migration or template-version bump for this allocation policy.
Existing placements, block identity/shape, authored families and street segments
are retained from the previous layout. The next block keeps the original sprint
ID and its next physical block sequence. No task or sprint is manufactured.

## Derived bounds and render consumers

- `districts_v3.spatial_bounds_json` and `DistrictLayoutV1.bounds` remain derived
  navigation/invalidation envelopes. Overlap is legal; they do not own land.
- CITY `listDistricts` emits the union of actual owned block interior cells;
  `drawDistrictBoundary` outlines and hit-tests those cells. Detached groups
  do not fill or capture the intervening sprint. Tooltips anchor to the hovered
  owned cell, not the first distant group.
- COUNTRY miniatures use actual blocks and their `districtId` ownership.
- PLANET district symbols use the first occupied owned block (stable block
  sequence/ID), not the midpoint of the possibly overlapping district envelope.
- World audit still validates each block against its owner's containing
  envelope, grid alignment, physical overlap and the connected road network.

## Size-aware task-backed public spaces

Task variant intent may request `parkSize: POCKET | BLOCK` in the internal
compiler input; no extra public API or database column is introduced.

- POCKET uses an existing compatible PARK first. If none is free, an unoccupied
  BUILDING parcel without an infrastructure role or saved authored-family
  assignment may persist `parameters.slotKinds[slotKey] = PARK`. Its exact
  footprint, entrance and access stay unchanged; minimum size is 6×3 cells.
- Occupied, MOVE/RUIN and infrastructure-reserved parcels never convert. A
  missing slot creates a normal planned block; the pocket task occupies only
  its compact parcel, while the other parcels remain stage-zero reservations.
- BLOCK requires an existing PARK at least 17×17 cells or the new independent
  `park-grand` template (3×3 eight-cell modules, 17×17 actual footprint).
- Existing v2 templates and their packing order are unchanged. No park-size
  hint retains the existing allocation rules. Persisted overrides are checked
  for valid slot IDs, unchanged geometry and no service/family collision.

## Twenty-sprint acceptance and evidence

1. Preserve an anonymous replay of the existing B/C placement input using only
   an explicitly read-only transaction against their already isolated local
   schemas. Do not seed new schemas or mutate those fixtures for diagnosis.
2. Add a public compiler regression for 20 pre-existing sprint IDs. Insert tasks
   in durable numeric order, round-robin across all 20 sprints. First reproduce
   the enclosed frontier, then test the approved policy at the same boundary.
3. After each insertion assert unchanged prior task-to-sprint assignment,
   placement, block origin and existing road edges. Assert the exact submitted
   task ID set: no synthetic tasks or districts.
4. Test at least 1,000 mixed typed tasks, one empty future sprint and a resumed
   older sprint after newer sprints surround it. Assert compatible slots,
   disjoint physical blocks, one connected city road graph and every occupied
   slot's pedestrian access. Do not hard-code the number of catalog families.
5. Replay from the same frozen prior layout, ordered tasks and seed, and refresh from the persisted
   previous layout. Assert deterministic geometry and stable infrastructure
   role ownership. Test actual terrain and an impassable boundary separately;
   fail explicitly rather than inventing a bridge or moving another city.
6. Coordinate the expensive AppService replay and browser workload with the
   root agent. Record exact source hashes, population, extents, runtime and
   memory. Pure compiler success is not integrated database/browser proof.

## Canonical roads to other cities

The current semantic `road_networks_v1` belongs to one city layout. COUNTRY's
`connections` currently describes flights, not roads. Do not reuse that field
or draw decorative lines which disagree with CITY terrain or road endpoints.

Proposed independent planner boundary:

```text
planIntercityRoadNetwork({
  seed,
  cities: [{ id, bounds, roadNetwork }],
  isBuildable
}) -> world-coordinate orthogonal routes between actual city road nodes
```

Requirements:

- The full country input, not the viewport, determines destination cities.
  A road may continue outside the visible frame, but its far endpoint must be
  an actual city street node, never an invented edge airport/exit.
- Deterministic bounded route selection and terrain-aware pathfinding must
  preserve city/task footprints and explicit clearance. A disconnected land
  route returns a typed limitation; no implicit bridge or water overwrite.
- Shared corridors are reused. A minimum-cost city connection tree is a
  baseline for connectivity, not a claim of globally optimal road engineering.
- Persist or revision-cache the canonical country road graph and project the
  same geometry at CITY/COUNTRY; clipped render runs are disposable. Do not
  synthesize roads independently at each map level.
- New block placement must respect existing inter-city corridors; scene/cache
  identities must incorporate their revision. Otherwise a pure route planner
  alone is not a finished runtime integration.

Storage/API ownership and the canonical macro-terrain predicate must be agreed
with the root and map-geography agents before wiring this boundary. No rural
road runtime change is claimed by this planning document.

### Measured local compiler replay

`tests/sprint-city-layout.test.ts` starts from the original anonymous B/C input,
not a replacement town or an entirely dry synthetic map. It uses `terrainAt`
with seed 424242 and retains C's nine neighbouring city envelopes.

| Replay | Result | Physical blocks | CITY chunks | Preserved initial tasks |
| --- | --- | --- | --- | --- |
| B | 1,000 tasks, all 20 original sprints | 145 | 80 | 220 |
| C | City ten reaches 100 tasks; country reaches 1,000 | 12 | 12 | 66 |

Each insertion proves unchanged prior placements, ownership, block geometry,
entrances/access and semantic street segments. Final terrain/occupancy/access
audit is clean; one-command replay from the same frozen baseline and unchanged
refresh equal the incremental result. MOVE and RUIN remain reserved. The test
also retains explicit failure for a fully inaccessible city frontier.

The initial growth regression was witnessed RED for both old boundaries
(`/tmp/task14-sprint-growth-red.json`); the allocation-only three-file gate then
passed 35/35 (`/tmp/task14-sprint-growth-final.json`). Its B append loop took
approximately 15.3 seconds including extensive per-insertion geometry assertions;
C took approximately 94 ms. These are test workloads, not service latency or
database throughput claims. The final five-file pure gate, including park-size
and family-registration regressions, passed 48/48
(`/tmp/task14-sprint-park-pure-final.json`). The independent read-only review of
the two-stage frontier and persisted kind overrides found no blocker.
The final report is retained in [evidence/sprint-growth/pure.json](evidence/sprint-growth/pure.json).

### Isolated AppService/storage replay

`tests/sprint-city-runtime-growth.test.ts` creates a fresh disposable PostgreSQL
schema through `createTestDb`, registers a local test account and submits 240
tasks through normal AppService commands. It does not insert coordinates,
layouts, roads or forced families. Twenty sprint IDs exist before any task;
tasks are round-robin, stage 1, with automatic visual selection.

The fresh-reader and scene gate passed: all 240 tasks, the same twenty sprint
IDs, every initial 220 placement/family/footprint and every old road cell remain.
All twenty scene chunks cover the entire final city bounds. Node 24.19.0,
PostgreSQL on the explicitly allowed local `tasktopia_test` database:

| Measurement | Observed | Provisional gate |
| --- | --- | --- |
| Last 20 task creations, p50 | 90.35 ms | reported, not a separate gate |
| Last 20 task creations, p95 | 105.14 ms | <250 ms |
| Last 20 task creations, maximum | 110.55 ms | reported |
| Scene read from a new AppService instance | 117.96 ms | <2,000 ms |
| Whole 240-task append loop, including the task-220 scene snapshot | 17.91 s | not a throughput claim |

The new instance has an empty instance scene cache; database/OS caches were not
purged. This is a bounded, mostly-PLANNING service workload, not proof of 1,000
database tasks or browser performance. `/tmp/task14-sprint-runtime-growth.json`
records all twenty timing samples, scene bounds/revision and four source hashes.
Its durable copy is [evidence/sprint-growth/runtime-240.json](evidence/sprint-growth/runtime-240.json).
The temporary database schema is cleaned up by the standard fixture lifecycle.

Verified allocation source checkpoint:

```text
block-layout-compiler.ts f275292900b9abea9dc2349897fb123540129e2dec5c88caa8834844b555ad71
block-templates.ts       5d90ebbfdb940d864e8632b455988cec5b1b17bf8cbe1b0ecd38cb190300578c
```

## Verification status

- Completed: explicit policy approval, append-only allocator, public B/C
  regression, 1,000-task real-terrain compiler proof, determinism and immutable
  placement checks, permanent-site protection and affected-consumer review.
- Previously measured B/C failures remain historical baseline evidence; they
  no longer describe the current pure compiler result.
- Completed isolated integration: 240 tasks across twenty pre-created sprints,
  fresh public reader/full scene and bounded timing measurements above.
- TypeScript and scoped ESLint passed after the final test additions.
- Pending in this slice: fresh CITY/COUNTRY/PLANET browser acceptance and the
  task-backed public-space visual fixture, coordinated by the root agent.
- Production and external providers: untouched.

Rollback is not an automatic old-policy reset: the old allocator can preserve
saved detached blocks but may refuse subsequent growth. Preserve committed
layouts/history and prefer a forward fix; never regenerate or erase occupied
sites to make an old territorial policy fit.
