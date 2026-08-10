# Ambient asset style and acceptance

Use this contract for vehicles, transit stops, playgrounds, park objects, trees, shrubs, animals, boats, and similar finished props.

## Verbal style fingerprint

Tasktopia V4 uses dense hand-authored city-builder pixel art rendered on an `8 px` logical grid. Shapes are compact and deliberately chunky, but not crude: large material planes are broken into controlled clusters of two to five pixels, with selective single-pixel highlights only at functional edges. The outline is a continuous dark blue-grey, normally one artistic pixel thick. Interior shadows use a related muted tone rather than black. Light always comes from the upper left, producing a narrow light top plane and a restrained darker lower/right plane.

The camera is orthographic frontal-top. Buildings and upright street furniture face the screen with vertical verticals and horizontal levels; only a shallow top surface is visible. Road vehicles use a consistent near-top orthographic road view: their roof, windscreens and hood are readable, but no cinematic perspective or foreshortened vanishing point is allowed. Trees use a front-facing trunk with a shallow top-lit crown, not a flat icon and not an isometric tree.

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

## Vehicle gate

- Passenger vehicles use exactly `16x8 px` horizontal and `8x16 px` vertical runtime canvases.
- Draw both views independently as the same model: matching roof color, window rhythm, hood/trunk proportions, lights, and defining cue.
- Keep one transparent pixel of visual breathing room where possible; do not make the car appear to scrape the curb.
- The horizontal silhouette must occupy at least `13x6 px`; the vertical silhouette at least `6x13 px`.
- Distinct models must differ structurally: compact, sedan, estate, taxi, van, pickup, electric hatch, or classic car. A color swap is not a model.
- Every model must have a unique full RGBA drawing and a visibly different source-level body/roof/cargo structure. The reviewed contact sheet is the silhouette gate: tiny runtime cars may share the same safe lane envelope, so an alpha-bounds hash alone is not proof of diversity.

## Transit-stop gate

- Horizontal and vertical stops are separately authored and clearly depict the same system.
- A stop needs a roof/top plane, two or more supports, a readable waiting zone or bench, and a small color-coded stop marker without text.
- The shelter must not contain baked asphalt, road, grass, or a full pavement slab.
- Use a `24x16 px` horizontal canvas with `3x1` footprint and a `16x24 px` vertical canvas with `1x3` footprint for new shelters.

## Playground and park-object gate

- Playground compositions use transparent `24x16`, `24x24`, or `32x24 px` canvases and show at least two connected play functions.
- Equipment must have plausible supports, access and landing space. Reject floating slides, disconnected ladders, impossible bars, or a toy-like icon pile.
- Large park objects use their manifest footprint without baked terrain. Water is permitted only inside a pond or fountain basin.
- Produce materially distinct park families: civic formal, neighbourhood, botanical, natural grove, and recreation. Vary path geometry and prop composition, not merely color.

## Tree gate

- Standard trees use `8x16 px`; signature/large trees may use `16x24 px` with explicit footprint.
- The trunk must reach the bottom anchor. The crown must use readable clustered masses with at least three tones: outline/shadow, body, upper-left highlight.
- Species differ by silhouette as well as color: columnar, conical, umbrella, weeping, round, spreading, multi-stem, or sparse/deadwood.
- Do not bake grass or a circular ground shadow into the tree.
- Reject crowns made from one flat blob, random confetti pixels, symmetric lollipops, or foliage that merges into an unreadable square at `1x`.

## AI-authored source workflow

1. Generate one coherent asset family per request on flat `#ff00ff` chroma.
2. State exact cell order, runtime size, direction, semantic cue, and negative constraints in every prompt.
3. Pause `2–5 s` after each completed request.
4. Inspect the source at original scale before copying it into `reference/ai-authored/`.
5. Normalize with aspect preservation, hard alpha, bottom-centre anchoring, and at most 28 opaque colors. Never redraw accepted geometry procedurally.
6. Register `artSource: AI_AUTHORED`, `sourceSheet`, and a style profile in the manifest.
7. Render native and nearest-neighbour `8x` family contact sheets. Check silhouettes, paired directions, footprint isolation, and semantic readability.
8. Run both asset audits. Any style-contract error blocks shipping; do not whitelist an incompatible visual.
