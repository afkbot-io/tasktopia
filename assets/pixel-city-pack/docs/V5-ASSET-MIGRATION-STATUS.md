# Tasktopia V5 asset migration status

Updated: 2026-08-14

This file is the release checklist for the frontal-top V5 art migration. A
catalog entry is complete only when stages 3–5 have authored sources, immutable
SHA-256 digests, a geometry contract, a passing verifier report, native-grid
previews, and no legacy or procedural fallback.

## Current inventory

| Scope | Catalog families | Geometry studies | Passing studies | Remaining |
| --- | ---: | ---: | ---: | ---: |
| All buildings | 193 | 122 | 87 | 106 |
| Existing V5 studies | 122 | 122 | 87 | 35 |
| Missing V5 studies | 71 | 0 | 0 | 71 |

The current full verifier batch found 87 passing catalog families. All 52
private-house families pass and no private-house stage-3 frame remains in the
failing queue. Thirty-four older civic, landmark and archive studies are now
correctly blocked by the strict V5 door-leaf contract, rather than being treated
as complete under their legacy geometry. One additional high-rise family still
needs its building-specific study.

The catalog families still missing a building-specific V5 study are:

- 50 `COMMERCIAL` families;
- 21 `CIVIC` families outside the accepted study set.

## Completed in this migration

- `house-bungalow`, `house-suburban-narrow`, `house-woodland-home` and
  `highrise-stacked-boxes` were regenerated and integrated with new geometry.
- `commercial-corner-cafe` is the first migrated commercial family: its new
  8×8-cell canvas, strict 8×16 entrance, authored stages 5→4→3 and geometry
  report pass the same release gate as the private-house set.
- twenty-nine private-house families received corrected partial stage-3 frames and now
  pass the immutable stage-5 authoring-window check: `house-gabled`,
  `house-alpine-chalet`, `house-rowhouse-corner`, `house-suburban-brick`,
  `house-narrow-shotgun`, `house-eco-cottage`, `house-brick-duplex`,
  `house-canalside-terrace`, `house-brownstone-row`, and
  `house-coastal-cottage`, `house-courtyard-block`, `house-modern-villa`,
  `house-studio-loft`, `house-modern-lowrise`, `house-prefab-modular`, and
  `house-rustic-cottage`, `house-farmstead`, `house-garden-villa`,
  `house-duplex-brick`, `house-colonial`, `house-stilt-riverside`,
  `house-modern-compact`, `house-live-work`, `house-craftsman`,
  `house-split-level`, `house-duplex`, `house-rowhomes`, `house-ranch`, and
  `house-rooftop-garden`.
- cyclists and scooters use three directional views with three continuous gait
  frames per view.
- eight animal species use four directions and three walk frames per direction;
  procedural and single-frame fallbacks were removed.
- fire engines were measured against the road grid: their 32×8 canvases are
  twice the normal 16×8 car length and keep the approved horizontal projection.
- parks are task-driven, deterministic, support small and large layouts, and
  scale to one additional green area per six task lots (capped at four per
  district).
- compact-house frontage decoration reserves whole prop footprints and centres
  trees, benches and bins on walkable cells.

## Blocking completion order

1. Create geometry contracts and authored stages 5→4→3 for the remaining 50 commercial
   families.
2. Finish the 21 civic families without studies, migrate the 34 older
   civic/landmark/archive studies to the strict entrance contract, and create
   the one missing high-rise study.
3. Rebuild runtime/public assets and storybook; reject any orphan or legacy
   raster.
4. Generate representative worlds, verify park cadence, frontage centring,
   animation continuity and transport scale, then run the full regression gate.

Do not change a family to complete by loosening bounds, stretching a raster, or
marking an old source sheet as reviewed.
