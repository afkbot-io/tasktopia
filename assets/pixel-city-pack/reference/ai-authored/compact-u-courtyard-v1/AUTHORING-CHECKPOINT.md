# U courtyard — reverse-stage checkpoint

2026-09-07. Separate stages5H/4G/3A and the complete sequence independently
accepted. Unpublished,
no runtime catalog registration. All source attempts and exact prompts retained.

The best candidate is H: actual U-plan open north, full-width south main bar,
two roof wings, and an opaque attached court. Teal/sandstone/terracotta identity
is distinct from the Lfamily. Geometry was frozen before source generation.

The stage5-only canonical verifier returned errors[] for H with the independently accepted
sharedframe[46,25,1501,974]: native96x64, occupied95x63, physical12x8, anchor48,64,
southoffset6,32colors, alpha0/255,0holes and0drift.
Header/front boundary is row53; two frontage floors use pane rows55–56 and59–60
(4pixel pitch, inside frozen4–6); front depth11. The entry is exact frame
[45,59,50,64] and leaf[46,60,49,63], with1pixel header and threshold. Foundation
rows62/63are opaque across the95pixel physical silhouette. No tolerances were
enlarged to fit failed drafts. The final column is transparent, within1pxdrift.

H source SHA256:
`2aa115e5c9384e61efe57827f65c5499197dea1122f9d8456859ef000dedd1c6`.
H normalized SHA256:
`394021ea3d037d63c586a819a205261d5f9936cffb4ff8ee07cba6ed099284b1`.

## Background gate history — resolved by approved common frame

Before the accepted frame, one exterior red-magenta fringe pixel remained at native[71,17]. Its original
source sample[1122,275] is RGB144,27,80, a blend immediately outside the east
wing's terracotta edge. See `diagnostics/stage-5-H-east-edge-8x.png`, a nearest
neighbour crop of the untouched source used only for inspection. It is not
runtime art and has not been painted or used to generate any source.

The existing broader chroma mode was tested in a temporary Gfamily with the
original shared frame. It removed only exterior background components, but
did not remove all dark marks; therefore that G-candidate result was not adopted. Exact delta
evidence remains in`diagnostics/background-recovery.json`. No shared-normalizer
or palette threshold was changed. Targeted I did not solve the fringe and
was rejected. J's alpha-removal request produced an opaque checkerboard and
was rejected without canonical normalization.

Parent independently accepted the legal phase diagnostic:2sourcepixels outward
at TOP and10at RIGHT, no cropped opaque source and no changed key or architecture.
Exact evidence is in`diagnostics/common-frame-phase.json`. Pink is absent; the
quieter right-roof ribbing is an explicitly accepted native sampling variation.
This one frame is now frozen for all3stages. Parent authorized4then3derivation.

## Stage4 source cleanup and current gate

Attempts4A–E are retained but rejected. Existing broad-chroma recovery was
subsequently authorized for this draft family after the5H diagnostic proved
the accepted native PNG stays byte-identical:1966additional source-background
pixels removed, all exterior-connected, at most2sourcepixelsdeep, no enclosed
removal. This uses the existing normalizer mode, not a new threshold. The
stage4E diagnostic still failed because it retained a native purple fringe;
it is evidence only, never a published candidate.

Attempt4F was re-derived directly from accepted5H with frozen parapet edges.
Attempt4G corrected only the second top cap through AI source editing;
the sub-native leftward cap extension and slightly warmer room palette are
disclosed. Its numeric gate passes95×63, hardalpha/32colors,0holes/0drift,
same entry and foundation,17two-pixel-high front apertures. Approximately
half the roof remains over the WESTwing/leftSOUTHbar, no final roof objects,
with opaque EAST/SOUTHrooms and the original attached courtyard.

Current4G source:
`7919945cbef2b7ded72211b9ae3e71125da67b2590eba955aa503df3dc628d56`.
Current4G native:
`6550cf19d8709537333179f6436d0ee4e576d79260ae88fac36ba3d0b3e2fa27`.
Parent approved4G after its individual native/8x view, then approved3A and
the complete sequence. No further source edits are pending.

## Frozen complete source family

Stage3A preserves the full Ulot and opaque original courtyard, removes all
roofing, exposes meaningful broken partitions and a single lowerfront floor.
Its eight two-pixel-high lower windows are at60–61, one native pixel below
their4/5positions59–60; this allowed registration variation was explicitly
reviewed. Door frame[45,59,50,64]/leaf[46,60,49,63] and both foundationrows are
unchanged. Parent accepted the construction-appropriate dust/interior palette.

3A source:
`2c81a30f2f2564dfb9be2173c6706896abdbef0efd1d848a7d0f102ac5002cc4`.
3A native:
`3f559853437954d3fc7903a0c2ab079402ac3c02bd569e12ed71428b1be9308b`.

All three stages occupy95×63inside96×64, have32colors, hardalpha, zero
transparentholes, zero center/baseline/foundationmask drift and zero differing
foundation pixels. The full `--require-complete --require-review` command
completed with exit0/errors[]. `catalog-entry.proposed.json` is a proposal
only: HOUSE/RARE/STANDARD/STONE, estimates3/6, no service role. The parent owns
any later runtime shape, packing, catalog integration and publishing.

## Verification performed

`.venv-assets/bin/python scripts/verify-compact-building-art.py --family assets/pixel-city-pack/reference/ai-authored/compact-u-courtyard-v1 --require-complete --require-review`

Per-family normalization only; no global asset build, app build, browser,
database, catalog, immutable-shape or published-art changes.
