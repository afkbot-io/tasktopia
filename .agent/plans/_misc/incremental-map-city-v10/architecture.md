# Architecture

## Current boundary

`WorldCanvas` owns data loading, display construction, camera and simulation in one React effect. Any accepted chunk load calls a global `render()` that destroys every display object. `revision` recreates the Pixi application. Chunk endpoints materialize and filter country-wide DTO collections per request.

## Target boundary

- React mounts one `WorldViewport` lifecycle.
- A chunk record owns raw DTO, display container, version and last-used marker.
- Camera movement reconciles integer chunk ranges only.
- Added/changed chunks rebuild their own display record; unchanged records stay mounted.
- A lightweight global entity index deduplicates cross-chunk tasks/features.
- Event bounds map to chunk coordinates and invalidate only matching resident records.
- LOD selects detailed chunk content or compact city massing before object creation.
- Agent simulation uses stable arrays and pauses through visibility/intersection gates.

## Alternatives

- Full React remount on every event: rejected because it loses camera/GPU/simulation state.
- Full-country client state diff: deferred; bounded chunk invalidation gives most of the benefit without changing server contracts.
- RenderTexture baking for every layer immediately: useful later, but persistent chunk containers and LOD are the lower-risk first step.

## Rollout and rollback

The public DTO remains compatible. The renderer change is internal and can fall back to a full resident-chunk invalidation when an event has no trustworthy bounds.
