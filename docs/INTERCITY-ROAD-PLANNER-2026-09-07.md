# Bounded canonical intercity road planner

Status: pure algorithm implemented and tested. It is **not yet an end-to-end game feature**. No HTTP/DB contract, renderer, world geography, city placement or production data changed in this slice.

## Ownership and input

`src/server/world/intercity-road-planner.ts` exports `planIntercityRoads`.
Input is the explicit country ID and world seed, each actual city's semantic road nodes and block rectangles, optional additional protected site rectangles, and previously accepted routes for this same country/seed. Empty cities may supply their actual starter-road nodes without blocks. The caller must supply all relevant country blocks and permanent construction/ruin sites, not only visible chunks.

Endpoints are supplied semantic nodes on the world 8-cell lattice. For nonempty cities each node must lie on a supplied block perimeter; city centers are never invented as endpoints. Nonempty block interiors begin three cells inside their perimeter: the existing three-cell road and its one-cell outside clearance remain usable, but construction land cannot be crossed. Extra protected sites are immutable closed rectangles.

The default terrain predicate calls the existing `terrainAt(seed, x, y)` and `isBuildableTerrain`. No water, wet sand, hill or mountain is overridden. Tests may inject a predicate; integration must use the canonical terrain owner.

## Search and failure contract

- Deterministic nearest-four city candidates plus a geometric Prim MST backbone (O(N²), at most N−1 extra pairs), ordered by distance and a seed-based tie break. The backbone connects candidate clusters; it is not itself a road. Every candidate still requires a proven dry A* path. Accepted connections form an append-only logical spanning forest, not a promise to bridge separate continents.
- Multi-source, heading-aware A* uses a small local heap. It does not call the existing `grid.ts` router, whose default orthogonal fallback is unsuitable here.
- Candidate edges advance eight world cells. Every intermediate unit cell is checked with the entire 5×5 safety envelope: three road cells plus one clearance cell on each side. Checking only coarse nodes would miss narrow rivers.
- Previously accepted route IDs, endpoints and compressed geometry are retained verbatim. They are revalidated against the current terrain and protected geometry. A new obstruction causes an explicit error; it never silently reroutes or relocates the accepted road. Integration must reserve accepted road corridors against future building placement.
- New route IDs hash country, seed, city/node identities and compressed geometry, without a mutable revision number.
- Output includes `routes`, actual sorted city-ID `components` (isolated cities included), `unreachable` diagnostics and work counters.
- `NO_ENDPOINT`, `NO_PATH`, `ROUTE_BUDGET`, and `TOTAL_BUDGET` are distinct. `NO_PATH` describes the declared finite search window and candidate endpoint subset, not a proof that the entire world has no route. Disconnected components have explicit failed candidate diagnostics; there is no straight-line or bridge fallback.

Default limits:

| Limit | Value |
| --- | ---: |
| Search window margin around endpoint bounds | 128 world cells |
| Endpoint candidates per city/pair | 64 |
| Expanded states per attempted route | 8,000 |
| Expanded states per invocation | 32,000 |
| Unique safety-cell samples per invocation | 1,000,000 |
| Retained plus newly accepted decoded geometry | 300,000 unit steps total |
| City inputs | 100 |
| Semantic node inputs | 100,000 total; coordinates have one owner |
| Protection and endpoint-validation bucket entries | 100,000 total, including duplicate rectangle entries |
| Retained accepted forest routes | At most N−1 |
| Candidate city pairs | At most 5N−1 |

Safety-cell and edge answers are cached only within the invocation. Protection and endpoint-validation indexes use 64-cell buckets. Candidate enumeration is quadratic in the capped city count (nearest-four selection additionally sorts up to 99 entries); retained-geometry validation is linear in the capped aggregate length. Endpoint ownership checks use spatial buckets rather than scanning every city block for every node. The function belongs on a bounded country-network mutation/rebuild path, not in per-chunk GETs or a render loop. API/storage integration must additionally validate untrusted payloads before they reach this internal owner.

## Verification

RED observed first for the absent planner module, then for disconnected nearest-four clusters, missing aggregate input caps, and duplicated cross-city node coordinates. GREEN command, Node 24.19.0:

```sh
PATH=/Users/kikasnikita/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npx vitest run tests/intercity-road-planner.test.ts --reporter=dot
```

Fifteen public-seam tests cover exact real endpoints, unit-contiguous compressed paths, full-width clearance, a one-cell river between coarse nodes, narrow dry corridors, permanent-site detours, append-only identity and replay, negative coordinates/input-order stability, visit/sample/geometry budgets, dry-cluster MST connectivity, distant-cluster budget failure, aggregate city/index limits, canonical seed geography and immutable input, duplicate endpoint ownership, and obstruction of an accepted road.

Single-process local diagnostic (not a p95 or service/browser claim), Node 24:

| Workload | Result | Elapsed | Expanded states | Unique safety cells |
| --- | --- | ---: | ---: | ---: |
| 100 cities on a 10×10 dry grid, 64-cell spacing | 99 routes, one component; 218 candidates | 78.57 ms | 1,881 | 146,189 |
| Two dry five-city clusters, second cluster offset 4096 cells | 9 routes, one component; 21 candidates | 55.81 ms | 1,587 | 122,584 |
| Two fixed city rectangles at x=0 and x=96, seed 424242, 2,000-state route cap | Explicit `ROUTE_BUDGET`; zero fabricated routes | 25.02 ms | 2,000 | 31,459 |
| Real seed 424242, two dry rectangles at (0,-64) and (32,-64) | One proven route | Not timed independently | 7 | 816 |

No DB workload, app build, browser, deployment or end-to-end intercity claim was performed by this slice. Root coordinates those gates after integration.

## Required next integration boundaries

1. Store one canonical country-level derived network (compressed world runs and checksums) under a country mutation lock. Do not persist duplicated raster tiles. Rebuild on meaningful topology changes, not status/comment updates.
2. Protect accepted corridors from later block placement. Clip the same world geometry into resident CITY scene/chunk bounds; do not simulate a remote city or expand resident bounds all the way to it. Normalize shared/crossing route runs into junctions before using them as a traffic graph.
3. Keep COUNTRY as an explicit cartographic read model of accepted route IDs, not an independent generator of city-to-city links. Current nearest-dry macro projection is discontinuous and cannot safely connect projected points with straight lines.
4. A bounded COUNTRY projector may preserve ordered macro anchors, remove repeated anchors, and resolve a four-connected corridor through inherited dry macro cells. Endpoints must use the exact city-miniature world-coordinate transform. If no such dry corridor exists, or endpoints lie in separate inherited land components, expose projection failure and draw no substitute road.
5. Bound macro search by the actual macro grid, cache by world-route geometry checksum plus macro/miniature projection revision, and test endpoint equality, source anchor order, river/unknown exclusion and reload/zoom stability. Do not change terrain families/IDs to force a path.

The COUNTRY proposal is feasible as cartographic generalization, not exact world-coordinate geometry. Miniature entry paths also need explicit ownership checks so a snapped macro route cannot cut through neighboring miniature buildings. None of this projection is implemented here.
