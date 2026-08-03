# Map performance, sprite cohesion, and authentication — V8

## Goal

Make the current square-grid MVP responsive during pan/zoom, bring all buildings into one deliberate pixel-art camera and palette, support realistic rows of dense and private housing, and make authentication failures deterministic and understandable.

## Scope

- Replace the current full-scene Pixi rebuild with persistent cached chunks and explicit LOD; ordinary camera motion must never redraw an existing block.
- Optimize camera input, chunk loading, static tile rendering, agent simulation, texture delivery, and renderer lifetime.
- Adopt the original five high-rises as the canonical building style and audit every other building against it.
- Redraw the private-house group and normalize the listed borderline buildings across all five construction stages.
- Add block/row placement so dense buildings can form runs of 3–5 and houses can form coherent streets.
- Fix duplicate registration, surface bootstrap/session errors, and add complete login/register/logout coverage.
- Keep the current country/city/district/task model and MCP contracts compatible.

## Non-goals

- No 3D renderer or camera-angle change.
- No AI at runtime for world or building placement.
- No complete world-generation rewrite.
- No multiplayer presence or real-time collaborative cursors.
- No replacement of the 8×8 logical grid.

## Evidence and current status

- Audit and strengthened system plan complete. The narrow authentication/Bad Request fix is implemented; renderer, sprite, and district-generation work has not started.
- At 1440×900 after zooming to 60 resident chunks: about 20 FPS, p95 frame time about 92 ms, repeated 0.5–0.6 s long tasks, and about 1.7 GB reported JS heap.
- The current scene can instantiate at least 60 × 64 × 64 = 245,760 terrain sprites before roads, surfaces, buildings, decorations, and agents.
- `loadVisible()` calls `render()` after every accepted load, while `render()` destroys and recreates all display objects.
- Pointer movement schedules `loadVisible()` every animation frame; wheel calls it immediately.
- A realtime event changes `bootstrap` and then `revision`, allowing two renderer teardowns for one update.
- Valid login and bootstrap return 200. A unique registration passes E2E. Invalid credentials return 401.
- Baseline defect: duplicate email registration returned 500 because Node SQLite reports `ERR_SQLITE_ERROR`. It now returns a clear 409 conflict and is covered by route and browser tests.

## Acceptance criteria

### Map

- At 1440×900, detailed-city view sustains at least 50 FPS and overview sustains at least 55 FPS on the audit machine after warm-up.
- p95 animation-frame time is at most 25 ms; no interaction long task exceeds 100 ms after the initial warm-up.
- Pan and zoom update the transform in the next animation frame and never synchronously rebuild the full scene.
- A 60-chunk overview uses at most 250 MB reported JS heap after warm-up and stays within +20 MB after 20 bounded pan/zoom cycles.
- Static world display-object count stays below 2,000 in detailed view and below 500 in overview.
- No more than one chunk-range reconciliation occurs for an unchanged range.
- Cars and walkers retain stable ids, routes, progress, direction, waiting time, and animation phase through pan, zoom, LOD changes, UI refreshes, and chunk-cache hits.
- Hidden/offscreen map animation and agent simulation stop and resume without a time-step jump.
- Camera bounds, building clicks, district toggle, agents, crosswalk yielding, and realtime task updates remain functional.

### Sprites and placement

- Every building uses the canonical camera, south-facing baseline, outline, palette budget, lighting direction, and nearest-neighbor export rules in `sprite-audit.md`.
- Every five-stage set preserves one footprint, anchor, massing, and final silhouette.
- All high-priority private-house sprites are redrawn and pass automated geometry/palette/alpha validation plus an in-game visual review.
- NEW_BUILD districts can reserve and fill coherent runs of 3–5 dense buildings with 0–1-cell side gaps and shared frontage.
- PRIVATE districts create coherent streets of houses with deterministic 1–3-cell spacing and no random dense building intrusion.
- Far country view keeps terrain, major water/roads, labels, and city/district square clusters only; detailed buildings and all agents are disabled without deleting their state.
- Entrances remain connected to a walkable surface, footprints do not overlap, and completed districts remain immutable.

### Authentication

- Valid registration, login, session restore, and logout pass in browser and route tests.
- Existing email registration returns 409 with a Russian user-facing message, not 500.
- Invalid credentials return 401; malformed inputs return 400; stale sessions return 401 without an infinite loading state.
- Auth/bootstrap network failures are visible in the UI and can be retried.
- Production cookies are secure and environment-specific; local and production names cannot accidentally collide.

## Risks

- RenderTexture caching can trade JS heap for GPU memory; both need explicit budgets and disposal tests.
- Chunk baking must preserve pixel-perfect nearest sampling and correct layer ordering.
- Building atlas repacking can shift anchors unless manifest validation is treated as a release gate.
- Compact block placement can break entrance paths unless shared frontage is modeled explicitly.
- Auth changes touch cookie behavior; local HTTP and production HTTPS must be verified separately.

## Finish checklist

- [ ] Baseline harness committed and repeatable.
- [ ] Incremental renderer and LOD meet budgets.
- [ ] Sprite style gate and replacement set complete.
- [ ] Dense/private block placement verified at 30, 100, and 200 tasks.
- [x] Local auth matrix passes route and browser tests; production-like secure-cookie verification remains part of rollout.
- [ ] Documentation, changelog, deployment examples, and screenshots updated.
