# Tasktopia V5 asset migration status

Updated: 2026-08-17

This file is the release checklist for the frontal-top V5 art migration. A
catalog entry is complete only when stages 3–5 have authored sources, immutable
SHA-256 digests, a geometry contract, a passing verifier report, native-grid
previews, and no legacy or procedural fallback.

## Current inventory

| Scope | Catalog families | Geometry studies | Passing studies | Remaining |
| --- | ---: | ---: | ---: | ---: |
| All buildings | 193 | 193 | 163 | 30 |
| Existing V5 studies | 193 | 193 | 163 | 30 |
| Missing V5 studies | 0 | 0 | 0 | 0 |

The current full verifier batch plus the accepted commercial, civic and final high-rise batches found 163
passing catalog families. All 52
private-house families pass and no private-house stage-3 frame remains in the
failing queue. Thirty older civic, landmark and archive studies are now
correctly blocked by the strict V5 door-leaf contract, rather than being treated
as complete under their legacy geometry. Every catalog family now has its own
building-specific study.

Passing this gate proves runtime geometry, alpha, hashes and stage progression;
it does not by itself prove that a legacy finished facade was visually
regenerated. The in-world megacity review on 2026-08-17 exposed that distinction:
the 29-family private-house correction batch below retained its previous stage-5
art. `house-garden-villa` has since been regenerated as a complete 5→4→3 family,
leaving 28 known private-house families in the visual-regeneration queue.

The catalog families still missing a building-specific V5 study are:

- 0 `COMMERCIAL` families;
- 0 `CIVIC` families outside the accepted study set;
- 0 `HIGHRISE` families.

## Completed in this migration

- `house-bungalow`, `house-suburban-narrow`, `house-woodland-home` and
  `highrise-stacked-boxes` were regenerated and integrated with new geometry.
- `house-garden-villa` was fully regenerated from stage 5 back through stages 4
  and 3 after the megacity review showed that its geometry-valid source still
  carried the legacy facade style.
- `commercial-corner-cafe` is the first migrated commercial family: its new
  8×8-cell canvas, strict 8×16 entrance, authored stages 5→4→3 and geometry
  report pass the same release gate as the private-house set.
- `commercial-pharmacy` now uses a compact 6×8-cell canvas and 6×6-cell lot,
  with a strict single entrance and independently authored pharmacy stages
  5→4→3. The previous 4×3 legacy raster family is no longer referenced.
- `commercial-auto-repair` now uses a wide 10×6-cell lot with a measured
  80×64 runtime canvas, two vehicle bays and a separate human-scale entrance;
  its authored stages preserve the low industrial silhouette without scaling.
- `shop-supermarket` now occupies a 12×6-cell urban lot on a 96×64 canvas,
  with a measured double entrance, readable roof plant and authored wide
  construction stages instead of the former 40×16 legacy strip.
- `shop-bakery-long` now occupies a 10×6-cell lot with a 80×64 canvas,
  consistent human-scale entrance, tiled top plane and independently authored
  bakery stages instead of the former 48×16 strip.
- `shop-mall` now occupies a 14×8-cell urban lot on a 112×80 canvas. Its
  stepped roof planes, central glazed atrium, strict double entrance and
  progressively shorter authored construction stages pass the grid verifier.
- `commercial-gas-station` now uses a 10×6-cell forecourt on an 80×64 canvas,
  with a measured double entrance, two vehicle-scale pump islands and a
  readable canopy top plane; its low stage-3 frame preserves the same lot.
- `civic-fire-station` now uses a 10×7-cell service lot on an 80×80 canvas.
  Two bays fit 32×8 fire engines, the separate 8×16 pedestrian entrance keeps
  human scale, and all authored stages retain the same frontal-top geometry.
- `civic-fire-station-compact`, `civic-fire-station-large` and
  `civic-health-center` now use measured service lots, strict human-scale
  entrances and independently authored stages 5→4→3. Their structural frames
  remain visibly incomplete while the finishing stages preserve the final
  roofline and all service-defining silhouettes.
- `shop-warehouse`, `commercial-parking-lot`, `commercial-shopping-plaza`,
  `commercial-gas-station-compact` and `commercial-highway-service-plaza`
  now use measured low-wide V5 geometry rather than their former small raster
  strips. Each family has independent authored stages 5→4→3, a grid-aligned
  human entrance, a stable footprint and a passing native-grid preview.
- `shop-cafe`, `shop-butcher`, `shop-electronics`, `shop-furniture` and
  `shop-bookstore` now use larger human-scale storefronts with authored
  stage 5→4→3 sequences and measured 8×16 or 16×16 entrances.
- `shop-clothing`, `shop-restaurant`, `shop-bar`, `office-small` and
  `hotel-small` now use full human-scale V5 canvases with independent
  structural and finishing stages.
- `commercial-market-stalls`, `commercial-storage`,
  `commercial-gas-station-electric`, `commercial-gas-station-truck` and
  `commercial-gas-station-cafe` now use measured V5 lots, strict human-scale
  entrances and independently authored stages 5→4→3. Text and numeric signage
  rejected by the art contract was removed before integration.
- `commercial-gas-station-wash`, `commercial-grocery`,
  `commercial-food-hall`, `commercial-cinema` and `commercial-bowling` now use
  larger measured V5 lots with human-scale entrances and independently authored
  stages 5→4→3. Their low construction frames pass the strict 45–80% height gate.
- `commercial-gym`, `commercial-bank-branch`, `commercial-coworking`,
  `commercial-tech-workshop` and `commercial-car-dealership` now use measured
  V5 canvases and lots, strict 8×16 or 16×16 entrances, clean chroma-isolated
  masters and independently authored finishing and structural stages. The
  low-wide dealership keeps its honest 37 px finished silhouette instead of
  being stretched to an unrelated minimum height.
- `commercial-garden-center`, `commercial-night-market`,
  `commercial-department-store`, `commercial-office-courtyard` and
  `commercial-logistics-hub` now use measured wide V5 lots and independent
  stages 5→4→3. The office courtyard keeps its architectural paved court while
  all trees, planters and other world-owned landscaping remain outside the
  building raster.
- `commercial-cold-storage`, `commercial-maker-market`,
  `commercial-rooftop-restaurant`, `commercial-marina-office` and
  `commercial-farmers-market` now use larger measured V5 lots with aligned
  entrances and genuinely shorter structural frames. Exterior stock, tables,
  boats, produce and landscaping remain world-owned props instead of being
  baked into the building rasters.
- `landmark-ferris-wheel`, `commercial-hotel-boutique`, `landmark-stadium`
  and `landmark-aquarium` close the remaining commercial queue. Their measured
  landmark footprints, centered public entrances and authored stages 5→4→3
  pass the same strict grid and height gates as ordinary buildings.
- `civic-clinic`, `civic-police`, `civic-bank`, `civic-school` and
  `civic-city-hall` now use measured service lots, centered human-scale
  entrances and independent structural and finishing stages. Their former
  undersized catalog canvases are no longer referenced.
- `civic-post-office`, `civic-theatre`, `civic-clinic-neighborhood`,
  `civic-hospital` and `civic-courthouse` now use larger measured public lots,
  centered 16×16 entrances and independent stages. The post-office raster was
  explicitly regenerated to keep its freestanding mailbox world-owned.
- `civic-community-center`, `civic-aquatic-center`, `civic-civil-defense`,
  `civic-bus-terminal` and `civic-court-annex` now use measured public lots,
  centered human-scale entrances and independent stages 5→4→3 without baked
  landscaping or transport props.
- `civic-administration-center`, `civic-arts-school`,
  `civic-animal-shelter`, `landmark-monument` and `landmark-observatory` close
  the missing civic/landmark study queue. Their strict frontal-top silhouettes,
  structural stages, anchors and entrance offsets pass the native-grid verifier.
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
- `highrise-residential-tower` no longer reuses `highrise-balcony-tower`; it
  now has an independent 18×35-cell V5 study and progressive stages 5→4→3.

## Blocking completion order

1. Migrate the 33 older civic/landmark/archive studies to the strict entrance
   contract.
2. Rebuild runtime/public assets and storybook; reject any orphan or legacy
   raster.
3. Generate representative worlds, verify park cadence, frontage centring,
   animation continuity and transport scale, then run the full regression gate.

Do not change a family to complete by loosening bounds, stretching a raster, or
marking an old source sheet as reviewed.
