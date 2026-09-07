# Unified compact-city mobility

Status: implemented and verified locally on 2026-09-05, not released. Extends the
user's compact city request in `codex/task-14-block-runtime-integration`; no
production changes or new business tasks. Prior uncommitted city/art work is
preserved.

## Reproduced causes

The former WorldCanvas ticker independently applied car collision rules, mutable
signal reservations, crosswalk checks and unconstrained walker updates. A walker
could enter an occupied road or start a conversation on a crossing. Cars inherited
the retired bus stop-clearance envelope. An incomplete path through a junction
could be admitted without a known free exit. Existing diagnostics measured only
car/car overlaps before movement, not car/person conflicts after commit.

A five-minute replay of the exact 40-task preview exposed a defect in the first
controller revision that the synthetic street grid and a short browser run did
not: broad paved walking areas glued two independent crossings into one 131-cell
exclusive reservation. This intermediate baseline peaked at 65.9 seconds of
vehicle waiting and 111.4 seconds for a
person, with six original agents making no progress in the final minute. This
is a regression fixture, not an accepted result. A fix must preserve protected
access points through the complete navigation compilation, not merely improve
traffic by silently dropping destinations or reducing the population.

## Decision and boundaries

A pure `city-mobility` controller owns both cars and pedestrians, with a fixed
simulation quantum, deterministic seed, safe spawning and one reservation
authority. WorldCanvas owns only network input, lifecycle, sprites and diagnostic
presentation. Reusing the old ticker's separate yield checks was rejected because
their mutually inconsistent snapshots caused the defects. Creating a server-side
traffic simulation is unnecessary: ambient motion is visual, not durable domain
state. HTTP/DB contracts and task status/placement remain unchanged.

Cars follow right-hand lane connectivity. Conflict zones include intersections
and painted crossings; admission requires a complete maneuver and free exit.
Older waiting requests receive fair service when the exit can drain. No stalled
car is teleported or deleted as a congestion workaround. Short queues at a signal
are normal; the acceptance target is no permanent lockup under the tested load,
not an impossible promise that every car always moves.

Pedestrians use reachable paths, wait at the curb, finish a granted crossing
without stopping and rest only off the road. Slight right-side footway
offsets let two tiny people pass on a one-cell path. The controller's continuous
position, heading and signal state are authoritative for both rendering and
collision checks. Stopped agents retain heading. Animal roaming and airport
flights stay in their existing independent land/air layers.

Current authored people keep a 3×4 opaque box at [2,2,5,6] on an 8×8 canvas in
all four directions. The simulation reads both bounds and anchor from the
manifest; east/west poses do not rotate that box. Walking lanes have a quarter-cell
right-side offset. Exact touching is not overlap, with one shared numeric epsilon.
Routes search cell-plus-incoming-heading states to forbid hidden A→B→A U-turns.
Unavoidable blind walking spurs are not used for ambient spawning; accessible
cyclic footways and crossings remain active. No teleport or timed despawn is used
to make a stuck participant disappear.

Wide paved areas compile to deterministic narrow walking routes. The compiler
removes only redundant cells with an alternate local four-connected path,
preserving original cyclic route membership for protected access points. It
never changes visible paving, cuts a connector, removes a painted crossing or
reduces the configured population. Both intermediate routes and the final
trimmed network are tested: the exact fixture retains all 114 previously
eligible activity points and all 93 eligible crossing cells. Its largest
conflict zone shrinks from 131 to 13 cells. Geometry compilation is a scene-change
operation, not frame work. Frame-step budgets below do not conflate route
compilation, simulation and GPU rendering.

An exit is identified by its occurrence in the route, not by searching for the
first equal coordinate. A loop can return to its entry cell on the opposite
walking lane; admission must test the outgoing lane and its complete body. A
regression protects this case without weakening occupied-exit or swept-body
checks. Network suffix changes keep the current movement segment fixed, and an
actually removed or reversed directed edge retires its affected actor explicitly.

Rendered WATER/BASIN from task lakes and AREA features overrides the underlying
terrain for walking/animal passability. Signal posts are placed on known dry,
unoccupied ground outside roads and the entire footway graph. The bounded search
stays within two cells of its assigned corner; if no safe support exists, the
physical post is omitted, not put onto a pedestrian lane. Logical right of way
still belongs to the same controller. Static post cells are excluded from animal
roaming too. The helper never cuts a sidewalk to make room for its decoration.
Post directions come from actual directed car edges entering each conflict zone:
two approaches on a straight crossing, three at a T and four at an X. Bounding-box
corners without an incoming lane do not receive dummy lights. The exact fixture's
candidate post count fell from 214 to 117 without changing movement geometry.

## Ordered implementation and acceptance

1. Public controller tests prove red for unsafe crossing, incomplete/blocked
   exit, invalid spawn and starvation. Implement one synchronized controller;
   compare identical seeds with regular and irregular frame deltas.
2. Replace WorldCanvas vehicle/walker orchestration. Preserve agent identity
   on unchanged scene reconciliation and pause the world offscreen. Delete
   superseded traffic exports and bus-specific physics only after caller audit.
3. Audit all micro sprites and authored heading mapping. Fix the identified
   person-direction registration problem through authored art and strengthened
   asset checks, not runtime distortion.
4. Verify long deterministic simulation runs on T/X crossings, narrow paths,
   blocked exits and the actual compact city. Check pairwise physical clearance,
   legal road/path positions, progress for every eligible agent and bounded queues.
5. Production-browser QA samples actual motion for at least 120 seconds, checks
   errors/requests and captures CITY, two district focuses, COUNTRY and PLANET.
   Repeat retained-renderer transitions and reduced-motion behavior.
6. Full unit/integration tests, lint, TypeScript, production build, asset audits,
   independent review and updated documentation precede handoff.

## Performance workload and stop conditions

Use the isolated 40-task/three-district preview and pure fixed-seed traffic tests.
Declare population limits explicitly; target <=5ms p95 controller step for
48 cars + 64 walkers on a bounded synthetic multi-block network, after warm-up.
Browser acceptance requires no increasing agent/sprite population across map
cycles and no extra city-scene request for unchanged warm return. Measure actual
results; a passing unit suite does not substitute for screenshots or browser motion.

The independent oracle in `tests/city-mobility-safety.test.ts` reads opaque
sprite bounds and anchors directly from the authored manifest, independently of
the controller's collision counters. The exact-city fixture contains 1,587 road
cells, 1,666 painted walking cells, 115 crossing cells and 122 activity coordinates;
it contains no task names, task IDs or account data. Keep all 13 cars and 23 people
alive for 6,000 fixed steps (300 simulated seconds), and require each original
participant to advance in every 60-second window, for each of three seeds. In
addition, three seeds each
exercise 48 cars and 64 people for 120 simulated seconds on five mixed blocks.

Evidence lives in `screenshots/city-mobility-final/`: the source-hashed
`simulation-metrics.json`, all browser observations in `mobility-samples.json`,
the browser summary in `metrics.json` and actual CITY/district/COUNTRY/PLANET PNGs.
These files are only final after the source freeze and fresh verification;
earlier passing captures do not override a subsequently reproduced defect.

Stop and diagnose if any agent overlaps a vehicle, leaves navigable land, remains
stuck with a free exit or if the controller exceeds its budget. Production rollout
is separate; reverting the scoped movement changes restores the preceding local
implementation without a data migration. Do not restore removed legacy assets.

## Final local verification

- Full Vitest: **110 files / 574 tests passed**, no failures or skipped tests.
  Fresh report: `/tmp/task14-mobility-vitest-final.json`.
- Independent native-body oracle: **8/8 passed**. Three exact-city seeds each
  ran for 300 simulated seconds; all original 36 participants progressed in
  every 60-second window, with no overlaps, lost IDs or stuck agents. Maximum
  wait across these runs was 11.95 seconds; fixed-step p95 was at most 0.197 ms.
  All 1,190 protected eligible walking cells and 114 activity accesses remained.
- Three dense synthetic seeds each ran 48 cars and 64 people for 120 simulated
  seconds. No body overlaps or stuck cars; maximum wait 18.4 seconds and p95
  at most 1.292 ms, below the declared 5 ms budget. Native geometry and original
  participant counts were not relaxed to obtain a passing result.
- Production Chromium: **9/9** mobility, compact-city and map-streaming tests
  passed on the final build. The mobility run sampled 120.11 seconds, 13 cars
  and 23 people: 73 completed trips, 531 completed road-zone passages, positive
  movement for both kinds in all 12 ten-second windows. All three current and
  accumulated physical-conflict counters, wrong-way/off-path/road-rest counters
  and physical-post path conflicts stayed zero. Peak car/person waits were
  7.35 / 9.3 seconds. Step p95 1.0 ms, maximum 2.6 ms; frame p95 25.3 ms on the
  headless SwiftShader renderer, with no observed long tasks. These are local
  workload measurements, not a hardware-independent frame-rate guarantee.
- COUNTRY/PLANET return preserved the same CITY canvas, geography and simulation
  session, with one network compilation. The additional map regressions cover
  atomic first frame, delayed/error recovery, task links/clicks, reduced motion
  and repeated retained-renderer navigation.
- A separate multi-city preview passed **6/6** country-overview scenarios on
  the same production build: city navigation, semantic overview, atlas return,
  actual airport routes and bounded renderer reuse. Together with the nine
  CITY/map scenarios above, the final browser suite is **15/15**. The additional
  [ten-city COUNTRY](../screenshots/city-mobility-final/country-multicity.png) and
  [PLANET](../screenshots/city-mobility-final/planet-multicity.png) captures belong
  to that separate test world, not to the single-city Riverside fixture.
- No page exceptions, unexpected console issues, missing resources or failed
  requests. The report retains the expected anonymous-session 401 and four
  exact SwiftShader startup `GPU stall due to ReadPixels` diagnostics. A native
  readback observer recorded zero application `readPixels` calls; all other
  WebGL/Pixi issues remain test failures. No production console suppression or
  rendering workaround was introduced.
- TypeScript, ESLint, production build, `assets:verify` and `git diff --check`
  passed. All 220 runtime PNGs / 105 props / 36 micro sprites are registered,
  with no missing/orphan assets or pixel-style violations. People source
  revision 2 preserves a 3×4 body and one registration across all eight authored
  variant/direction images; the other 28 micro sprites remain unchanged.
- Independent review verified protected connectivity on 200 additional small
  graphs, stable in-flight segments after scene updates, directed-edge removal,
  loop-exit occurrence and unchanged body-clearance rules. Final presentation
  review removed dummy lights; direct tests cover H/V crossings and T/X nodes.
  Obsolete traffic callers/exports were audited; the removed legacy controller
  remains recoverable from Git, not reachable as a runtime fallback.
- RepoWise fast code index refreshed: 407 files / 1,646 symbols. No push, merge
  request, production database write or deployment was performed.

Frozen movement sources:

- `city-mobility.ts`: `207bfff5ae6db2a45392d7e56f7f7c1fabf3aac45185499ba4b6201bb289ff86`.
- `city-mobility-network.ts`: `b1e5f80a582a29c17ad9270fe6cb501f49182d04205c398b8953f9018de0b743`.
- Production CITY bundle: `WorldCanvas-BYTDldyy.js`; art revision: `d816b85d52906ab0`.

Reviewed actual application captures (one 40-task, three-district test world):
[CITY](../screenshots/city-mobility-final/city.png),
[district 1](../screenshots/city-mobility-final/district-Квартальный-район-1.png),
[district 2](../screenshots/city-mobility-final/district-Квартальный-район-2.png),
[COUNTRY](../screenshots/city-mobility-final/country.png),
[PLANET](../screenshots/city-mobility-final/planet.png).

For manual retest, use an isolated preview schema and the existing demo account:
watch an opposing-lane turn and a painted crossing; verify waiting at the curb,
rest only off-road and no fence/water shortcuts. Open a building by click and
task link, focus both districts, visit COUNTRY and PLANET, then return to CITY.
The city must continue with the same participants and geometry. The dedicated
`city-mobility.spec.ts` defaults to a 120-second sample; shorter explicit
diagnostic overrides are not the final acceptance gate. Do not reseed or erase
production data to reproduce this visual-only change.
