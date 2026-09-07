# Ambient asset style and acceptance

Use this contract for vehicles, transit stops, residents, micromobility, playgrounds, park objects, trees, shrubs, animals, boats, and similar finished props.

Cars, people, animals and aircraft use the current `docs/art/MICRO-AMBIENT-ART-CONTRACT.md` and its centered native frames. The static tree, transit-stop and park-object gates below remain unchanged. Broader historical plans never override the micro contract.

## Verbal style fingerprint

Tasktopia V4 uses dense hand-authored city-builder pixel art rendered on an `8 px` logical grid. Shapes are compact and deliberately chunky, but not crude: large material planes are broken into controlled clusters of two to five pixels, with selective single-pixel highlights only at functional edges. The outline is a continuous dark blue-grey, normally one artistic pixel thick. Interior shadows use a related muted tone rather than black. Light always comes from the upper left, producing a narrow light top plane and a restrained darker lower/right plane.

The camera is orthographic frontal-top for buildings and upright street furniture. Road vehicles use a consistent near-top orthographic road view: their roof, windscreens and hood are readable, but no cinematic perspective or foreshortened vanishing point is allowed. Trees use the matching high `45°` roof convention: a broad square/rectangular crown top plane, a compressed striped lower/front band and only a short trunk contact. They are not frontal icons and not isometric diamonds.

The palette is muted urban-natural: slate outlines, dusty masonry, warm ochres, restrained brick, cool cyan glass, desaturated greens, and small warm service accents. Saturated colors are reserved for semantic cues such as a vehicle body, playground equipment, flowers, or transit marker. No object may rely on text or a logo to explain its function.

Every asset must remain readable at native `1x`. Prefer a clear silhouette, one defining functional cue, and one supporting material cue over many noisy pixels. All edges are hard; gradients, blur, antialiasing, soft alpha, soft cast shadows, vector-smooth curves, photoreal texture, glossy 3D rendering, and UI-like symbols are prohibited.

## Hard rejection fingerprint

Reject the source before catalog registration when any item applies:

- isometric, three-quarter, side-elevation, perspective-road, or mixed camera;
- thick black cartoon outline, pastel outline, outline-free vector art, or painterly edge;
- smooth gradient, glow, soft shadow, translucent fringe, subpixel line, or blurred texture;
- flat geometric icon, emoji, clip-art, voxel art, low-poly render, or photoreal object;
- excessive micro-noise that disappears at `1x`, or an empty primitive silhouette with no material detail;
- inconsistent upper-left lighting, ground baked into a prop, fake written signage, watermark, UI badge, or detached decoration outside the footprint;
- a directional counterpart produced by mechanically rotating the other view;
- a palette-only vehicle variant when the requested family requires a different model silhouette.

## Moving vehicle gate

Use the native micro contract: 8×8 car frames with 6×4/4×6 opaque bodies, four independently authored compass views and no rotation/mirroring. Retired large buses and riders are not compact-city fallback assets. Aircraft use centered 16×16 frames and task-backed airport routes.

Incident response uses the west-facing red micro car: an 8×8 frame with a native 6×4 body, one-pixel beacon and body-attached hose. No large fire-engine fallback is allowed. Fire/smoke effects keep their separate authored effect contract.

## Transit-stop gate

- Horizontal and vertical road-axis stop placements are separately authored and clearly depict the same system.
- A stop needs a roof/top plane, two or more supports, a readable waiting zone or bench, and a small color-coded stop marker without text.
- The shelter must not contain baked asphalt, road, grass, or a full pavement slab.
- Use the canonical `16x16 px`, `2x2` boarding platform contract. Every stop pair sits outside opposite road edges and is offset along the road so shelters do not face each other in one cross-section.

## People and animal gate

Use centered 8×8 top-down frames: people source revision 2 has exactly 3×4px at occupied bounds `[2,2,5,6]` in all headings, animals 4–6×6px. The person canvas anchor stays `[4,4]`, with the same opaque center `[3.5,4]` across the series. Reject a 3×2 south view or a one-pixel registration shift even if its metadata and hashes agree. Each person color has four authored headings; each animal species has one static pose. No gait, activity costume swaps, static fisherman population, or micromobility rider family is active in the compact scene.

## Playground and park-object gate

- Playground compositions use transparent `24x16`, `24x24`, or `32x24 px` canvases and show at least two connected play functions.
- Equipment must have plausible supports, access and landing space. Reject floating slides, disconnected ladders, impossible bars, or a toy-like icon pile.
- Large park objects use their manifest footprint without baked terrain. Water is permitted only inside a pond or fountain basin.
- Produce materially distinct park families: civic formal, neighbourhood, botanical, natural grove, and recreation. Vary path geometry and prop composition, not merely color.

## Tree gate

- Read `docs/art/COMPACT-TREE-ART-CONTRACT.md` for V7's16x16canvas,
  anchor8,16,1x1logical footprint, source contact rows14–15 and centered world
  anchor. Living trees stay within12x14visible pixels; deadwood within8x9.
  V6's16x32canvas is retired, not an alternative runtime profile.
- The crown may overhang the planting cell only above the ground-contact band.
  Its upper plane occupies about 75–85% of the readable volume. The outer
  silhouette is a compact square or rectangle with only `1–2 px` corner steps.
  Use `2–4 px` blocks and `2–3` parallel horizontal highlight/shadow stripes
  aligned with the roof and terrain-grid axes. Keep the lower/front crown and
  trunk compressed at the anchor. At least three tones are required:
  outline/shadow, body and upper-left highlight.
- Species differ by width, height, bands, top-plane pattern and palette.
  Palm fronds and willow fringes are explicit overhead exceptions, not a switch
  to a tall frontal camera. Avoid smooth round or long-branch realistic silhouettes.
- Do not bake grass or a circular ground shadow into the tree.
- Reject crowns made from one flat unbanded blob, random confetti pixels,
  lollipops, long frontal trunks, realistic leaf texture, smooth circular
  shading, or any silhouette that stops reading as a striped square at `1x`.
- Render every accepted tree on an actual `8x8` pavement grid at native `1x`
  and nearest-neighbour `4x`. Reject a tree whose ground contact appears to sit
  between cells, whose lower foliage covers neighbouring tiles, or whose camera
  differs from the approved building benchmark.

## AI-authored source workflow

1. Generate one coherent asset family per request on flat `#ff00ff` chroma.
2. State exact cell order, runtime size, direction, semantic cue, and negative constraints in every prompt.
3. Pause `2–5 s` after each completed request.
4. Inspect the source at original scale before copying it into `reference/ai-authored/`.
5. Normalize with aspect preservation, hard alpha, the declared center/bottom anchor, and the family's palette budget (eight opaque colors for micro ambient). Never redraw accepted geometry procedurally.
6. Register `artSource: AI_AUTHORED`, `sourceSheet`, and a style profile in the manifest.
7. Render native and nearest-neighbour `8x` family contact sheets. Check silhouettes, paired directions, footprint isolation, and semantic readability.
8. Run both asset audits. Any style-contract error blocks shipping; do not whitelist an incompatible visual.
9. For directional micro ambient, assert `direction` in metadata and test the runtime north/south/east/west mapping before visual QA.
