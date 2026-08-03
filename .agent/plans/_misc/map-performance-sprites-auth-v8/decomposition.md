# Delivery decomposition

The work is split because renderer architecture, art replacement, placement behavior, and auth can be reviewed independently. The first three renderer slices are sequential; auth and sprite specification can proceed independently after baseline capture.

## Slice 1 — baselines and auth correctness

- Performance harness and debug counters.
- Duplicate-registration fix and complete auth tests/state handling.
- No renderer behavior change yet.
- Gate: reproducible failing-before/passing-after evidence.

## Slice 2 — camera and incremental chunk lifecycle

- Long-lived viewport, input coalescing, range-change reconciliation, LRU/fetch queue, socket delta handling.
- Legacy visual construction retained temporarily.
- Gate: no rebuild/fetch on unchanged-range drag; functional parity.

## Slice 3 — static chunk baking and LOD

- RenderTexture chunk ground, entity diffing, LOD, adaptive resolution, GPU disposal.
- Gate: FPS/frame/heap/display-object budgets.

## Slice 4 — simulation and atlases

- Numeric mobility graphs, fixed-step simulation, agent visibility, sprite atlases/lazy loading.
- Gate: mobility behavior and performance stability.

## Slice 5 — canonical housing assets

- Pipeline validators, priority-A redraw, priority-B normalization, construction-stage repair.
- Gate: contact sheet and in-game visual approval.

## Slice 6 — block-group generation

- New district metadata/patterns and dense/private placement.
- New districts only; existing stored lots remain compatible.
- Gate: multi-seed 30/100/200-task lifecycle tests.

## Slice 7 — release hardening

- Full regression, docs/deploy/changelog, before/after evidence, legacy renderer removal decision.

