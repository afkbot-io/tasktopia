# Building-stage geometry contract

## Contents

- Coordinate spaces
- Projection and depth
- Foundation and fence
- Stage bounds
- Automated and visual gates

## Coordinate spaces

Keep three spaces separate:

1. **Map footprint:** physical occupancy in 8×8 cells: `widthCells × depthCells`.
2. **Sprite canvas:** screen-space artwork: `widthCells × heightCells`, converted to pixels by multiplying by 8.
3. **Construction envelope:** temporary map reservation around the footprint.

Use a bottom-centre structure anchor:

```text
spriteWidthPx = widthCells × 8
spriteHeightPx = heightCells × 8
anchorPx = [spriteWidthPx / 2, spriteHeightPx]
```

Preserve aspect ratio when normalizing. Transparent side margins are allowed. Never stretch the source to fill the canvas.

## Projection and depth

Physical depth is not screen depth. In Tasktopia's strict frontal-top camera, a deep lot is compressed into a shallow visible roof/top plane.

Store both values:

```text
physicalDepthPx = depthCells × 8
projectedRoofDepthPx = projectedRoofDepthCells × 8
depthProjectionRatio = projectedRoofDepthCells / depthCells
foundationTotalHeightPx = projectedRoofDepthPx + foundationThicknessCells × 8
```

Store the entrance ruler separately from the footprint:

```json
{
  "doorSizePx": [8, 16],
  "doorLeafSizePx": [6, 14],
  "doorBottomInsetPx": 0
}
```

For a compact/private building, also pin its approved finished opaque mass so
that a later source cannot silently turn a bungalow into a stretched apartment
block (or shrink a readable house into a miniature):

```json
{
  "finishedOccupiedWidthPxRange": [88, 96],
  "finishedOccupiedHeightPxRange": [52, 60]
}
```

These are building-specific measurements taken from the approved stage 5, not
category-wide guesses. If a source misses them materially, regenerate the
building at the correct scale. Never resize one axis, compress storeys, or use
an oversized plot/canvas to disguise the mismatch.

Use `[8,16]` + `[6,14]` for a single door and `[16,16]` + `[12,14]`
for a double door. `doorSizePx` is the full functional frame; the leaf is the
moving colored surface inside it. A canopy, transom, pilasters, lobby glazing
or ornamental portal never enlarges either measurement. The verifier draws
both rulers on the native grid so approval does not depend on guessing from a
large authoring source.

Measure `projectedRoofDepthCells` from the approved finished source after normalization. Use the closest whole-cell value that preserves its back and front roof edges. Typical high-rise values are 25–50% of physical depth; the building-specific measurement is authoritative.

Reject a source when the roof plane is absent, changes camera across its width, forms an isometric diamond or reveals a receding side facade. Apply the same rejection to every secondary horizontal surface. Porches, entrance landings, canopies, balconies, podiums, setbacks and crowns must use the same compressed depth vector as the principal roof. A source fails when one ledge is a flat stripe while another exposes a top plane, even if its main roof is acceptable.

## Foundation and fence

Stages 1–2 are built from shared `8×8` construction tiles. Their site width is
the building footprint width. Their screen-space depth is
`clamp(ceil(depthCells × 0.42), 3, 5)` cells. This keeps compact sites readable
and prevents a deep gameplay footprint from becoming an oversized painted
foundation. Stage 2 uses foundation/edge/rebar modules; stage 1 uses two earth
variants and sparse survey markers.

Reserve construction clearance independently:

```text
clearanceCells = 1
envelopeWidthCells = widthCells + 2 × clearanceCells
envelopeDepthCells = depthCells + 2 × clearanceCells
```

The footprint begins one cell inside the envelope. Keep the building anchor at the front-centre of the physical footprint. Compose the fence as a separate site overlay around stages 1–4, with a two-cell gate aligned to the south entrance. Remove it completely at stage 5.

This separation prevents a larger construction fence from shifting the building sprite, changing its manifest footprint or leaving transparent padding in the finished stage.

## Stage bounds

Compare normalized opaque bounds against stage 5:

| Stage | Width | Height | Required geometry |
| --- | ---: | ---: | --- |
| 1 | exact footprint width | 3–5 cells | shared earth/survey composition |
| 2 | exact footprint width | same as stage 1 | shared foundation/edge/rebar composition |
| 3 | 60–110% of final | 45–80% of final | columns/slabs rise from foundation corners |
| 4 | 85–110% of final | 85–105% of final | final silhouette retained under scaffolding |
| 5 | category target | 94–100% for high-rise | finished, no construction remnants |

The table contains rejection limits. Image prompts must leave margin for
raster rounding: target 55–65% final height for stage 3 and 90–100% for stage
4. Stage 4 must preserve silhouette-defining masts, spires, antennae, towers
and crowns even when their materials remain unfinished.

Across all stages require horizontal-centre drift ≤8 px and baseline drift ≤1 px. The structure layer must not include the external fence or pavement.

Stage 5 owns the immutable normalized authoring window. Record its source-space
top and bottom fractions in `authoringFrameNormalized`; stage 3 must be authored
inside that same window, not centred independently by the image model. For a
target ratio `r`, keep the finished bottom fraction `b` and target the stage-3
top near `b - r × (b - t)`, where `t` is the finished top fraction. Verify the
resulting normalized bounds immediately. This formula is prompt guidance, not
permission to transform an authored raster after generation.

## Automated and visual gates

Automate exact canvas, alpha, palette, occupied bounds, centre, baseline, stage ratios, envelope formula and individual pavement previews. Keep these visual-only and blocking:

- strict frontal-top camera and shallow roof plane;
- one coherent frontal-top camera for roof, porch, steps, canopy, balcony, podium, setbacks and crown;
- same building identity and entrance;
- foundation visually matching the roof plane;
- scaffolding following rather than replacing the final massing;
- readable native-scale pixel clusters;
- no baked site surface, outside fence, UI or watermark.

Code can reject measurable failures; it cannot prove perspective or identity on its own.

## Projection-review evidence

For a newly generated or visually regenerated family, accompany the geometry
run with a `projection-review.json` and pass both `--projection-review` and
`--require-projection-review`. Coordinates are measured on the normalized
runtime stage-5 canvas, not on the large generator source:

```json
{
  "key": "house-example",
  "stage": 5,
  "facadeVerticals": [
    [[8, 20], [8, 55]],
    [[47, 20], [47, 55]]
  ],
  "floorHorizontals": [
    [[8, 40], [47, 40]]
  ],
  "topPlanes": [
    {
      "name": "main-roof",
      "role": "primary-roof",
      "backEdge": [[14, 8], [41, 8]],
      "frontEdge": [[8, 14], [47, 14]]
    }
  ],
  "sideFacadeWidthPx": 0,
  "primaryRoofIsDominantSurface": true,
  "primaryRoofFrontEdgeMatchesEave": true,
  "annotationsMatchVisiblePixels": true,
  "sameCameraAcrossStages": true
}
```

The verifier requires facade vertical drift, floor drift and top-plane edge
drift to stay within `1 px`. Supporting annotated planes may expose `2 px` up
to the building-specific `projectedRoofDepthPx`; a zero-depth stripe is a flat
elevation failure. At least one plane must be the actual dominant main roof
(`role: primary-roof`), expose at least `6 px`, and span at least 50% of the
sprite width, so a ridge, cornice, parapet cap or tiny canopy cannot make a
flat building pass. The review also explicitly confirms that the primary
plane traces the dominant surface and that its front edge follows the real
facade eave. `sideFacadeWidthPx` may not exceed
`max(2 px, 8% of sprite width)`. The generated cyan/yellow/green/magenta
projection overlay must still be inspected: annotation is semantic evidence,
and code cannot prove that a line claimed as a roof edge actually traces the
roof. A reviewer sets the two boolean confirmations only after checking the
overlay against stage 5 and the stage 4→3 row.

For a genuinely segmented roof such as a sawtooth profile, annotate every
visible section independently. Give the sections the same
`primaryRoofGroup` and set `edgeProfile: "parallel-pitched"` only when each
section's back and front edges are visibly parallel. The verifier measures
their non-overlapping combined horizontal coverage against the 50% gate.
Never draw one rectangular evidence envelope through valleys or transparent
gaps merely to satisfy the span threshold.
