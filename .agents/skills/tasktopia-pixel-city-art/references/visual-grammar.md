# Visual grammar and measurable acceptance

## Contents

- Canvas and projection
- Palette and pixels
- Building proportions
- Five-stage progression
- Category silhouettes
- Runtime review

## Canvas and projection

- Base cell is `8×8 px`; every runtime dimension is a positive multiple of eight.
- Camera is strict frontal-top, not a three-quarter view: the facade plane is parallel to the screen, all vertical edges stay vertical, storeys stay horizontal, and the left/right facade edges have the same height. A shallow roof/top plane is visible. A darker right depth cue is optional and may occupy at most `max(2 px, 8% of sprite width)`; a receding side facade is forbidden. Do not use isometric diamonds or a flat elevation with no roof information.
- `anchorPx = [width / 2, height]`. Opaque pixels must touch the bottom two rows unless the asset contract documents a deliberate floating effect.
- Canvas width equals footprint width × 8 for buildings. Height may exceed footprint height to contain the facade.
- Entrance position in the drawing and manifest must agree within one cell.

## Palette and pixels

- Use hard alpha only: `0` or `255`.
- Limit each stage to 32 RGBA colors including transparent; prefer 8–20.
- Keep the common dark blue-grey outline near `#263945` and one-pixel artistic thickness.
- Use crisp pixel clusters. Ban blur, soft shadows, gradients, subpixel strokes, antialiasing, text, logos, and baked UI.
- Preserve a coherent light direction from upper-left: highlights on roof/top planes, darker right/bottom planes.

## Terrain and infrastructure materials

- Every terrain, road, pavement, path, marking, transition, and bridge overlay uses `TASKTOPIA_V4_CITY_MATERIALS_2026`; importing an older tile into the active manifest is a release failure.
- A base material is an opaque seamless `8×8` matrix. Use sparse 1–3 px clusters with at least three variants per land family and five for water; never distribute equal high-contrast diagonal dots across every tile.
- Grass stays muted blue-green and must not contain a repeated yellow dash pattern. Meadow may use a rare warm accent, but it must remain subordinate to buildings and props at native scale.
- Road asphalt is a deep blue-grey with sparse aggregate. Pavement is a warmer mid-grey with quiet paver joints. Their value separation must remain readable without a bright curb layer.
- Earth, pavers, and footway asphalt are independent coherent path materials. Crosswalks, road markings, bridge rails, and terrain transitions are hard-alpha overlays and must not contain baked road/ground pixels.
- Review a minimum `40×40`-cell repeated swatch at native scale. Reject seams, wallpaper diagonals, moiré, and any material that visually competes with completed building facades.

## Building proportions

- The finished visible silhouette should occupy roughly 45–95% of canvas width and 45–95% of height. Roadside compositions may use wider negative space, but their canopy/sign/shop must remain readable at `1x`.
- Main door is normally 3–5 px wide. Windows are normally 2–6 px wide; do not represent each window with single noisy pixels on large buildings.
- Roof plane is shallow: normally 2–8 px. A landmark may exceed this when the roof is its defining silhouette.
- Use one strong identity cue per building and at most two supporting cues. Too many one-pixel details become noise.

## Five-stage progression

All progress-bearing buildings and progress-bearing large props have five distinct PNGs sharing one canvas and anchor. Ambient decorations use independent finished variants instead.

| Stage | Required reading | Coverage guidance |
| --- | --- | --- |
| 1 | reserved site, stakes/fence, earth | smallest, but spans most of planned width |
| 2 | complete foundation footprint | wider/more solid than stage 1 |
| 3 | recognisable structural frame | reaches at least half of final height |
| 4 | same final massing, unfinished | close to final bounds; scaffolding visible |
| 5 | finished and clean | no scaffold, fence, crane, or construction marks |

Consecutive stages must change visibly. Byte uniqueness alone is insufficient. Preserve the horizontal centre within one cell and the ground line within one pixel. Stage 4 must not introduce a silhouette that disappears in stage 5.

## Category silhouettes

- `HOUSE`: low/mid-rise domestic scale, readable roof and entrance; use row, corner, courtyard, detached, duplex, or apartment massing.
- `COMMERCIAL`: readable storefront/service function through windows, canopy, bays, stalls, loading volume, or entrance treatment; no tiny written signs.
- `CIVIC`: stronger symmetry, public entrance, steps/forecourt, service color, or campus composition. Apply city/district quotas.
- `HIGHRISE`: strong vertical rhythm, readable lobby, setbacks or crown; avoid simple stretched rectangles.
- `LANDMARK`: unique silhouette at minimum zoom, meaningful public base, exactly one city placement unless declared country-level.
- `ROADSIDE`: align service bays/canopy with road access; use asphalt platform and collector-road rule.

## Runtime review

Review on transparent checkerboard, dark pack background, meadow, stone, and asphalt. Inspect at native `1x` and nearest-neighbour `4x`. Test one city with ten districts; place scale/load tests in a separate suite. Verify that catalog selection can choose the new key and that quotas prevent visual spam.
