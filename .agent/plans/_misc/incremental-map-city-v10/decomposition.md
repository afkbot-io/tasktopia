# Delivery slices

## Slice A — practical verification profiles

Make the default scale fixture one city/ten districts, preserve `:large` and soak commands as opt-in checks, and document cadence. Independent and safe to merge first.

## Slice B — persistent viewport and realtime contract

Keep Pixi alive, reconcile chunk containers incrementally, bound loading, and pass event bounds from `App` to the viewport. Depends only on existing event payloads.

## Slice C — LOD, simulation and server allocation reduction

Add overview representations, offscreen pause, stable agents and bounded chunk materialization. Builds on Slice B.

## Slice D — generator proof and finish

Add asphalt/block metrics, small-city scenarios, review findings, docs and final gates. Depends on A–C for final evidence.

All slices share the current worktree and are delivered together here; the boundaries are retained for review and rollback.
