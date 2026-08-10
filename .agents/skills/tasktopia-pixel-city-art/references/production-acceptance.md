# AI-authored building acceptance

Use this gate before adding a generated sheet to `catalog/ai-authored-buildings.json`.

## Preflight

1. Read the target `spriteSize`, `footprintCells`, category, platform, entrance and semantic key from the catalog/manifest.
2. Select two original V3 source sheets from the same category as projection and pixel-cluster references.
3. Describe one defining silhouette and at most two supporting details. Do not ask the model to invent the semantic role.
4. State the intended runtime occupied bounds in pixels. Preserve aspect ratio during normalization; never repair a bad source by stretching it.
5. Generate one building per request and exactly five horizontal cells. Wait `2–5 s` after each completed request before starting the next one.

## Occupied-bounds targets

Measure the opaque bounds of stage 5 after runtime normalization.

| Shape | Width target | Height target |
| --- | ---: | ---: |
| square house/shop | 70–95% | 75–98% |
| low-wide/ranch/parking | 88–98% | 60–96% |
| civic/campus | 82–98% | 75–98% |
| single highrise | 65–95% | 94–100% |
| twin/multi-tower | 88–98% | 94–100% |
| slender landmark | 60–95% | 96–100% |

Coverage alone is insufficient. Reject a subject that technically fills the canvas but has an unreadable entrance, merges multiple towers, or turns into noise at native `1x`.

## Projection gate

- Accept only a facade parallel to the screen with vertical verticals and horizontal floors.
- Accept a shallow roof/top plane.
- Reject any receding side facade wider than `max(2 px, 8% of runtime width)`.
- Reject an isometric diamond, side elevation, rotated base, diagonal floor lines, or inconsistent camera between stages.

## Stage gate

- Stage 1 spans most of the future width and reads as an occupied work site.
- Stage 2 covers the full future footprint.
- Stage 3 reaches at least half the final height and already identifies the building.
- Stage 4 keeps the final massing and uses close scaffolding; reject cranes or scaffold silhouettes that force the building to shrink.
- Stage 5 contains no fence, scaffold, crane, material pile or detached construction remnant.

## Special compositions

- Parking: use a low, wide municipal parking structure or clearly enclosed frontage with entrance booth/barrier and readable bays. Do not ship an empty asphalt rectangle, baked road, cars outside the footprint, or a perspective parking field.
- Gas/service station: keep store, canopy and pumps in one frontal composition; no baked driveway.
- Courtyard/campus: express the court as a central dark/open recess in the frontal silhouette, not as a rotated U-shaped plan.
- Twin towers: keep two readable narrow shafts, a small gap/atrium and a shared podium. The combined source must be taller than it is wide so normalization fills the height.

## Batch gate

Work in review groups of at most five accepted sources:

1. Generate each source separately.
2. Save accepted sources under `reference/ai-authored/`; move rejected drafts to `reference/rejected/`.
3. Register only accepted sources.
4. Run `npm run assets:build` and `npm run assets:verify`.
5. Render native/nearest-neighbour contact sheets and inspect every stage-5 sprite.
6. Record accepted count, rejected count, occupied bounds and remaining queue before continuing.
