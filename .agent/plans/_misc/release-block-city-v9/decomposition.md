# Delivery slices

## Slice A — contracts and pure planner

- Add backward-compatible block metadata to contracts.
- Implement deterministic block templates.
- Unit-test geometry, slot order, road density, and zoning purity.

## Slice B — service integration

- Use the block planner for new districts.
- Align buildings inside grouped slots.
- Fill existing groups before expansion.
- Replace per-task spine growth with whole-block growth.

Depends on Slice A.

## Slice C — small-city proof

- Generate multiple 1–3 district cities.
- Add tasks one by one through the public service path.
- Audit road connectivity, overlaps, access, density, and deterministic replay.
- Capture browser screenshots at close and region zoom.

Depends on Slice B.

## Slice D — release authentication and UI

- Remove development-phase copy.
- Refine entry screen and bootstrap error states.
- Verify registration/login/session/logout and readable failures.
- Update E2E selectors and screenshots without weakening assertions.

Independent after contracts are stable; ships after Slice C.

## Slice E — final gate

- Run unit, integration, E2E, world soak, typecheck, and build.
- Review diff for regressions, stale prototype wording, and documentation drift.
- Update release docs and evidence.

