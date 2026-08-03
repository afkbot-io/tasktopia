# QA

## Preconditions

- Fresh deterministic v7 DB and built asset manifest.
- Desktop 1440×900; reduced-motion and mobile smoke retained.

## Positive scenarios

1. Generate straight, corner, T and X roads for widths 3/4; verify full corridor and reciprocal masks.
2. Inspect local-to-collector joins: no one-cell neck, internal curb or isolated sidewalk.
3. Verify crossings connect opposite sidewalks and walkers can traverse them.
4. Create strict NEW_BUILD and PRIVATE districts with conflicting task semantics; selected building massing remains compatible.
5. Generate every city morphology and verify distribution/adjacency quotas.
6. Seed big and small cities; verify one active, one planned, all other districts completed.
7. Open big city, zoom and pan; verify chunks, cars, walkers, modal and no black viewport edge.

## Negative scenarios

- Incompatible explicit buildingHint: reject without partial task/lot mutation.
- No compatible estimate variant: actionable error, no cross-zone fallback.
- Road corridor would hit committed footprint: reroute or fail transaction; never trim into a narrow lane.
- Planned district task status update beyond PLANNING is allowed by API later, but fixture invariant must fail its audit.

## Logs and audits

- road width/pinch/junction counters;
- surface and crosswalk connectivity;
- incompatible residential massing count per district;
- district status counts and task status consistency;
- generation time, memory, chunk count and console errors.

## Expected results

- Zero spatial, road geometry, zoning or lifecycle violations.
- Big city 200 tasks; at least three smaller cities with distinct profiles.
- Browser remains interactive and resident chunks remain bounded.

