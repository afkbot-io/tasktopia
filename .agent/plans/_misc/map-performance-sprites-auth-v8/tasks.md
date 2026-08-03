# Implementation tasks

## P0 — reproducible baselines

- [ ] Add `scripts/map-performance-smoke.ts` with bounded detailed/overview/pan/zoom/route-cycle cases.
  - Verify: JSON artifact includes FPS, p95/max frame, long tasks, heap, requests, display objects, and resident chunks.
- [ ] Add renderer counters and a static scene-object estimate before changing behavior.
  - Verify: E2E can read stable debug attributes in development/test.
- [x] Add failing duplicate-registration and auth-error-state tests.
  - Verify: current implementation reproduces 500 before the fix.

## P0 — stop catastrophic rebuilds

- [ ] Extract long-lived `WorldViewport` and make React updates command/delta based.
- [ ] Coalesce wheel/pointer input into one transform RAF.
- [ ] Reconcile chunks only when the integer chunk range changes; debounce preload work after motion.
- [ ] Introduce versioned chunk LRU and bounded/abortable fetch queue.
- [ ] Split stable raw DTO cache (96–160 chunks) from detailed GPU cache (32–48 chunks); global world version must not invalidate all chunk keys.
- [ ] Add chunk containers and update only added/removed/changed chunks.
- [ ] Remove double invalidation from socket events.
  - Verify: 30-step drag triggers no full-scene rebuild and unchanged range triggers zero fetches.

## P0 — static batching and LOD

- [ ] Bake terrain/road/surface ground layers per chunk into RenderTexture sprites.
- [ ] Diff entity layers by id and disable event processing for static layers.
- [ ] Implement detail/city/country LOD and agent caps.
- [ ] Implement four LOD levels; country LOD renders cities as square clusters and preserves hidden simulation state.
- [ ] Add adaptive renderer resolution (default 1 at overview; maximum 2 only where justified).
- [ ] Dispose evicted RenderTextures and prove route-cycle stability.
  - Verify: all map acceptance budgets in `overview.md` pass.

## P1 — simulation and asset delivery

- [ ] Split car/walker arrays; precompute numeric graph adjacency; remove per-frame allocations.
- [ ] Fixed 30 Hz simulation, delta cap, offscreen/hidden pause.
- [ ] Pack terrain and building sprites into atlases; lazy-load construction stages.
- [ ] Preserve crosswalk yielding and walking collision tests.
  - Verify: no behavior regressions; FPS budget remains met with configured agent caps.

## P1 — canonical sprite pipeline

- [ ] Encode style/palette/alpha/anchor gates in the V4 asset builder.
- [ ] Redraw priority-A houses across five stages.
- [ ] Normalize priority-B buildings across five stages.
- [ ] Review priority-C additions and repair only failed properties.
- [ ] Generate canonical contact sheets and in-game district screenshots.
  - Verify: asset build fails on deliberate size/anchor/palette violations.

## P1 — believable building groups

- [ ] Add `BlockGroup` metadata and deterministic block-pattern planning.
- [ ] Implement all private and dense patterns from `housing-patterns.md`, including pedestrian mews and service-access invariants.
- [ ] Enforce immutable `primaryHousingArchetype`, explicit support quotas, and zero cross-type residential contamination.
- [ ] Fill reserved slots as tasks arrive; plan a new whole group before expansion.
- [ ] Keep support services/shops compatible without mixing primary housing types.
  - Verify: deterministic snapshots for 30/100/200 tasks and multiple seeds.

## P0 — authentication correctness

- [x] Precheck normalized email and map race-safe unique violations to 409.
- [ ] Introduce explicit client auth state machine and retryable error surface.
- [x] Await bootstrap before declaring authentication complete and expose retryable load errors.
- [ ] Configure environment-specific cookie name and production `__Host-` policy.
- [ ] Prune expired sessions and define an active-session cap/retention rule.
- [x] Add route and E2E coverage for register/login/session/logout, duplicate email, malformed input, invalid credentials, bootstrap failure, and retry.
  - Verify: duplicate registration is 409; all auth flows pass on localhost and production-like HTTPS config.

## P2 — finish

- [ ] Update README, deployment environment, graphics spec, QA, and changelog.
- [ ] Capture before/after performance JSON and matching screenshots.
- [ ] Remove legacy renderer flag only after parity and rollback window.
