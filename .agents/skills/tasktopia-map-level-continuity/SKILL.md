---
name: tasktopia-map-level-continuity
description: Preserve Tasktopia geography and camera continuity across PLANET, COUNTRY, and CITY. Use when changing atlas topology, terrain projection, city footprints, fog, zoom thresholds, map transitions, or any API that feeds more than one map level.
---

# Tasktopia map-level continuity

Treat PLANET, COUNTRY, and CITY as three projections of one world, never as independently generated maps.

## Required invariants

- PLANET owns the stable macro-cell identity and terrain family.
- COUNTRY expands the selected country plus its visible neighbouring macro cells. Do not synthesize water merely because a cell belongs to another country.
- CITY keeps logical simulation coordinates independent of pixels and presents one cell as `8x8 px`; interior `4x4 px` lawn/water substrates do not change that simulation scale. Every macro landmark affecting its territory keeps its terrain family and relative position.
- COUNTRY v7 projects one current block as one compact house icon; PLANET v4 projects one district as one icon. Their canonical centers and extents govern composition, not a second independently generated city or the retired occupancy-code raster. A house must not be stretched to fill a district silhouette. COUNTRY4×4 and PLANET2×2 material patches abstract the same geographic cells; they never change ownership or macro identity.
- Terrain seeds add detail inside an inherited family; they may not move a mountain, river, coast, forest, or neighbouring landmass to another macro region.
- Ground roads come from the server's canonical intercity network. COUNTRY projects its route IDs through validated dry corridors; CITY v4 renders the incident approaches/exits from those same routes. Flight connections remain separate. A missing endpoint, exhausted route budget or failed dry projection is an explicit unavailable route, never permission to fabricate a straight line through water. GET consumers must not run a new planner.

## Camera contract

- City-scene data covers the full city bounds. A `160x100` frame defines initial composition, not the response extent. The latest user camera contract fixes CITY zoom at `0.8..4` regardless of city size. Panning still clamps to the resident chunk-aligned city. If that raster is smaller than the viewport, render visible padding through the same seeded terrain/atlas material path, with bounded natural-tree continuation and only canonical incident roads. Do not fetch remote-city entities or use flat substitute materials. Check padding leases, depth ordering, pruning and disposal on zoom/resize, retry and teardown; test transient as well as settled black-edge absence. Do not restore a size-dependent zoom floor.
- One city-scene request contains every chunk intersecting the city bounds. Panning must not fall back to `/api/world/viewport` or `/api/chunks/*`.
- A further outward wheel step at a level's minimum zoom transitions immediately to its parent level.
- On CITY -> COUNTRY, focus the selected city's projected center and start close enough that outward movement visibly continues.
- On COUNTRY -> PLANET, focus the selected country's planet cells and start close enough that outward movement visibly continues.
- On parent -> child, preserve the cursor/focus point and start from the corresponding selected territory.
- CITY v4 airport connections use completed task-linked slot centers shared with COUNTRY/PLANET. A remote airport endpoint does not authorize fetching or rendering its entire city.
- Persist camera state in the map owner, not only inside a canvas that is destroyed during a level transition.

## Change workflow

1. Identify the canonical macro-cell IDs and the projection used at every affected level.
2. Separate data/navigation bounds from initial camera framing.
3. Keep projection deterministic under cache refresh, reload, and realtime invalidation.
4. Update DTO schema versions when topology or projection fields change.
5. Run the checks in `../tasktopia-map-visual-verifier/SKILL.md` before accepting the change.

Reject a change if any level regenerates geography independently, a transition resets to a generic center/full-world camera, or a detailed city can expose unloaded blank space.
