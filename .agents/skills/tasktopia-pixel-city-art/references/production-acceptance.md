# Building stage-source acceptance

Use this gate before marking a building `reviewed` in the unified
`catalog/buildings.json`.

## Preflight

1. Read the target `spriteSize`, `footprintCells`, category, platform, entrance and semantic key from the catalog/manifest.
2. Select two approved benchmark stage images from the same category as projection and pixel-cluster references.
3. Describe one defining silhouette and at most two supporting details. Do not ask the model to invent the semantic role.
4. State the intended runtime occupied bounds in pixels. Preserve aspect ratio during normalization; never repair a bad source by stretching it.
5. Generate one authored building stage per request. Approve stage 5 first, then use `$tasktopia-building-stage-generator` for `4 → 3`. Stages 1–2 are shared tile composition and must not be requested from an image model. Wait `2–5 s` after each completed request.

## Geometry preflight

Record the building geometry before generating any construction stage:

- `cellSizePx = 8`;
- sprite canvas `widthCells × heightCells` and bottom-centre anchor;
- physical map footprint `widthCells × depthCells`;
- `projectedRoofDepthCells` measured from normalized stage 5;
- structural foundation rim height, normally `2` cells;
- south entrance offset;
- construction clearance, exactly `1` cell on every side.

Physical footprint depth and visible plane depth are not interchangeable. Shared stages 1–2 use `clamp(ceil(depthCells × 0.42), 3, 5)` visible rows. The outside fence is a separate tiled world/site overlay around stages 1–4 and must never be baked into a structure source.

The building source is also forbidden from containing pavement, benches, trees,
bins or lamps. Runtime composition owns those layers so the same finished
building can be placed on a dense urban block, a quiet street or an active
construction site without duplicating imagery.

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
- Accept a dominant main roof surface with at least `6 px` compressed depth;
  ordinary buildings normally use `8–16 px`, while a defining pitched roof may
  use up to `24 px` when the geometry contract reserves that depth.
  Supporting planes may use `2–6 px` in the same direction. Reject a ridge,
  cornice, parapet cap or decorative strip presented as the main roof.
- Reject any receding side facade wider than `max(2 px, 8% of runtime width)`.
- Reject an isometric diamond, side elevation, rotated base, diagonal floor lines, or inconsistent camera between stages.

## Stage gate

- Stage 1 is composed from shared earth/survey modules at exact footprint width and projected site depth.
- Stage 2 is composed from shared foundation/edge/rebar modules at the same dimensions.
- Stage 3 reaches at least half the final height and already identifies the building.
- Stage 4 keeps the final massing and uses close scaffolding; reject cranes or scaffold silhouettes that force the building to shrink.
- Stage 5 contains no fence, scaffold, crane, material pile or detached construction remnant.

Across all stages, horizontal-centre drift must stay within one `8 px` cell and baseline drift within `1 px`. The entrance axis may not move.

## Special compositions

- Parking: use a low, wide municipal parking structure or clearly enclosed frontage with entrance booth/barrier and readable bays. Do not ship an empty asphalt rectangle, baked road, cars outside the footprint, or a perspective parking field.
- Gas/service station: keep store, canopy and pumps in one frontal composition; no baked driveway.
- Courtyard/campus: express the court as a central dark/open recess in the frontal silhouette, not as a rotated U-shaped plan.
- Twin towers: keep two readable narrow shafts, a small gap/atrium and a shared podium. The combined source must be taller than it is wide so normalization fills the height.

## Batch gate

Work in review groups of at most five accepted sources:

1. Generate each building or reverse-derived stage separately.
2. Save only accepted source art in the building reference directory; do not add rejected drafts to the repository. Keep separate reverse-derived stage sources separate rather than recombining them for review.
3. Register only the accepted source in `catalog/buildings.json`, pin its SHA-256 digest and set `reviewed: true`.
4. Run `npm run assets:build` and `npm run assets:verify`.
5. Render native/nearest-neighbour contact sheets and inspect every stage-5 sprite.
6. Record accepted count, rejected count, occupied bounds and remaining queue before continuing.
