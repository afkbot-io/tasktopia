# Compact building art contract

The compact-city cutover replaces the old large building catalog. Its initial
family is `compact-apartment-v1`: a `48×48` sprite on a `6×6` physical lot of
`8×8` cells, bottom-centre anchor `[24,48]`, south entrance at offset `3`.
There is no fallback to the old 18-cell-wide buildings.

The seven approved structural geometry families below are independently
AI-authored, not scaled copies. The35 registered art families may share a
compatible physical envelope, but retain individual source and opening contracts.
Read each family's immutable `geometry.json` and hash-pinned
`visual-review.json` before generating or publishing:

| Family | Native canvas | Physical cells | Anchor | Floors / facade | Roof region | Door leaf / frame |
| --- | --- | --- | --- | --- | --- | --- |
| `compact-apartment-v1` | 48×48 | 6×6 | 24,48 | 3 / 15px | 30px | 4×3 / 7×5 |
| `compact-row-v1` | 48×24 | 6×3 | 24,24 | 1 / 5px | 17px | 4×4 / 6×5 |
| `compact-wide-v1` | 48×32 | 6×4 | 24,32 | 2 / 10px | 22px | 3×3 / 5×5 |
| `compact-long-gallery-v1` | 96×48 | 12×6 | 48,48 | 2 / 9px | 38px | 3×3 / 5×5 |
| `compact-corner-court-v1` | 64×64 | 8×8 | 32,64 | 2 / 11px | 53px | 3×3 / 5×5 |
| `compact-u-courtyard-v1` | 96×64 | 12×8 | 48,64 | 2 / 11px | 53px | 3×3 / 5×5 |
| `compact-long-slate-wing-v1` | 48×96 | 6×12 | 24,96 | 2 / 11px | 85px | 3×3 / 5×5 |

All use 8px cells and a south entrance: offset3 for apartment, row, wide and
vertical slate wing; offset6 for the long gallery and U court; offset4 for the
corner court. The row's occupied48×22 image
has an explicitly reviewed2px top clearance; the wide's occupied46×32 image
has1px clearance on both sides. Neither changes physical occupancy or anchor.
Openings use2×2 native panes with small grouped/sill silhouettes. The shared
door envelope is3–4px wide and3–4px high, frame5–7px wide and5px high; actual
per-family dimensions above are immutable, not a license to accept drift.
New row/wide colors are dusty beige, olive parallel bands, broad slate planes
and small dark teal openings, with a light warm roof rim and no black baseline.
The first apartment retains its previously approved muted terracotta identity.

The long gallery is a separately approved two-floor residential family
(`HOUSE`, `RARE`, `STANDARD`, estimates3/6, explicit `STONE` platform), not a
stretched apartment or a service-policy exception. Its 96×47 occupied art is
bottom-aligned inside96×48; the recorded doorway is within the accepted1px
registration tolerance. New V3 blocks may reserve its12×6 footprint plus the
same one-cell clearance and connected south access. Existing V2 geometry
vocabulary and persisted V3 `sitePlan` parcels are never regenerated when a
family is registered. Stages1/2 use the full12×6 procedural site; approved
sources3/4/5 are published byte-for-byte at96×48.

The corner court has an L-shaped roof/body inside an opaque8×8 rectangular
lot. Its northeast courtyard belongs to that building and is not free infill
space. All64cells and the one-cell construction envelope remain protected in
every stage. Its stages3/4/5 retain the same bottom foundation; stage4 keeps
approximately52%of the roof, while stage3 exposes rooms and partial masonry.
The ivory-library family is separately authored48×48 art using the existing
6×6 apartment envelope, not another physical shape. Its own3-floor4px rhythm
and31px roof/14px facade are pinned in its accepted review. A geometry alias
never overrides individual doorway/window measurements or source identity.

The U court reserves its complete12×8 rectangular lot, including the opaque
courtyard; it is not free infill. The vertical slate wing is independently
authored48×96 art on6×12 cells, not a rotated horizontal gallery. These shapes
extend the registry for new V3 plans only; the immutable V2 shape list remains
unchanged. The [extended-building integration checkpoint](COMPACT-EXTENDED-BUILDINGS-2026-09-07.md)
records all12 newly published families, per-family measurements and source/runtime
hashes without replacing their frozen geometry contracts.

The later R3 real-map gate completed48 cases and four100%-exact native-pixel
probes; an independent reviewer inspected21 saved frames. This evidence does
not change any geometry tolerance. The same checkpoint records the rejected
transition-covered PLANET capture and the subsequently passing scoped overview
recapture, whose three new images were independently reviewed. It is not
installed-PWA or production-release acceptance.

The user's high `45°` camera is an art convention, not an isometric rotation:
the rectangular roof edges and floor bands remain horizontal/vertical on
screen, and no side facade recedes diagonally. For the initial apartment, the complete roof region,
including its small parapet rim, occupies `28–34 px` of depth; the front wall
occupies `14–18 px`, with a `4–6 px` rhythm per
visible floor. Windows are two `2×2` panes; the approved single south door has
a `4×3` dark leaf inside a `7×5` cream portal. This is the measured compact
native-scale authority, superseding the initial approximate `4 px` door-height
target. Identity comes from the muted terracotta, cream, teal and slate palette,
not an external black outline. Small roof equipment follows the same camera.

Stage 5 is generated and checked first. Stage 4 is an edit of that exact
building, and stage 3 derives from stage4 while stage5 remains the immutable
source-frame authority (also include it when a corrective edit needs registration). Each stage is a
separate AI-authored source. Stage 4 keeps the shell, dark unfinished windows
and approximately half a roof, without final roof equipment. Stage 3 has no
roof and roughly half the masonry/structure, with rooms, low construction
walls and material piles visible inside. Floor space is opaque and shaded;
transparent cutouts must not turn interior rooms into holes through the world.

The construction percentage describes assembled structure, not opaque image
height. A high-view roofless building retains the original floor depth and
full physical lot. The old validator's stage-3 height ratio is therefore not
applicable to this new contract. Sidewalk, external fence, scenery and progress
UI remain outside the authored layer. Stages 0–2 are composed by runtime from
the slot mask and shared construction elements.

`scripts/verify-compact-building-art.py` applies one shared stage-5 authoring
frame to every source and performs only aspect-preserving nearest-neighbour
normalization, hard-alpha conversion and palette quantization. It rejects
missing transparency, wrong canvas, registration drift, duplicate stages and
excessive palette size. It compares the actual opacity mask of the two shared
foundation rows, so an inset structural wall cannot pass merely because a
roof or scaffold widens the outer bounding box. Mask registration permits at
most one native pixel of drift and records the actual differing pixel count;
it does not label a tolerated one-pixel inset as exact identity. Its report distinguishes measured raster checks from
the required semantic visual review: camera, room walls, roof coverage,
entrance alignment, construction state and matching identity.

Without `commonSourceFrame`, the verifier retains the historical tight stage-5
visible bounds. An optional single `[left, top, right, bottom]` frame in
`geometry.json` applies to all three stages. Its four safe integer coordinates
must form a non-empty rectangle inside the source canvas, fully contain the
stage-5 visible bounds, and add at most 2% of the visible width or height on
each respective side. It never permits opaque cropping or independent X/Y
scaling. The published-pack audit requires this explicit frame to match
`report.commonSourceFrame` exactly; a missing, malformed or stale report frame
fails even when PNG hashes and visual approvals still match. Changing the
declaration therefore requires source verification again, not a manual report
edit. Families without an explicit declaration keep their existing behavior.

`paletteMethod` is explicit per family: `MEDIANCUT` remains the default for
existing reviewed art; `MAXCOVERAGE` is available when rare glass/material
accents disappear under median-cut. Both are bounded to the same32-color
budget and apply to all3 authored stages. Changing the method invalidates
the runtime-hash review: inspect every normalized stage again. Never use
palette selection as permission to paint new windows or alter geometry.

The projection review records the open primary roof plane separately from the
whole roof region. A rim never substitutes for a visible broad roof surface;
the first family has a measured `25 px` open plane inside its `30 px` region.

The built-in image generator's initial transparent source produced roof holes,
and its correction painted an opaque checkerboard. Both failed the verifier.
The accepted workflow therefore uses the explicit `magenta-recovery` source
background: remove only saturated magenta (`R,B > 180`, `G < 100`) before
normalization. No interior roof/floor opacity is repaired by code. The audit
rejects any enclosed transparent pixels, including holes in dark room floors.
For backgrounds with dark magenta noise, the already-supported explicit
`magenta-chroma-family` mode keys the reserved hue family instead of a fixed
brightness cutoff. Magenta cannot be an architectural material in that mode.
It does not relax the shared-frame or foundation checks.

All three normalized outputs must be inspected separately at native scale and
nearest-neighbour zoom before publishing. The three source hashes and review
must accompany the runtime assets; a montage is review evidence, not a runtime
asset. A future taller family extends facade height using the same floor
rhythm and anchor rather than stretching the bitmap.

`npm run assets:compact:verify` audits every catalog-registered family; use
`--family <directory>` for an unregistered draft. The publisher reads the
reviewed catalog, validates each geometry/provenance, copies normalized3–5
bytes unchanged, and makes aspect-preserving1–2 thumbnails at each native
canvas size. The real map composes the full fence/site separately. Never
publish draft sources or retire a catalog-registered family during a build.

Source verification and the standalone published-pack audit share
`audit_compact_projection()` for recorded visual measurements. Both reject
contradictory door/frame dimensions, roof/facade/floor rhythm, family identity
and unaccepted camera/baseline assertions even when PNG hashes still match.
This validates the review record against geometry; it does not measure a
camera angle or doorway automatically from the raster.

The publisher's five-stage review sheet allocates columns and rows from actual
native canvases, without resizing them. Horizontal and vertical long drafts
must not be clipped or paint over adjacent rows. Supporting a larger review
canvas is not approval to register an unreviewed building in the runtime.
