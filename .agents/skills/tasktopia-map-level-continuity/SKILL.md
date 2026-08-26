---
name: tasktopia-map-level-continuity
description: Preserve Tasktopia geography and camera continuity across PLANET, COUNTRY, and CITY. Use when changing atlas topology, terrain projection, city footprints, fog, zoom thresholds, map transitions, or any API that feeds more than one map level.
---

# Tasktopia map-level continuity

Treat PLANET, COUNTRY, and CITY as three projections of one world, never as independently generated maps.

## Required invariants

- PLANET owns the stable macro-cell identity and terrain family.
- COUNTRY expands the selected country plus its visible neighbouring macro cells. Do not synthesize water merely because a cell belongs to another country.
- CITY keeps the square `8x8 px` simulation grid, but every macro landmark affecting its territory keeps its terrain family and relative position.
- A city's country silhouette is derived deterministically from its current city/district bounds. It must change when those bounds change and must not be a generic square marker.
- Terrain seeds add detail inside an inherited family; they may not move a mountain, river, coast, forest, or neighbouring landmass to another macro region.
- Country maps do not draw synthetic roads between cities. Show city silhouettes and their own internal detail only.

## Camera contract

- City navigation bounds are the full city bounds. A `160x100` frame may define the initial composition only; it must never clip the scene response or clamp panning.
- One city-scene request contains every chunk intersecting the city bounds. Panning must not fall back to `/api/world/viewport` or `/api/chunks/*`.
- A further outward wheel step at a level's minimum zoom transitions immediately to its parent level.
- On CITY -> COUNTRY, focus the selected city's projected center and start close enough that outward movement visibly continues.
- On COUNTRY -> PLANET, focus the selected country's planet cells and start close enough that outward movement visibly continues.
- On parent -> child, preserve the cursor/focus point and start from the corresponding selected territory.
- Persist camera state in the map owner, not only inside a canvas that is destroyed during a level transition.

## Change workflow

1. Identify the canonical macro-cell IDs and the projection used at every affected level.
2. Separate data/navigation bounds from initial camera framing.
3. Keep projection deterministic under cache refresh, reload, and realtime invalidation.
4. Update DTO schema versions when topology or projection fields change.
5. Run the checks in `../tasktopia-map-visual-verifier/SKILL.md` before accepting the change.

Reject a change if any level regenerates geography independently, a transition resets to a generic center/full-world camera, or a detailed city can expose unloaded blank space.
