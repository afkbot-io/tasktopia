# Canonical intercity road rendering — local evidence

This is a local implementation/QA checkpoint, not a deployed release. The
terrain-material and straight canopy cutoff defects are fixed. A bounded native
first-visible path now closes the measured large-jump material miss, and repeat
pan testing found and fixed renderer-lifetime batch-cache retention. Arbitrary
over-budget jumps and hardware/device performance are not claimed instantaneous.

## Fixture and scope

`scripts/seed-intercity-road-preview.ts` requires `SEED_INTERCITY_PREVIEW=true`
and a loopback `tasktopia_test` base URL without a selected schema. It creates a
new random schema; it never wipes, reuses, or regenerates an existing country.
Only the new fixture's country seed is set to1 before any city exists. All
cities, sprints, tasks and progress transitions use the public AppService.

The final preserved fixture is
`intercity_road_preview_0eae6b22f0bf495f8905ed0c068f2586`:
6 real cities,6 original sprints,53 tasks,4 accepted roads,2 connected groups,
and7 explicit planner budget failures. Creation stopped after the sixth city
provided meaningful padding geometry. Audit returned zero violations. This
does **not** prove complete six-city connectivity.

The Gamma–Dzeta route is a real128-cell orthogonal path. Outside Gamma's
resident chunks, chunk(2,5) contains223 asphalt cells and175 surface cells.
The initial two-city route remains unchanged after35 additional tasks in
Alpha,12 in Beta, and the later city creation. At that browser checkpoint each
scene's asserted list was its incident canonical routes. The subsequent transit
continuity fix extends the list to canonical routes whose road width intersects
the resident chunk envelope (see the integration document and focused producer
regression); the next browser run must use this contract. COUNTRY either renders each accepted route by
the same ID or returns a route-specific unavailable reason.

## Road implementation

- CITY scene schema4 carries compressed `intercityRoads`.
- `CityRoadPadding` clips compressed runs before rasterization, unions resident
  neighbours, derives masks with a14-cell read-only profile halo, and uses the
  same4-cell surface scope and `buildRoadSurfaces` as the server. Authoritative
  resident surface halos take precedence. No geometry is inferred from a
  screenshot or extended beyond a canonical endpoint.
- Padding uses the existing LOCAL road, pavement, marking and crossing atlas
  and the budgeted ground bake queue. Cache entries and textures are pruned
  when their chunks leave the visible padding set.
- Resident mobility sees the server's union road graph. Camera-dependent
  padding is not added to simulation; no global offscreen trips are claimed.
- `groundRoadTopologyChanged === true` invalidates retained scenes throughout
  the same country. Ordinary unrelated task events still preserve their cache.

## Verified checkpoint

Production build, whole typecheck and scoped lint passed. Focused padding,
cache and invalidation tests passed16/16. Earlier surface/grid extraction
checks passed29/29. Evidence is in `docs/evidence/intercity-roads-20260907/`.

The completed v4 browser run passed in65.7s on Node24, production server,
Chromium desktop, with provider push disabled:

-60/60 sampled exterior cells matched the published LOCAL asphalt palette,
  before and after the camera-return action. Sampling inspects a3×3 pixel
  neighbourhood inside each tile because a lane marking may cover its centre.
- COUNTRY rendered all4 accepted routes:0 client rejections,7 explicit
  server-unavailable connections,17 dry corridor cells,36 fill rectangles,
  two existing atlas URLs,3px asphalt/5px paved envelope in the native raster.
  Road bake telemetry was1.00ms; country first frame170ms.
- Every one of six10-second windows advanced cars and walkers; cumulative
  car/car, pedestrian/pedestrian and mixed unsafe totals stayed zero.
- Warm PLANET→CITY return took328ms and retained the canvas, camera and agent
  session. Browser map GETs were exactly Alpha scene, Gamma scene, country
  overview and planet atlas; there were no viewport/chunk requests.
- Console, HTTP and request-failure error lists were empty.

`screenshots/intercity-roads-final/` contains `city.png`, `exit.png`,
`country.png`, and `planet.png`. The exit review frame is1600×1500 so the
actual distant bend is visible without loosening the city camera clamp.
COUNTRY was independently inspected: readable muted asphalt/pavement,
orthogonal corners, no visible road painting over water. Some endpoint details
are covered by city labels, so that screenshot is not a complete endpoint audit.

The later strengthened drag/prune replay compares actual numeric camera
movement and cache sizes. The current replay pans20 cells at2.315× and checks
32→12→32 padding chunks, rather than claiming a clamped minimum-scale action
proved movement.

## Terrain and natural-tree continuation

`CityTerrainPadding` captures the existing seeded terrain and a one-cell mask
halo once per chunk. `createTerrainView` is shared with resident ground, so
palette, masks, atlas families and native tile selection are identical. Capture
and texture baking run in the existing bounded queue; visible work precedes
the one-chunk prewarm ring. Stale jobs are fenced by provider/record identity.
Pruned textures are destroyed; shared atlas textures retain their asset lease.

The strengthened pixel oracle first reproduced a second defect: creating a
Pixi RenderTexture with its default linear sampler and then assigning nearest
did not update the already-uploaded sampler. `textureSourceOptions.scaleMode`
is now nearest at creation for both resident and padding ground. No atlas was
recoloured and no pixel acceptance threshold was lowered to hide the blur.

`CityTreePadding` reuses `generateWorldDecorations`, including its existing
seeded grove/species decisions. It publishes only natural tree records whose
origins are outside resident chunks. Known roads, pavements, task footprints,
features and planned sites remain exclusions. A two-cell semantic halo and
the original terrain sampler preserve boundary candidates. Trees use the
accepted prop atlas and world-baseline depth ordering, not a second random
algorithm. Padding adds no tasks, residents, animals, gameplay simulation, or
remote city fetch. Tree sprites and empty depth bands are destroyed on prune.

The production tree/material replay passed on the preserved six-city fixture
in17.85s. Exact source-atlas sampling, excluding known opaque props, measured:

| Zoom | Resident matching pixels | Padding matching pixels | Forest / mountain |
| --- | --- | --- | --- |
| 0.8 | 6,775 / 6,809 | 29,654 / 29,665 | >99.7% / 100% |
| 1.0 native | 10,545 / 10,584 | 32,535 / 32,544 | 100% / 100% |

Sampling spans16 chunks and993 native boundary cells. Small residual samples
include overlapping resident decorations; aggregate acceptance is not a claim
that every screen pixel must equal unobstructed ground. Natural tree IDs were
checked against the same generator, with no resident-origin duplicates or
road overlap. Cached trees changed11,691→4,959→11,691 alongside32→12→32
chunks. Queued tree generation peaked10ms and sprite creation1ms in this run;
the queue's4ms target is a soft deadline, not a hard per-job time guarantee.

Across435 sampled animation frames during resize, normal zoom/pan, zoom-out
and warm return, no visible chunk lacked its terrain texture. Warm return took
319ms, retained the canvas/camera/session, and used the same four map GETs as
the road checkpoint. This short rerun did not repeat the optional60s traffic
gate; the prior traffic result remains a separately dated checkpoint.

`screenshots/intercity-roads-final/native-terrain.png` shows exact1.0 zoom;
`exit.png` shows the larger0.8 view. The old material-seam screenshot is retained
under `docs/evidence/intercity-roads-20260907/material-seam-before/`.

## Exact browser command

```sh
PATH=/Users/kikasnikita/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH \
CI=true E2E_BASE_URL=http://127.0.0.1:5197 \
TEST_DATABASE_URL=postgres://tasktopia:tasktopia@127.0.0.1:5432/tasktopia_test \
E2E_DATABASE_URL='postgres://tasktopia:tasktopia@127.0.0.1:5432/tasktopia_test?options=-csearch_path%3Dintercity_road_preview_0eae6b22f0bf495f8905ed0c068f2586' \
E2E_WEB_COMMAND='NODE_ENV=production PORT=5197 SESSION_COOKIE_SECURE=false VAPID_SUBJECT= VAPID_PUBLIC_KEY= VAPID_PRIVATE_KEY= node dist/server.mjs' \
E2E_INTERCITY_ROADS_FIXTURE=true INTERCITY_TRAFFIC_SECONDS=60 \
npx playwright test tests/e2e/intercity-roads.spec.ts --project=chromium --reporter=json
```

The earlier road-only checkpoint WorldCanvas SHA256 was
`214d9b5ef9ce2ec826f93008f50029895b604f9133959c9a245d0e43b1e36d9c`.
`city-road-padding.ts` SHA256 is
`1549bcff6fe06e2a65d44375564479cf297324f830c2ede5459d62069c847f05`.

## Large-jump baseline and bounded first-visible fix

An extreme197.53-cell single-mouse-event jump on the1000-task/20-sprint
fixture at1600×2800 and0.81 zoom exposed four uncached padding chunks. Before
visible-job priority, the diagnostic saw22 missing animation frames; after
priority, an independent replay without simultaneous PNG capture saw8 missing
frames (342–785ms after input). This is a confirmed rare cache-miss window,
not a zero-flash pass. No unbounded synchronous bake, camera latch or hidden
teleport was added. The tree-inclusive replay completed in49.65s: the same
four missing chunks lasted8 frames (199–672ms, first clear sample687ms), while
the remaining tree/prewarm queue drained by4,684ms. These preserved baseline
observations motivated the later native first-visible path; they are not the
current acceptance result.

That replay also proved1000 original tasks,20 original districts and100 block
plaques. Cold browser entry took3,438ms. The fixture is mostly planning-stage;
20 assigned gallery-family tasks must not be described as20 completed gallery
buildings. Boundary toggle now waits for state and two actual animation frames,
checks20 real geometry groups/51,852 owned cells, and verifies5,750 changed
pixels matching district colours. `screenshots/city-padding-large-final/`
contains the full city, boundaries and a readable `native-district-edge.png`.
There were exactly one scene, one overview and one planet GET, and no browser
errors. Whole typecheck, scoped lint and20 focused padding/queue tests passed
at that checkpoint.

`planImmediatePadding` clips missing chunks to currently visible cells. The
same native terrain sprites provide a temporary view until the queued texture
bake replaces them. A one-cell mask halo and partial-capture cache reuse the
exact terrain samples; all10 CITY atlas families are leased before first ready.
Both new work per animation frame and retained temporary cells are capped at
8,192. Above that budget, work remains explicitly deferred to the normal queue;
there is no camera latch, input-handler render-target bake or flat replacement.

An isolated installed-Pixi prototype measured5,250 cells for the actual B miss,
not16,384 full-chunk cells. Ordinary-sprite CPU components at p95 summed to6.8ms
for that case and9.6ms at8,192 cells;16,384 cells cost21.2ms. These component
figures are not GPU completion times. The actual CITY run, including planning,
capture, construction and coverage bookkeeping, reported a14ms high-water.
The B replay observed73 animation frames with zero untextured frames,5,250 peak
temporary cells and zero retained temporary cells after baking. Atlas preload
took186ms and cold CITY3,357ms in that run; this is a single observation, not a
statistical startup-speed improvement claim.

A separate visual run performed one explicit WebGL readback immediately after
the real animation-frame draw while5,250 temporary cells were present. It
matched396/396 native source-atlas pixels across the four newly visible strips.
Neither the camera nor renderer was paused. This readback is excluded from the
timed run. Earlier locator/CDP screenshot attempts finished after the temporary
layer had already been replaced and are retained as failed capture attempts,
not labelled first-visible evidence. `native-jump-first-visible.png` is the
actual intermediate frame; its trees may still be awaiting normal queued work.

Explicit Retry now replaces only failed padding records and clears their failed
completion flags, preserving healthy views and fencing stale callbacks by
record identity. Unit regressions cover already-rendered failed terrain/tree/
road records. The browser Retry gate injects an atlas503 before first ready,
then permits it and clicks the real Retry control; this proves preload recovery,
not an injected post-ready GPU failure. No automatic retry loop was added.

## Retained resource regression

The first repeat-memory diagnostic kept the same32 chunks/11,691 trees but
retained79→97→114→132→149MB after forced GC. It passed its original functional
assertions, but clearly failed a plateau requirement; bounded object counts
alone had hidden this lifetime problem. Allocation sampling attributed18.3MB to
`generateTexture/addRenderable` and6.0MB to batch buffers across three cycles.
Installed Pixi keeps batchers indexed by root instruction-set identity for the
renderer lifetime. Destroying a disposable source root did not evict that map.

`GroundTextureBaker` uses one offscreen root per renderer, attaching each source
only for its bake and detaching/destroying it in `finally`, including failures.
The root is destroyed at teardown. It refuses sources attached to the live
world. No private Pixi state is modified. The installed-engine regression shows
the previous strategy growing1→12 instruction sets for12 bakes, while the new
strategy stays at1 with exact alternating-colour pixels and no stale children.

The identical production replay now retains51.93→52.12→52.17MB across three
restored cycles, a0.24MB spread against an explicit4MiB budget. Pruning reduces
retained heap to35.7–36.0MB; UI logout leaves18.1MB, no CITY canvas, zero padding
trees/chunks and a released shared asset lease. These are post-GC JS heap values,
not GPU-memory measurements. Native resident/padding pixel checks remained
unchanged and all normal navigation frames retained material coverage.

The separate1000-task B memory/grace journey also passed:119.20MB initial,
148.72MB with8,736 padding trees/30 chunks,153.46MB after full-map review/warm
return. Immediate logout left70.60MB despite zero owners and no CITY canvas.
This is not called complete source unloading: the shared asset registry has an
explicit30-second navigation grace. After waiting31 real seconds and collecting
again, retained heap was21.73MB, with no trees/chunks/canvas. The77.78s test
records both phases. No production cleanup policy was changed to force a better
number; the grace remains available for normal warm navigation.

Final verification after all test additions:23 focused tests in6 files, whole
typecheck and scoped ESLint passed. The production build used by the final
browser runs passed; no renderer source changed after it. See the new
`native-first-visible` and`retained-bake-cache` evidence subdirectories for
source hashes, original failing observations and current reports.

## Final same-city300s acceptance

The original stored scene is `compact_delivery_20260905_a`, city
`ec5d45dc-bcf5-43f7-91e4-cfd8ee7b9eef` (Riverside), not the older similarly
named dense-preview fixture. Its first attempted load correctly returned400
because the new canonical-road read model was absent. Explicitly authorized
local maintenance called `synchronizeCountryRoads` transactionally to publish
the missing empty road snapshot for this single-city country. Hashes/counts of
all37 other tables and the active-layout hash were identical before/after.
No task, sprint, marker, internal road, placement, history or business event was
rewritten. This initialization is recorded with the evidence, not hidden as an
unchanged database.

The complete production E2E passed in349.07s, including a300.008s uninterrupted
sample and subsequent task/district/atlas navigation. At1440×1000, DPR1,
scale1.05, NIGHT, there were14 cars/25 walkers, one mobility network build,
16 exterior chunks and1,184 padding trees. Both actor kinds moved in all30
ten-second windows, with209 completed trips and1,508 crossings. All cumulative
unsafe, wrong-way, off-path and pole-conflict counters stayed zero. Peak waits
were7.15s/12.95s; simulation p95/max across the sample were1.3/2.1ms.

RAF p50/p95/max were16.7/18.0/33.3ms, with zero long tasks. This meets the
declared25ms headless p95 budget, but is not a hardware60fps guarantee.
The backend was the same Chromium151 SwiftShader software renderer; no CPU
sampling profiler, trace screenshots, builds or bulk scans ran during sampling.
The historical duration-only report was26.8ms p95/150.7ms maximum/33 long tasks;
the later profiling baseline was25.1/42.5ms/zero long tasks. Current ambient
session seed611745692 differs from historical726896001, and the older profiled
run includes instrumentation overhead. Therefore the lower current frame tail
is a verified acceptance result, not a controlled single-change speedup claim.

`screenshots/native-padding-traffic-final/` contains current CITY, district,
COUNTRY and PLANET captures plus the full samples and compact`metrics.json`.
Unexpected console/HTTP/request errors were empty; recognized startup software
driver warnings and the anonymous401 remain explicitly recorded. The same
canvas and camera survived the atlas return.

## Current100-city overview fixture

The existing `release_perf_20260907_d` schema was used read-only, without a
new seed or fixture rewrite. Four production Chromium tests passed in12.86s:
desktop label-loading safety, desktop directory navigation, native mobile
directory scrolling, and actual CITY/COUNTRY/PLANET material round trips.
The real multi-city bootstrap opened COUNTRY; the test selected an actual
directory city before checking retained CITY navigation.

The overview contained100 cities and PLANET300 unique district glyphs.
COUNTRY drew91 canonical road projections. One further canonical route,
`intercity:01027f8bb95b2243e93b6fbd`, was explicitly unavailable with
`NO_ORDERED_CORRIDOR`; the other37 planner diagnostics were8 `NO_PATH` and
29 `TOTAL_BUDGET`. Neither a connected100-city country nor successful projection
of all92 canonical roads is claimed. Native COUNTRY raster576×352 retained
its bounded size; at the review scale a material patch was12.22 screen pixels
versus a17.72px block glyph. Warm direct CITY return took260ms with the same
camera/canvas/session and exactly one scene, one overview and one planet GET.
No browser error was recorded. Screenshots, including actual desktop/mobile
COUNTRY and PLANET, are in `screenshots/release-completion-country100/`;
the reporter is under `docs/evidence/city-terrain-padding-20260907/current-country100/`.

`INTERCITY_MEMORY=true` now opts the intercity test into CDP retained-JS-heap
samples after forced GC at full/pruned/restored padding and after UI logout.
It checks teardown removed the CITY canvas and released its shared asset lease.
The opt-in has now executed, including three repeated prune/restore cycles and
the plateau regression above. GC is outside the uninterrupted traffic window,
and JS heap values do not measure GPU allocation. The traffic window accepts
only0,60 or300 seconds; the memory replay used0. The final pacing comparison uses
the original40-task scene, not this six-city road fixture.

A visible remote road endpoint currently has no remote city's internal roads
or gameplay entities unless they happen to share normal resident chunks.
This is a bounded-scene limitation, not a continuously loaded global world.
No fake endpoint extension, remote scene fetch, bridge, or terrain reroll was
introduced. Planner budget/connectivity review remains separate.
