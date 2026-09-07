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
- Buildings use `TASKTOPIA_COMPACT_CARTOON_HIGH_45_V1`: a high, roof-dominant frontal-top camera, not isometric or three-quarter. The roof rectangle and floor bands stay horizontal/vertical on screen; no receding side facade. Every door, window, partition and roof object follows the same axes. Read `docs/art/COMPACT-BUILDING-ART-CONTRACT.md` and the family geometry before changing architecture.
- Upright props/buildings use `anchorPx = [width / 2, height]`; native micro ambient uses `[width / 2, height / 2]`. Opaque pixels must touch the bottom two rows unless the asset contract documents a deliberate floating effect.
- Native canvas/physical lot/anchor come from each reviewed family contract. The current packing envelopes are `COMPACT_BUILDING_SHAPES` in `src/shared/compact-building-families.ts`; the reviewed catalog resolves authored aliases. Long and courtyard buildings have their own envelopes. New families require explicit reviewed contracts, not stretched bitmaps.
- Entrance position, structural masks and baseline must follow the family contract within at most one native pixel, not a full map cell.
- Physical lot, visible roof/room depth and external construction envelope remain separate. The retired shallow-roof and compressed-site formulas are not applicable.

## Palette and pixels

- Use hard alpha only: `0` or `255`.
- Limit each stage to 32 RGBA colors including transparent; prefer 8–20.
- Use muted material separation. Buildings have no heavy black outline or baseline; ambient assets retain their individually approved outline contract.
- Use crisp pixel clusters. Ban blur, soft shadows, gradients, subpixel strokes, antialiasing, text, logos, and baked UI.
- Preserve a coherent light direction from upper-left: highlights on roof/top planes, darker right/bottom planes.

## Terrain and infrastructure materials

- Every terrain, road, pavement, path, marking, transition, and bridge overlay uses `TASKTOPIA_V5_CITY_MATERIALS_2026`; importing an older tile into the active manifest is a release failure.
- A base material is an opaque seamless `8×8` matrix. Use sparse 1–3 px clusters with at least three variants per land family and five for water; never distribute equal high-contrast diagonal dots across every tile.
- Grass stays muted blue-green and must not contain a repeated yellow dash pattern. Meadow may use a rare warm accent, but it must remain subordinate to buildings and props at native scale.
- Road asphalt is a deep blue-grey with sparse aggregate. Pavement is a warmer mid-grey with quiet paver joints. Their value separation must remain readable without a bright curb layer.
- Earth, pavers, and footway asphalt are independent coherent path materials. Crosswalks, road markings, bridge rails, and terrain transitions are hard-alpha overlays and must not contain baked road/ground pixels.
- Review a minimum `40×40`-cell repeated swatch at native scale. Reject seams, wallpaper diagonals, moiré, and any material that visually competes with completed building facades.

## Building proportions

The compact contract and geometry JSON own exact roof, facade, floor, window,
door and occupied-size ranges. The initial family has a broad `30 px` roof
region above a `15 px` facade, three `5 px` floors, paired `2×2` window panes
and a `4×3` door leaf inside a `7×5` portal. A rim is not a primary roof plane.

This intentionally supersedes the old `8×16` doorway and large facade scale.
Residents/vehicles remain separately reviewed ambient families; never enlarge
the building to match an old ambient sprite. Use native pixel clusters and
one strong silhouette, not fine-grained realistic texture.

## Five-stage progression

Progress-bearing buildings publish five distinct runtime appearances. Stage 0
is a reserved-slot marker, not a sixth generated building source. Stages 1–2
use the compact runtime construction kit; stages 3–5 are independent authored
PNGs sharing one source frame and anchor. Ambient decorations use finished
variants instead.

Treat the outside construction fence as a separate site overlay. Reserve one map cell around every side of the building footprint for stages 1–4, align a two-cell gate with the south entrance, and remove the overlay at stage 5. Never enlarge or shift the structure sprite to contain this clearance.

| Stage | Required reading | Coverage guidance |
| --- | --- | --- |
| 1 | separate fence, gate and marked site | full declared slot footprint, one-cell external envelope |
| 2 | same fenced site, foundation, compact crane/cabin/materials | same site and entrance; details fit without overlap |
| 3 | roughly half assembled, open rooms and partial masonry | no roof; preserve opaque room-floor depth and structural mask |
| 4 | same shell, dark unfinished windows | approximately half the roof, no finished rooftop equipment |
| 5 | finished and clean | no scaffold, fence, crane, or construction marks |

Consecutive stages must visibly progress; byte uniqueness alone is insufficient.
Preserve centre, baseline and foundation-mask alignment within the native-pixel
tolerance in geometry. Stage 3 percentage means assembled structure, not image
height: removing a roof must not shrink the physical lot or interior floor.

`constructionStageLayout()` owns the current deterministic compact detail
selection and access corridor. Do not restore the retired oversized crane,
vehicle kit or fixed ten/thirteen-object quotas. The live renderer composes
stages 1–2; catalog thumbnails are review aids, not full-site runtime sprites.

## Category silhouettes

- `HOUSE`: low/mid-rise domestic scale, readable roof and entrance; use row, corner, courtyard, detached, duplex, or apartment massing.
- `COMMERCIAL`: readable storefront/service function through windows, canopy, bays, stalls, loading volume, or entrance treatment; no tiny written signs.
- `CIVIC`: stronger symmetry, public entrance, steps/forecourt, service color, or campus composition. Apply city/district quotas.
- `HIGHRISE`: strong vertical rhythm, readable lobby, setbacks or crown; avoid simple stretched rectangles.
- `LANDMARK`: unique silhouette at minimum zoom, meaningful public base, exactly one city placement unless declared country-level.
- `ROADSIDE`: align service bays/canopy with road access; use asphalt platform and collector-road rule.

## Runtime review

Review on transparent checkerboard, dark pack background, meadow, stone, and asphalt. Inspect at native `1x` and nearest-neighbour `4x`. Test one city with ten districts; place scale/load tests in a separate suite. Verify that catalog selection can choose the new key and that quotas prevent visual spam.

## Residents and vegetation

- Cars, people, static animals and aircraft follow `docs/art/MICRO-AMBIENT-ART-CONTRACT.md`: centered 8×8 frames (aircraft 16×16), overhead square cartoon pixels, four authored headings where directional, eight opaque colors maximum. People source revision 2 has an exact 3×4px occupied box `[2,2,5,6]` in every heading, with fixed canvas anchor `[4,4]`; reject shrinkage or registration drift, not merely envelope overflow. Cars occupy 6×4px east/west or 4×6px north/south; animals 4–6×6px. Animals have one static pose. Do not restore upright gait cycles, mirrored directions, wheel overlays or oversized buses/riders.
- Incident-response vehicles use the red micro car facing west at native 8×8 canvas / 6×4 body size, with a one-pixel beacon and body-attached hose. Large fire-engine fallback props are retired; fire/smoke effects retain their own effect art.
- Trees follow `docs/art/COMPACT-TREE-ART-CONTRACT.md`:16×16canvas,
 8,16anchor,1×1footprint, up to12×14visible pixels and centered contact rows14–15.
 The compact high45 upper canopy dominates, with short trunks and restrained
 horizontal bands. Species-specific palm/fringe silhouettes stay in the same
 coarse overhead grammar. V6 tall canvases and trunk-only spacing are retired.
  Tree trunks, benches, fences and traffic lights participate in y-sorting;
  overlays/tooltips remain above them.
