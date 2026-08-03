# References

## Current implementation

- `src/server/app-service.ts`
- `src/server/world/world-audit.ts`
- `src/shared/contracts.ts`
- `src/shared/catalog.ts`
- `src/client/components/WorldCanvas.tsx`
- `scripts/build-pixel-city-pack-v4.py`
- `assets/pixel-city-pack-v4/manifest.json`
- `assets/pixel-city-pack-v4/docs/GENERATION-SPEC.md`

## Evidence

- `screenshots/live-growth-20.png`
- `screenshots/live-growth-60.png`
- `screenshots/live-growth-100.png`
- `.agent/plans/_misc/city-mobility-and-100-task-live-test/findings.md`
- `.agent/plans/_misc/city-mobility-and-100-task-live-test/architecture.md`

## Decisions

- Runtime generation remains deterministic and algorithmic; no AI dependency.
- Exact pixel assets are authored procedurally because 8 px geometry and five-stage registration are hard constraints. Image generation remains concept/reference-only.
- Roadside features are world infrastructure; city buildings remain task-owned.
- District archetype is immutable after first task publication.

## Open questions resolved by default assumptions

- "Хотя бы в одном районе" interpreted as one civic/mixed service cluster per mature city when geometry permits.
- Large gas station may be reused as a task building and as a non-task roadside service-area feature.
- Bus stops are published in pairs where both road sides have valid safe pockets; otherwise one accessible stop is accepted.

