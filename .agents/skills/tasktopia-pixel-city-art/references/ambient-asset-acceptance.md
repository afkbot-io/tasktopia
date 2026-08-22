# Ambient asset style and acceptance

Use this contract for vehicles, transit stops, residents, micromobility, playgrounds, park objects, trees, shrubs, animals, boats, and similar finished props.

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

- Passenger vehicles use exactly three authored runtime views: `16x8 px` horizontal/east, `8x16 px` north/rear, and `8x16 px` south/front. West is rendered only by mirroring the east view.
- The horizontal source view faces `EAST` (front at the right): it exposes a shallow roof plane plus a distinct near-side body plane, with both wheels visible below the belt line. A roof-only bird's-eye silhouette is blocking.
- The north source view is a separately authored rear elevation: rear glass, tail lamps and trunk/hatch plane remain readable. The south source view is a separately authored front elevation: windscreen, headlights and grille/bumper remain readable. A roof-only plan view is blocking.
- Draw all three views independently as the same model: matching roof color, window rhythm, hood/trunk proportions, lights, and defining cue. North and south must visibly differ.
- Runtime may mirror the accepted east view for westbound travel only. It must never mirror north into south, rotate a side view, or synthesize either vertical direction.
- Keep one transparent pixel of visual breathing room where possible; do not make the car appear to scrape the curb.
- The horizontal silhouette must occupy at least `13x6 px`; both north and south silhouettes at least `6x13 px`.
- Distinct models must differ structurally: compact, sedan, estate, taxi, van, pickup, electric hatch, or classic car. A color swap is not a model.
- Every model must have a unique full RGBA drawing and a visibly different source-level body/roof/cargo structure. The reviewed contact sheet is the silhouette gate: tiny runtime cars may share the same safe lane envelope, so an alpha-bounds hash alone is not proof of diversity.
- City buses use the same three-view contract but occupy `48x16 px` horizontally and `16x48 px` vertically (`6x2` or `2x6` cells). Their opaque subject must occupy at least `44x14 px` horizontally and `13x44 px` north/south. The long roof, articulated window rhythm, front/rear lighting and two-cell width must remain readable at native `1x`. A short vehicle padded inside the large canvas is blocking. Buses run only on canonical three-cell roads.

## Transit-stop gate

- Horizontal and vertical road-axis stop placements are separately authored and clearly depict the same system.
- A stop needs a roof/top plane, two or more supports, a readable waiting zone or bench, and a small color-coded stop marker without text.
- The shelter must not contain baked asphalt, road, grass, or a full pavement slab.
- Use the canonical `16x16 px`, `2x2` boarding platform contract. Every stop pair sits outside opposite road edges and is offset along the road so shelters do not face each other in one cross-section.

## Resident and micromobility gate

- Moving residents use `16x24 px` canvases with a compact `6–12x16–18 px` opaque subject: separately authored north/rear, east and south/front views, each with three readable walk poses. The range is an envelope, not a per-frame resize target: all three frames keep one family scale, while the passing pose may be naturally narrower than the contact poses. West may mirror the accepted east cycle. Their feet share one bottom-centre anchor on the destination path cell; the playback loop is `A→B→C→B`, never a direct opposite-contact jump. A centred `8x8` icon, per-frame silhouette stretching, or a single bobbing frame is obsolete.
- Activity residents use the same `16x24 px` canvas and `16–18 px` upright body scale as walkers. A book, parcel, broom, phone, tool, or wave may widen the subject but must not shrink the head/body, create a fake second person, or add baked ground. A fisher's bent pose may occupy `8–10x12–14 px` while keeping the same part scale.
- Cyclists and scooter riders use three authored views like road vehicles: `24x24 px` horizontal/east and `16x24 px` north/rear and south/front. The visible rider-plus-vehicle bounds are `12–18x13–18 px` horizontally and `6–8x16–18 px` vertically. Runtime scale is exactly `1.0`; west mirrors only the accepted east view, and north/south are never rotations.
- The rider, helmet, handlebar/deck or bicycle frame must form one compact silhouette. Reject detached wheels, side-view riders paired with top-view equipment, or a vehicle without a visible rider.
- Runtime must swap the texture whenever direction changes, and apply a negative horizontal scale only for west. A sprite travelling feet-first, handlebar-first in reverse, or showing its rear while moving south is blocking.
- Micromobility uses pedestrian/path graphs at a low population cap; it must not be added to motor-traffic collision dimensions or spawned on road lanes.

## Playground and park-object gate

- Playground compositions use transparent `24x16`, `24x24`, or `32x24 px` canvases and show at least two connected play functions.
- Equipment must have plausible supports, access and landing space. Reject floating slides, disconnected ladders, impossible bars, or a toy-like icon pile.
- Large park objects use their manifest footprint without baked terrain. Water is permitted only inside a pond or fountain basin.
- Produce materially distinct park families: civic formal, neighbourhood, botanical, natural grove, and recreation. Vary path geometry and prop composition, not merely color.

## Tree gate

- Standard trees use exactly `16x32 px`, a `1x1` footprint and anchor `[8,32]`.
  The lower-centre `8x8 px` rectangle (`x=4..11`, `y=24..31`) is the planting
  cell. All opaque pixels in the two ground-contact rows `30..31` stay inside
  `x=4..11`, and the trunk/root reaches the final row. Crown pixels may overhang
  above that contact band because y-sorting is anchored at the trunk. Signature
  trees require a separate
  explicit contract; never silently reuse the standard profile at another size.
- The crown may overhang the planting cell only above the ground-contact band. It must use
  readable clustered masses with at least three tones: outline/shadow, body,
  upper-left highlight, plus a shallow top-lit plane matching the building
  camera rather than a flat circular side icon.
- Species differ by silhouette as well as color: columnar, conical, umbrella, weeping, round, spreading, multi-stem, or sparse/deadwood.
- Do not bake grass or a circular ground shadow into the tree.
- Reject crowns made from one flat blob, random confetti pixels, symmetric lollipops, or foliage that merges into an unreadable square at `1x`.
- Render every accepted tree on an actual `8x8` pavement grid at native `1x`
  and nearest-neighbour `4x`. Reject a tree whose ground contact appears to sit
  between cells, whose lower foliage covers neighbouring tiles, or whose camera
  differs from the approved building benchmark.

## AI-authored source workflow

1. Generate one coherent asset family per request on flat `#ff00ff` chroma.
2. State exact cell order, runtime size, direction, semantic cue, and negative constraints in every prompt.
3. Pause `2–5 s` after each completed request.
4. Inspect the source at original scale before copying it into `reference/ai-authored/`.
5. Normalize with aspect preservation, hard alpha, bottom-centre anchoring, and at most 28 opaque colors. Never redraw accepted geometry procedurally.
6. Register `artSource: AI_AUTHORED`, `sourceSheet`, and a style profile in the manifest.
7. Render native and nearest-neighbour `8x` family contact sheets. Check silhouettes, paired directions, footprint isolation, and semantic readability.
8. Run both asset audits. Any style-contract error blocks shipping; do not whitelist an incompatible visual.
9. For directional residents or micromobility, assert `baseFacing` in catalog metadata and test the runtime north/south/east/west mapping before visual QA.
