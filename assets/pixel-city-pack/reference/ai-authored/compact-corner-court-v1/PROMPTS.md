# Corner court — source prompts

2026-09-07. Built-in ImageGen, one finished stage5 source. Draft only; no
catalog/runtime registration or approval. Geometry was frozen before the first
request. Stages4/3 must wait for independent parent review of stage5.

## Stage5 A — new independent architecture

Use case: stylized-concept.
Asset: ONE finished Tasktopia cartoon pixel-art residential building, isolated
sprite, square canvas, genuinely transparent exterior background. Not a sheet,
not an icon, no lettering, numbers, UI, watermarks, checkerboard or scene.

Create genuinely new L-shaped architecture, not a recolor of a rectangular
house. Its tall WEST wing runs from the north edge to the front, and its SOUTH
bar runs across the entire front width. A recessed NORTH-EAST courtyard fills
the remaining space inside the overall square architectural lot. That attached
courtyard floor must be completely OPAQUE, shaded muted stone, without grass or
exterior paving. Transparent background occurs only OUTSIDE the square building
lot; no transparent roof or courtyard holes. Roof mass must unmistakably read L,
with the northeast court visibly lower than both roof wings.

Camera: very high frontal-top orthographic, Tasktopia high45 convention. Roof
and courtyard dominate the image. Every roof/floor/window edge is horizontal or
vertical on screen; zero diagonal perspective, no receding right/left side
facade, no isometric rotation. The viewer sees broad overhead roof planes and
only TWO shallow front facade floors across the bottom. The west roof wing is
about40% of the whole width; the south roof bar spans the entire width and joins
it. Coarse parallel ribbed slate planes, a few low square olive roof vents,
warm sandstone trim, dusty muted plum facade. Courtyard architectural floor is
quiet taupe/slate with sparse large square joints. Distinct silhouettes and roof
features, no trees, benches, people or decorative scatter.

Design as a true64x64-native-pixel game sprite enlarged with nearest-neighbour
square pixel clusters. The full physical lot is8x8gamecells; native cell8pixels.
The complete occupied square should be62–64nativepixels wide AND high and touch
the bottom baseline. Keep a small transparent margin around the source asset.
Do not make a shallow horizontal rectangle inside a square canvas. Its roof/
courtyard region extends52–55nativepixels vertically. The complete front wall is
only9–11nativepixels tall, TWO5pixel floors (not many storeys). Roof and courtyard
must occupy roughly84% of total image height, not50%.

The full-width south facade has one SMALL centered entrance, NOT an oversized
portal. At native64x64 the dark door leaf is exactly3pixels wide by3high inside
a sandstone frame exactly5wide by5high, including a one-pixel threshold. Door
centre at x32, frame meets the y64 ground baseline. Bottom foundation rows62/63
are solid across the full width. Upper and lower window panes are only2–3pixels
wide by2pixels high, simple teal rectangles with small warm sills, vertically
spaced at a5pixel floor pitch. The 3x3 leaf is about4.7% of total building width;
never enlarge the doorway to match roof vents or courtyard openings.

Style: coarse square cartoon pixel clusters, hard edges and hard alpha, muted
dusty plum/slate/sandstone/olive/teal palette, at most32opaque/transparent colors,
upper-left light, broad flat material planes and restrained parallel stripes.
No realism, gradients, noisy texture, antialiasing, soft shadows, thick black
outline or heavy black baseline. No external construction fence, road, grass,
ground slab beyond the architectural courtyard, cranes or construction tools.
Finished stage5 only. Return one square isolated building with real alpha.

## Stage5 B — correct the square-lot proportions

Image1 is the draft edit target, not an approved geometry authority yet. Keep
its L-shaped WEST wing plus full-width SOUTH bar, recessed opaque northeast
courtyard, dusty plum/sandstone/slate/olive palette, roof equipment identity,
axis-aligned high frontal-top camera and genuinely transparent exterior.

Correct one proportional failure: the occupied architectural lot must be a
SQUARE, not the current taller-than-wide rectangle. In the same1254x1254 source
canvas, redraw the building about1120sourcepixels wide AND1120high with small
even exterior margins. Do not stretch the old bitmap: enlarge the roof/courtyard
plan with fresh aligned pixel clusters. At native64x64 both occupied dimensions
must be62–64. Preserve a wide WEST roof wing and an unmistakable full-width
SOUTH roof bar; the northeast court is an attached opaque architectural floor,
not a transparent cutout or an external pavement surround.

Within that corrected square proportion, the two-floor front facade is only
10nativepixels TOTAL, with5pixel floor pitch. The roof/courtyard overhead region
extends54pixels, so the front wall occupies only16% of total height. Do not make
the facade12–16pixels. Keep the small centred south door: dark leaf3x3pixels,
warm frame5x5pixels including one-pixel threshold at the ground baseline;
front foundation rows62/63 are solid. Single simple teal window panes are
2–3pixels wide by2high, no four-pane miniature grids. Roof equipment stays
small/coarse. No diagonal perspective, receding side facade, black baseline,
antialiasing, new scenery, grass, fence, text or construction tools.

Return only the corrected finished stage5 sprite. Preserve genuine alpha
outside the architectural lot and keep the whole internal courtyard opaque.

## Stage5 C — redraw square proportions and recoverable background

Attempt B produced a fully opaque checkerboard and lost the two-floor reading.
It is retained as rejected source evidence, not used as the next reference.
The following edit references attempt A and explicitly requests chroma recovery.

+Edit the attached unapproved Tasktopia building draft. Keep this same new architecture and subdued color identity, but redraw it to correct the building proportions. Output ONE finished stage-5 sprite, not a sheet.

Make the WHOLE occupied silhouette as wide as it is tall: about 1120 pixels wide by 1120 pixels high in the square source canvas. Its final game-grid equivalent is 64 by 64 native pixels, occupied width 62–64 and occupied height 62–64. Increase the roof and attached-courtyard plan width; do not enlarge the facade vertically. No bitmap stretching.

Keep a true L-shaped roof: a WEST wing running the full north-to-south depth and a SOUTH bar running the full width, enclosing the recessed northeast architectural courtyard. Court floor is completely opaque stone attached to the building; no exterior pavement or surrounding ground. All roof, courtyard, facade and window lines parallel screen X/Y, no diagonally receding side wall or isometric camera. High frontal-top orthographic view, with enormous visible overhead roof/court and shallow front wall.

CRITICAL TWO FLOORS: the south front must clearly show TWO distinct horizontal rows of small teal windows, not one row. In a 64-pixel tall game sprite, the roof/courtyard part occupies rows 0–53. The TWO-floor south wall occupies rows 54–63 ONLY: upper storey rows54–58, lower storey rows59–63. Each floor is five pixels tall; teal panes are simple 2–3 by2 pixel rectangles. Tiny centered south door: leaf3 by3 pixels, sandstone frame5 by5, ending at the baseline. No huge portal. Foundation rows62 and63 solid across full width.

Use dusty muted plum facade, sandstone frame and edge bands, ribbed slate roof, small olive roof vents; coarse clean cartoon square pixels. Keep the west roof wing and south roof bar prominent and thick. No realistic noise, gradients, thin black outline, black baseline, external scenery, trees, fences, construction gear or text.

BACKGROUND: perfectly flat uniform bright key-magenta #FF00FF everywhere outside the sprite. This is a deliberate removable chroma background; do NOT generate checkerboards, white background, shadows on the background, alpha mockups, or magenta anywhere inside the actual building. The entire attached northeast courtyard remains opaque. Return the corrected single finished sprite.

## Stage5 D — surgical one-native-pixel entrance correction

+This is a surgical edit of the attached Tasktopia building sprite C. Preserve the entire image, exact occupied silhouette, source canvas, roof/courtyard geometry, roof equipment, floor rhythm, window positions, palette, hard square clusters and flat #FF00FF background. Do not redesign, rescale, crop, shift or repaint anything except the small centered front entrance.

ONE CORRECTION ONLY: the entrance at the bottom centre is one native game pixel too tall. At64x64 native resolution its existing sandstone frame occupies x29–33 and rows58–63 (five wide by six high); dark door leaf occupies x30–32 and rows59–62 (three wide by four high). Redraw it so the frame occupies x29–33 and rows59–63 (exactly5x5), and the dark door leaf occupies x30–32 and rows60–62 (exactly3x3). Leave the threshold on row63 exactly at the same foundation baseline. Fill only the old frame's top row58 with the SAME adjacent lower-storey dusty-plum wall. The top of the door thus moves downward one native pixel, while its bottom stays still. At this1254x1254 source resolution one native pixel is approximately17sourcepixels. Keep the width and horizontal centre unchanged.

Keep the two south-front floor rows, simple small teal windows, slate L roof, attached opaque northeast courtyard and ALL other architectural geometry precisely unchanged. The courtyard stays opaque. Exterior background stays perfectly flat bright #FF00FF, no checkerboard, shadow, alpha mockup or other background. Return ONE corrected finished sprite with this tiny door-height adjustment only.

## Stage5 E — one-pixel-thick door frame, no tiny portal details

D lost the top header after native sampling and did not retain a threshold;
it is rejected. This next edit again references C, with explicit coarse frame
thickness in source pixels. No normalizer or geometry change is permitted.

+Make one exact pixel-art entrance edit to this attached source C. Keep the roof, attached courtyard, silhouette, two floor rows, all windows, sourcecanvas1254x1254 and #FF00FF outside background unchanged. Do NOT redesign or rescale the building.

Replace ONLY the bottom central door with a SIMPLE COARSE5-by5 game-pixel square, not a realistic narrow portal. The building's own native pixel corresponds to approximately17 sourcepixels. Draw the door as a flat three-by-three dark wood square surrounded by one thick sandstone pixel on ALL FOUR sides. The dark square has NO fine panels, handles, holes, highlights or perspective. It must be exactly square, not tall. The top sandstone bar and bottom sandstone threshold must each be as thick as the left and right sandstone bars: about17sourcepixels, NOT a hairline. The complete outer square is85sourcepixels wide by84sourcepixels high.

Precise canvas guide: overall door frame spans x578..663 and y1078..1162. Its dark3x3 square spans x595..646 and y1095..1145. Therefore the TOP BAR fills y1078..1095, the BOTTOM THRESHOLD fills y1145..1162, the sidebars fill x578..595 and646..663. Replace the old higher frame strip y1061..1078 with matching dusty-plum wall. This keeps the foundation baseline at1162. No door details smaller than one17pixel square. The final game-resolution frame is5x5 and leaf3x3, centred on the same southern entry.

All of the rest of the image stays the same; no external slabs or fences, no changes to the transparent-key background, opaque courtyard or two-floor architecture. Return only the single edited finished sprite.

## Stage5 F — native-grid reference and exact square pattern

E enlarged the frame/leaf to6x6/4x4and is rejected. This edit references stable
source C as the target and normalized C only as its64x64scale guide.

+Edit only the central front door of image1. Image2 is the SAME building at its actual 64x64 game pixel size; use it to understand the precise scale, not as a second building. Keep ALL other geometry, all other color regions, the overall 64x64 occupied size and the #FF00FF source background from image1 unchanged.

The current door frame is FIVE game-pixels WIDE. Keep that exact width and exact horizontal position. Do not enlarge it sideways! Its current six-pixel height must become FIVE pixels: make the outside frame a SQUARE, width equals height. The door leaf inside must also be a SQUARE: THREE pixels wide equals THREE high. Baseline stays fixed at the bottom foundation. Move only the top of the old portal downward so the frame is no longer taller than its own width.

Render this one tiny entrance using this EXACT coarse5x5pixel pattern, each letter one uniform source square approximately17x17pixels:
SSSSS
SDDDS
SDDDS
SDDDS
SSSSS
S is one flat sandstone color, D is one flat dark wood color. NO bevel, no extra black border, no handle, no panels, no top overhang, no decoration, no fine subdivisions. The top and bottom S rows are the same one-pixel thickness as the S side columns. The lower S row aligns to the last foundation row; the D square ends one full pixel above the baseline. Replace the removed old topmost portal row with adjacent dusty-plum wall.

This is a tiny localized source edit: preserve the L roof, opaque court, two five-pixel floor rows, windows, roof vents and everything else. Return one source image, identical composition, not two images and not a diagram.

## Stage5 G — one missing dark-leaf row in F

F is5x4frame/3x2leaf. This corrective edit uses F, the localized door-edit
descendant of C, without treating it as accepted stage identity authority.

+Edit ONLY the tiny central south entrance in this attached unapproved source F (a door-only descendant of the original C architecture). Do not alter ANY other part of the image, its framing or dimensions.

The door is now slightly TOO SHORT, not too tall. It currently has5nativepixels width and4nativepixels height, with a3wide by2high dark leaf. Its width is already correct. Keep the exact same door width, horizontal centre, bottom threshold and foundation baseline. Make this door25% TALLER UPWARD ONLY: lift the top lintel by one native pixel (about17sourcepixels), insert one extra row into the dark leaf, leave the bottom threshold exactly where it is. Do not widen anything.

After the correction the existing FIVE-pixel-wide frame must also be FIVE pixels high, forming a perfect SQUARE. The dark leaf must be THREE wide by THREE high, also a perfect SQUARE. Retain the coarse flat pattern, one sandstone-pixel border on all four sides, no fine subdivisions. The header moves from native row60 to row59. The added dark row is row60; existing dark rows61,62stay. Threshold stays row63. In source coordinates the top of the door moves upward from about1090 to about1073, with all the rest of the building untouched.

Keep the same full building silhouette, roof vents, L roof, opaque courtyard, two front-floor window rows and flat magenta background. No redesign, no perspective change, no rescaling or cropping of the sprite. Return only the corrected single source.

## Stage4 A — retain west roof, expose south-bar rooms

Parent independently approved stage5G at exact source/native hashes before
this reverse-stage request. The immutable source G is the sole reference.

+Derive ONE stage4 construction sprite from image1, the independently approved finished stage5 of Tasktopia compact-corner-court-v1. Image1 is immutable geometry, camera, palette, floor grid and entrance authority. Preserve its exact1254x1254canvas, subject scale, source margins and fixed baseline. Do not move, shrink, rotate, stretch or re-center any part of the building.

Family:64x64native,8x8physical cells, anchor32,64, centered south entrance offset4. Occupied64x64. High roof-dominant frontal-top45orthographic; every edge parallel screenX/Y, no receding side facade. Two shallow front floors at5nativepixel pitch. The small south entry must stay at native frame x29..33,y59..63 (5x5), dark leaf x30..32,y60..62 (3x3), one-pixel header and threshold. Preserve that exact opening unchanged. Foundation rows62/63solid.

STAGE4ONLY: retain the outer L-shaped shell, WEST wing and full-width SOUTH bar with the ORIGINAL recessed northeast courtyard. Keep about HALF of the existing L-shaped ribbed slate roof: retain the tall WEST roof wing above the south-bar junction; REMOVE THE ROOF from the full-width SOUTH bar. That removed south roof exposes a row of unfinished rooms with fully opaque dusty gray/beige floor slabs, raised parallel interior partitions and a few very small brick stacks, boards or a toolbox. These rooms are inside the original south roof footprint, NOT an added forward annex. Keep the original northeast court as a separate untouched OPAQUE architectural courtyard, not a construction room and not roofed over.

Remove ALL SIX finished olive rooftop vents/equipment, including those on the retained WEST roof. The retained roof should be ribbed slate only. Every formerly teal window in both front rows and courtyard-facing walls becomes a DARK UNGLAZED unfinished opening at the exact same coordinates/size, not colored glass. Keep the low two-floor frontage, sandstone floor bands, plum structure and small centered entrance. Show unfinished surfaces without changing identity or full structural depth.

Background stays exactly flat #FF00FF outside the silhouette (recorded magenta-recovery mode); all rooms and the court stay opaque. No transparent floor holes, external fence, crane, ground, grass, pavement, people, lettering, shadows on the background or new scenery. Coarse square cartoon pixel clusters, muted existing palette, no realism/no noise/no black baseline. Output exactly one independent stage4source, not a comparison sheet.

## Stage3 A — roofless half-assembled L structure

Parent independently accepted stage4A at the exact source/native hashes before
this request. References are stage4A(primary), stage5G(registration authority).

+Derive ONLY stage3 from image1 (approved stage4). Image2 is the approved finished stage5, provided ONLY as immutable registration, silhouette, entrance and L-plan authority. Preserve exact1254x1254source canvas, subject size/margins and common finished-frame[89,86,1168,1161]. Never shrink the whole building to mean50percent construction.

Same compact-corner-court-v1:64x64native/8x8physical cells, anchor32,64, southentrance4. High roof-dominant orthographic frontal-top45, X/Y aligned floor and wall lines, no receding side facade. Full WEST wing north-to-south plus full-width SOUTH bar. The ORIGINAL NORTHEAST COURTYARD remains the same opaque attached courtyard and retains its original boundary; do not convert it into interior rooms or make it transparent.

STAGE3: remove ALL remaining slate WEST roof, leaving NO roofing anywhere and NO finished roof equipment. Show the west wing's fully OPAQUE floor slab with several open rooms divided by raised straight interior walls and partial masonry. Keep the five south-bar room divisions from4 at the same coordinates, with opaque floor slabs. Roughly HALF the walls and structural masonry are assembled; some partitions are low and incomplete and a few supports are standing. Preserve the entire floor-space rectangle and original L-plan:50percent structure does NOT mean half the image height, shortened floor depth or smaller footprint. The distant north end of the west wing remains at the same top source position.

The outer/front masonry should clearly be less completed than4, especially portions of the upper front storey, while retaining the existing post axes,5nativepixel floor rhythm, original footprint and fully opaque full-width foundation rows62/63. Keep the same small central south entrance EXACTLY: native frame[x29..33,y59..63]5x5, dark opening[x30..32,y60..62]3x3, with one-pixel header and bottom threshold, not shifted or enlarged. Missing upper-wall sections reveal opaque building interior, not background holes. Dark unfinished window axes remain aligned wherever masonry exists; no teal glazing.

A few coarse tiny brick stacks, wooden planks, bucket or tools sit INSIDE the west/south rooms. No crane or full construction-kit scene. Keep dusty plum masonry, warm sandstone footings and muted taupe/slate floor palette; square cartoon clusters and flat parallel wall bands. No external fence, pavement, terrain, people, shadows beyond the footprint, black baseline, diagonal perspective, realism, tiny noise or text. Background outside the sprite stays the same flat key-magenta #FF00FF; every interior floor and the original court remain opaque. Return one independent stage3source, not a sequence/sheet.

## Stage3 B — clean external magenta noise only

A retained a few bright background pixels after simple reserved-magenta
recovery. Do not broaden the key because genuine plum walls approach that hue.
This image edit changes only the external background at the source level.

+Clean ONLY the external chroma background of this unapproved Tasktopia stage3source. Preserve every building part, floor, wall, doorway, material pile and structural opening exactly unchanged, with the exact same1254x1254canvas, silhouette position and scale.

The external background currently contains unwanted dark/mottled magenta compression pixels near the silhouette. Replace ALL background outside the building with a truly UNIFORM solid RGB255,0,255 (#FF00FF). No variation, gradient, texture, shadow, edge halo, antialias fringe, violet pixel or dark pink contamination in the background. The only background color should be exactly full bright key-magenta. Make the boundary between background and building clean hard square pixel edges. Do not recolor the actual dusty-plum masonry or sandstone footings; only the external backdrop is being cleaned.

Keep the interior west-wing and south-bar room floors fully opaque. Keep the large original northeast courtyard fully opaque. Do not restore any roof, add equipment, close the partial walls, change the entrance, crop, recenter or enlarge the building. This is stage3, half-assembled L-shaped construction, and its architecture is already correct. No additional scenery or objects. Return exactly one clean-background source image; no checkerboard or diagram.

## Stage3 C — actual alpha, preserve the opaque building

B still has two visible magenta edge contaminants after normalization. This
ImageGen edit asks for true alpha, keeping the existing recovery mode and
all approved geometry unchanged. No code color/alpha repair is allowed.

+Remove ONLY the magenta background from this exact attached building source and return REAL TRANSPARENT ALPHA outside the building. Preserve all of the building pixels, its exact1254x1254canvas, current margins, occupied width/height, structure, opaque floor slabs, original northeast opaque courtyard, entrance and foundation baseline. No redesign or repositioning.

The entire exterior should be alpha0, not a white or checkerboard drawing. This is genuine PNG cutout transparency, not a depiction of transparency. Remove all magenta/pink edge halo, including two tiny magenta spots just outside the top of the west/court boundary and outside the west wall near the south-wing junction. Preserve the dusty-plum actual masonry: do not erase wall material, floor or court. Exterior-only background removal, with crisp hard square edges. All inner floors and original court must stay fully opaque; openings through partial walls reveal the underlying opaque slab where appropriate.

Keep this exact stage3 roofless L-shaped structure, west room partitions, five south-bar rooms, two-floor structural axes and tiny centered entrance. No roof, new objects, scene, labels, shadows outside the building or compositing. Return one source PNG with actual transparent background.
