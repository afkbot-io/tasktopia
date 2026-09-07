# COUNTRY road cartographic read model

Status: pure projection and subsequent static COUNTRY drawing adapter implemented. The adapter consumes the owner-provided v7 `groundRoads` contract; durable network/API verification and browser acceptance remain coordinated integration gates. This work adds no road relation and changes no macro terrain, world route, city geometry or asset.

## Decision and authority

`src/server/world/country-road-projection.ts` projects **only accepted** `IntercityRoadRoute` records. Their world runs, IDs and real semantic endpoints remain the connectivity authority. COUNTRY is an explicit cartographic abstraction of those roads, not a second road generator and not a world-metric affine projection.

`createCountryWorldProjection` currently uses nearest-dry PLANET macro selection. It can jump across a river. Connecting its results with a bare straight segment would therefore invent a bridge. Instead, the new owner:

1. Samples the accepted world runs at their eight-cell world lattice and every run endpoint, in source order.
2. Maps each sample with the supplied canonical projector; the returned macro ID must agree with the inherited country cell containing the result.
3. Verifies that exact miniature endpoints and **every sampled anchor** belong to one inherited dry four-connected component, before removing repeated anchors. Loop erasure cannot conceal an island excursion.
4. Deduplicates and loop-erases repeated country-cell anchors, retaining a subsequence in source traversal order. Within-cell offsets are detail omitted by this LOD; macro/country-cell identity is retained.
5. Finds bounded four-neighbor dry corridors between successive retained anchors. Already-used cells and later mandatory anchors cannot be crossed prematurely. This preserves source anchor order without a displayed loop or immediate reversal.
6. Uses shared cell-edge midpoint ports and orthogonal in-cell connectors. This avoids going backwards from a miniature endpoint to a cell center before exiting. Collinear forward segments are compressed.

The algorithm never clamps a failed endpoint to land, creates a straight-line fallback, changes terrain families, or changes world coordinates. Inherited foreign dry context stays land; it is not replaced with synthetic water.

## Exact endpoint contract

The formula is copied from the actual `CountryOverviewCanvas` miniature drawing and `projectCountryCityMiniature`, not a guessed bounding-box center:

```text
x = atlasCenter.x − miniature.columns × 0.72 / 2
    + (worldEndpoint.x − sourceBounds.minX) / 8 × 0.72
y = atlasCenter.y − miniature.rows × 0.72 / 2
    + (worldEndpoint.y − sourceBounds.minY) / 8 × 0.72
```

`countryRoadMiniaturePoint` exports this calculation. A source endpoint must be inside that city's inclusive source bounds. The miniature must have `cellSize: 8`, finite positive rows/columns and a finite center. An endpoint outside inherited dry geography is rejected, not snapped or cropped.

## Interface and failures

`projectCountryRoads({ routes, geography, projectWorldPoint, cities, limits? })` returns:

- `routes`: `routeId`, unchanged city/node identities, orthogonal display `points`, ordered loop-free `cellIds`, and retained `anchorCellIds`.
- `failures`: the original route/city identities and an explicit reason. No partially projected route is emitted.
- `metrics`: input grid/dry cells, inspected source runs, admitted world steps, unique projection calls, expanded search states, output points and corridor cells.

Failure reasons: `MISSING_CITY`, `INVALID_CITY`, `INVALID_GEOMETRY`, `ENDPOINT_OUTSIDE_CITY`, `ENDPOINT_OFF_LAND`, `UNPROJECTABLE_ANCHOR`, `DISCONNECTED_LAND`, `NO_ORDERED_CORRIDOR`, `COLLAPSED_ENDPOINTS`, `ROUTE_BUDGET`, `TOTAL_BUDGET`.

`NO_ORDERED_CORRIDOR` is a failure of this bounded sequential construction, not proof that every possible ordered path is impossible. The function does not backtrack and enumerate exponentially many earlier-leg alternatives. Separate inherited land components always fail, even if the more detailed world route was valid on its own geography.

Malformed global grid/input identity and invalid limit configuration throw before search. Valid per-route projection failures remain data so another accepted route can still be projected.

## Bounds, cost and cache determinants

| Bound | Default / hard maximum |
| --- | ---: |
| Cities / accepted source routes | 100 each |
| Country grid | 4,096 cells maximum; current real grid 36×22 = 792 |
| Admitted world steps | 300,000 total |
| Inspected source runs, including rejected roads | At most the world-step budget total |
| Unique canonical projection calls | 40,000 total |
| Expanded states per corridor leg | 4,096 |
| Expanded states per invocation | 100,000 |
| Emitted display points | 50,000 total |
| Emitted corridor cells | 50,000 total |

Dry adjacency/components are prepared once. Projection memoization exists only inside the invocation. Visited-prefix and future-anchor membership sets are reused rather than copied for every leg. Memory is bounded by the input grid, projection budget, per-leg grid search and capped output; no world raster or distant CITY simulation is allocated.

Future snapshot caching must include `COUNTRY_ROAD_PROJECTION_VERSION` (currently 1), accepted world-route geometry/identity checksum, inherited macro/country cell geometry and terrain revision, canonical world projector inputs, exact city atlas centers/source bounds/miniature dimensions, and relevant limits. A task comment does not affect this geometry; a changed block/city extent can.

Single-process local diagnostic, Node 24.19.0, one accepted 304-world-cell road and the actual canonical projector. These are single observations (including cold/JIT effects), **not** a p95, service or browser claim:

| Geography | Result | Elapsed | Unique projected samples | Expanded states | Output cells / points |
| --- | --- | ---: | ---: | ---: | ---: |
| Three dry macro cells | One route | 5.83 ms | 39 | 41 | 24 / 4 |
| River with a lower inherited dry detour | One route | 1.33 ms | 39 | 422 | 33 / 6 |
| Two islands separated by macro river | `DISCONNECTED_LAND`, no route | 0.49 ms | 0 | 0 | 0 / 0 |

## Verification and remaining integration

RED was observed for the absent module and missing aggregate source-run inspection budget. The public tests use the actual country geography builder and world projector. Coverage includes exact asymmetric and same-cell endpoints, water detour, disconnected islands/unknown terrain, no endpoint clamping, missing projection, permuted input order, loop simplification, sample/search/output/source-run limits, finite geometry and input immutability. Segment sampling independently checks that display lines remain inside inherited dry cells; retained anchor order is checked against the returned corridor.

```sh
PATH=/Users/kikasnikita/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npx vitest run tests/country-road-projection.test.ts tests/country-canonical-projection.test.ts tests/country-geography.test.ts tests/intercity-road-planner.test.ts --reporter=dot
PATH=/Users/kikasnikita/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npx eslint src/server/world/country-road-projection.ts tests/country-road-projection.test.ts
```

The pure owner proves centerline geometry. The drawing adapter below clips the actual painted stroke. City miniature glyph overlap, final material scale, schema rollout, snapshot invalidation, payload size, actual country performance and cross-level screenshots still require coordinated integration acceptance. No global app build, browser, DB or production mutation is performed by this slice.

## Static COUNTRY drawing adapter

`src/client/country-road-render.ts` builds integer raster rectangles and paints them on the existing `CountryOverviewCanvas` static canvas before city miniatures. It does not allocate another full-country layer or do road work in animation/camera frames.

- Asphalt is three intrinsic raster pixels wide; pavement is five, on the existing four-pixels-per-atlas-unit raster. Both use square pixel caps/joins, not antialiased canvas strokes.
- Materials come from the same `roadAtlasTile` LOCAL mask 15 and `roadAtlasSurfaceTile` PAVEMENT mask 15 as CITY. Two temporary 8×8 tile canvases become seamless repeat patterns with a shared global phase. The extra source storage is 128 pixels, not another map raster.
- Only `atlas/road-v2/road.png` and `surface.png` are added to the existing parallel asset preload, through `gameAssetUrl`. Empty/rejected networks request neither atlas. There is no extra map HTTP request.
- Every route is clipped to its own validated dry corridor rectangles. The adapter rejects a whole malformed path (nonfinite/diagonal points, water/unknown or absent centerline corridor cells) rather than displaying gaps or treating an invalid terrain code as grass.
- All pavement passes happen before all asphalt passes. A later road cannot overwrite another road's junction with pavement.
- The raster plan caps input at 100 routes, 50,000 points and 50,000 corridor indices on a maximum 4,096-cell geography. It never changes the source points or corridor geometry.

Five independent helper tests verify native rectangle thickness, integer coordinates, exact pixel clipping at a water boundary, asphalt continuity at crossings, material atlas/mask selection, rejection of unsafe paths, unchanged inputs and empty-network no-op. The test recorder exercises real helper draw commands; it does not patch browser/Canvas prototypes.

Telemetry on `.country-overview`:

| Attribute suffix after `data-country-ground-` | Meaning |
| --- | --- |
| `roads` | Rendered accepted path count |
| `road-revision` | Server ground-road snapshot revision |
| `road-unavailable` | Server projection/planning diagnostic count |
| `road-rejected` | Client malformed-path count; expected 0 |
| `road-corridor-cells` | Unique clipped dry cells across rendered paths |
| `road-rectangles` | Fill rectangle count, both material passes; excludes clip rectangles |
| `road-atlas-urls` | Additional shared material URL count: 0 or 2 |
| `road-asphalt-pixels` / `road-pavement-pixels` | Intrinsic raster thickness: 3 / 5 |
| `road-bake-ms` | One-time material preparation and painting duration, excluding terrain/asset loading |

The two-city fixture/browser spec belongs to the coordinated integration owner. No screenshot acceptance is claimed from the pure pixel recorder.
