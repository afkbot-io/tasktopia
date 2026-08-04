# Incremental map and practical city gate

## Goal

Make map interaction smooth by keeping one long-lived Pixi renderer, updating only changed chunks after realtime events, and keeping the default generator gate small enough for normal development.

## Scope

- Default fixture: one city with ten districts and a bounded task count.
- Large scale and multi-seed soak remain available as explicit opt-in commands.
- Persistent chunk cache and containers, bounded requests, LOD and paused offscreen simulation.
- WebSocket events invalidate only chunks intersecting `affectedBounds`; unknown/global events fall back to bootstrap refresh.
- Generator metrics cover asphalt share, road connectivity, block fill and zoning.
- Review code cleanliness, correctness, test coverage, README, QA and changelog.

## Non-goals

- Replacing PixiJS or the square-v7 terrain generator.
- Changing public MCP operations or stored task geometry.
- Removing large-load tests; they move out of the default gate.

## Acceptance criteria

1. Pan/zoom never clears all scene layers for an unchanged chunk range.
2. A task/status event reloads only intersecting resident chunks and preserves camera and agent state.
3. Chunk fetch concurrency is bounded and stale requests can be ignored/aborted.
4. Country/city overview uses an LOD that does not instantiate every detailed terrain and entity object.
5. Canvas simulation pauses while hidden/offscreen and resumes with a capped delta.
6. Default scale test uses one city and ten districts and stays within time/memory budgets.
7. Large 10-city and multi-seed soak commands are explicit opt-in checks.
8. Small-city audits report asphalt ratio and enforce the V9 residential road-density limit.
9. Typecheck, lint, unit, build, standard worldgen and focused browser checks pass.
10. README, QA and changelog describe the actual test split and renderer behavior.

## Current status

Implementation in progress on the existing dirty V9 worktree. Baseline: full renderer rebuilds on chunk loads, 9/10 soak seeds pass, 10-city scale exceeds the 768 MB RSS budget.

## Risks

- Chunk-local rendering must deduplicate entities spanning chunk boundaries.
- Realtime events without bounds need a safe full-refresh fallback.
- GPU resources must be disposed on eviction without destroying shared textures.
- LOD changes must preserve clicks, camera bounds and district visibility.

## Finish checklist

- [ ] Incremental renderer verified during bounded pan/zoom and realtime mutation.
- [ ] Default and opt-in test profiles documented and passing at their intended cadence.
- [ ] Generator asphalt/block metrics verified.
- [ ] Review findings resolved or explicitly accepted.
- [ ] README, QA and changelog finalized.
