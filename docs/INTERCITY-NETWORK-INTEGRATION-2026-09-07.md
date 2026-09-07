# Intercity roads: storage and release contract

This is implementation evidence, not a production-release approval. Browser
acceptance and the final integrated release gates remain outstanding.

## Ownership

Country-owned `country_road_snapshots_v1` stores a revision, topology digest and
compressed, terrain-validated world routes. The digest includes the country
seed and each active city's road checksum, not task statuses or comments.
There is one primary-key lookup per country snapshot, no per-road-cell table.
The country mutation lock precedes the city advisory lock. Roads, placements,
events and projection invalidation commit or roll back together.

New roads connect actual developed block-perimeter nodes. Empty cities wait
for their first real block; their temporary starter street is not a permanent
exit. Accepted routes are append-only during growth. Candidate block interiors
and future city reserves cannot occupy their five-cell clearance corridors.
A road may become a shared perimeter, but never a building parcel. City deletion
removes its incident roads and reconnects surviving components where feasible;
surviving accepted routes stay fixed. MOVE/RUIN sites remain protected.

The bounded planner validates every corridor cell, including between its
eight-cell search nodes. Nearest-four plus geometric MST supplies candidates,
not guaranteed roads. Water, protected sites and exhausted budgets produce
explicit unavailability; there is no orthogonal/straight-line fallback. The
country limit is 100 cities, with bounded search/geometry/index budgets recorded
in the planner document. City creation beyond that cap returns a domain
capacity error before adding a city.

## Read models

CITY schema 4 includes whole compressed `intercityRoads` that are incident to the
city **or whose three-cell road width intersects its resident chunk envelope**.
The envelope is chunk-aligned, not just the smaller city bounds. This keeps a
transit B–C road visible across A's resident/padding seam without fetching B/C
entities. Unrelated distant routes are omitted. Selection is O(compressed runs),
with no new pathfinding, terrain sampling, per-cell expansion, or database read.
The schema shape and existing route IDs/geometry are unchanged. Resident roads are
rasterized from the union of all relevant city segments and country routes, so
join masks do not falsely terminate at an exit. The renderer derives only
visible padding surfaces from the same geometry; it does not fetch another city
or simulate global offscreen traffic. Existing neighboring entities in shared
resident chunks are not a new cross-country data source.

The transit selection regression was witnessed RED through the real
`AppService.getCityScene` producer (resident edge present but compressed route
missing), then GREEN through `CityRoadPadding` with continuous masks on both
sides. `tests/intercity-transit-scene.test.ts` uses an isolated database and a
specified durable snapshot; it tests read-model selection, not dry A* legality.
`tests/intercity-scene-roads.test.ts` separately covers negative coordinates,
full-width edge contact, bent runs, distant exclusion and billion-cell compressed
runs without expansion. This is not a new browser acceptance claim.

COUNTRY schema 7 exposes `groundRoads`, separately from completed-airport flight
connections. Macro nearest-land projection is discontinuous: the display model
therefore preserves accepted route identity and ordered projected anchors while
finding a bounded dry inherited-cell corridor. It is explicitly a cartographic
abstraction, not a metrically exact world polyline. Unprojectable endpoints or
disconnected macro land remain explicit failures. Painted width is clipped to
accepted dry cells; world geography is never changed to accommodate a line.

Ground topology events carry `groundRoadTopologyChanged` only when the country
snapshot was written in that transaction. This invalidates other cities' cached
scenes as well as the originating city. Ordinary unrelated task updates keep
warm scenes. The flag is derived with one indexed lookup for structural events;
status/comment mutations do not perform that lookup or route planning.

## Verification so far

- Planner: bounded search, old-route checks, negative coordinates, ordering,
  obstacles, thin water, separated clusters and validation-only audit.
- Store: persistence, unchanged-topology planner skip, append-only identity,
  transaction rollback, city removal and country isolation.
- Real seed 1: first two generated city sites are dry-connected. Their first
  blocks create one route, CITY and COUNTRY expose its same ID, 35 additional
  tasks preserve the route and original task address, fresh service reads agree,
  and `auditWorld` reports zero violations. Status change leaves the snapshot
  unchanged and does not emit the topology flag.
- Real seed 424242's first two sites produced `NO_PATH` within the declared
  search window during diagnosis. It was not used as a falsely connected fixture.
- Focused storage/planner/runtime/block tests: 23 passing; subsequent CITY and
  COUNTRY HTTP plus real runtime tests: 6 passing. Scoped lint/typecheck passed
  before final browser integration; these do not substitute for final full gates.

## Cutover and rollback

Migration 0029 only adds the derived snapshot table. Deploy all schema consumers
together; the standard country regeneration command deletes the old derived
road snapshot, rebuilds city layouts, then routes once at the end of the same
transaction. A failure restores both road and layout state. Business/task/history
records are not erased. The read-only world audit checks snapshot freshness,
actual endpoints, terrain/site safety and stored connected components without
discovering or persisting replacement roads.

Before reopening production, rerun the current full migration/regeneration and
matched database/application/static rollback rehearsal. Publish exact revision,
image and asset hashes only after all acceptance gates pass. No production
database or deployment has been changed for this work.
