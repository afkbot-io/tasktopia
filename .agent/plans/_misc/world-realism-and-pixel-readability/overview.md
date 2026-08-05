# World realism and pixel readability

Bring the generated world and Pixi renderer to release quality: crisp labels, readable task markers, no curb artifacts, deterministic but varied districts, coherent bridges and roads, limited unique infrastructure, correctly placed shoreline life, and sparse ambient wildlife.

## Success criteria

- Overview LOD renders buildings as cheap pixel blocks; detail LOD keeps authored sprites.
- Tooltips and task badges remain crisp at supported zoom levels.
- Curbs are absent from runtime rendering and generated asset references.
- District placement exposes at least ten deterministic layout variants without overlapping lots.
- Unique infrastructure obeys catalog quotas.
- Fishers are placed on shoreline terrain and away from roads.
- Every generated bridge has land-supported portals; road ends and junctions do not get curb artifacts.
- Rare animals and vehicles animate without materially increasing the initial chunk payload or render budget.

## Non-goals

- Replacing the terrain generator or persistence model.
- Fabricating project tasks merely to decorate the map.
- Loading the full country at startup.
