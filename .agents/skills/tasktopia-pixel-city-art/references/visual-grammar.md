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
- Store physical map depth separately from visible roof depth. Derive `projectedRoofDepthCells` from the approved stage 5 for authored structure planes in stages 3–4. Shared stages 1–2 use the bounded site-depth formula from the construction layout.

## Palette and pixels

- Use hard alpha only: `0` or `255`.
- Limit each stage to 32 RGBA colors including transparent; prefer 8–20.
- Keep the common dark blue-grey outline near `#263945` and one-pixel artistic thickness.
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

- The finished visible silhouette should occupy roughly 45–95% of canvas width and 45–95% of height. Roadside compositions may use wider negative space, but their canopy/sign/shop must remain readable at `1x`.
- Human scale is fixed before facade detail: a normal single door is `8×16 px`, a double entrance is `16×16 px`, and an adult resident has an opaque body no taller than `14 px` inside an `8×16 px` canvas. Do not resize doors independently between buildings or construction stages.
- Windows are normally 2–6 px wide; do not represent each window with single noisy pixels on large buildings.
- Roof plane is shallow: normally 2–8 px. A landmark may exceed this when the roof is its defining silhouette.
- Use one strong identity cue per building and at most two supporting cues. Too many one-pixel details become noise.

## Five-stage progression

All progress-bearing buildings and progress-bearing large props publish five distinct runtime appearances. Stages 1–2 are shared tiled composition; stages 3–5 are independent authored PNGs sharing one canvas and anchor. Ambient decorations use independent finished variants instead.

Treat the outside construction fence as a separate site overlay. Reserve one map cell around every side of the building footprint for stages 1–4, align a two-cell gate with the south entrance, and remove the overlay at stage 5. Never enlarge or shift the structure sprite to contain this clearance.

Every `new-build` high-rise requires a continuous pavement platform beneath its complete physical footprint and one-cell site clearance on every stage. Grass, earth, an unpaved gap, or road asphalt beneath the structure is a blocking placement error; the access road may touch the south entrance but never substitutes for the platform.

| Stage | Required reading | Coverage guidance |
| --- | --- | --- |
| 1 | shared reserved site, earth and seeded planning props | exact footprint width, projected depth 3–5 cells; 2–7 non-overlapping details |
| 2 | shared modular foundation, rebar and seeded build props | same site rectangle as stage 1; 2–7 non-overlapping details |
| 3 | recognisable structural frame | reaches at least half of final height |
| 4 | same final massing, unfinished | close to final bounds; scaffolding visible |
| 5 | finished and clean | no scaffold, fence, crane, or construction marks |

Consecutive stages must change visibly. Byte uniqueness alone is insufficient. Preserve the horizontal centre within one cell and the ground line within one pixel. Stage 4 must not introduce a silhouette that disappears in stage 5.

The shared detail catalog contains exactly ten planning and thirteen foundation objects. Selection is deterministic for a task seed, scales with site area, places large machinery only when its declared footprint fits, caps `CRANE` and `VEHICLE` at one instance each, and reserves a two-cell-deep/two-cell-wide access corridor behind the gate. A compact site uses 2–3 objects; a tower site uses 5–7. Heavy vehicles use a `40–48 px` horizontal canvas, tower cranes use `72–96 px`, and both must remain readable at native scale. Runtime loads only selected detail PNGs; eager loading the whole kit is forbidden.

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

- A walking resident uses three distinct frames for each direction: contact, passing and opposite contact. East may be mirrored for west; north/back and south/front require their own authored frames. The bottom-centre foot anchor remains fixed across all frames, and the head may not bob more than one pixel.
- A resident canvas is `8×16 px`; the opaque figure is at most `6×14 px`, with hard alpha and a readable one-pixel step at native scale. Dialogue/UI is a separate foreground layer and is never baked into the sprite.
- Standard trees use a `16×32 px` canvas, `1×1` gameplay footprint and
  anchor `[8,32]`. Define the exact planting cell as the lower-centre
  `8×8 px` rectangle `x=4..11`, `y=24..31`. The trunk/root must touch row
  `31`, and every opaque pixel in the two ground-contact rows `30..31` must
  remain inside `x=4..11`. The crown may overhang neighbouring cells above
  that contact band without changing gameplay occupancy. The visible crown
  should reach roughly `24–32 px` (3–4 cells) while remaining narrow enough to
  avoid hiding a full facade. Tree trunks, benches, fences and traffic lights
  participate in y-sorting; overlays/tooltips remain above them.
