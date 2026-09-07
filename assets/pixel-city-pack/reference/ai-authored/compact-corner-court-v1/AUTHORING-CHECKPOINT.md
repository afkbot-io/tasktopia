# Corner-court stage5 draft

2026-09-07. **All3source stages independently approved; family not published.** Only this new
family directory is changed. There is no runtime/catalog/packing registration.
Finished5G, unfinished4A and structural3B are accepted at the exact hashes in
`visual-review.json`. A proposed catalog entry is prepared for parent integration.

Frozen intent: an8x8physical-cell,64x64native two-floor residential building;
full-depth west roof wing joined to a full-width south bar; an opaque attached
northeast court inside the lot. Muted plum/slate/sandstone/olive, axis-aligned
high frontal-top view. South entryoffset4, anchor32,64. Geometry was written
before the first source request and its dimensions have not been relaxed.

## Current candidate G

The seventh ImageGen source is copied unchanged to `sources/stage-5.png`.
Attempt A was too narrow; B painted a checkerboard instead of alpha and is
rejected. C explicitly requested a removable magenta background, so the family
records `sourceBackground: magenta-recovery`; later localized entrance edits
retain this background. That is the only normalization
setting changed after generation; no pixels were repainted or axes stretched.

The canonical per-family verifier exits0: occupied64x64, target64x64,31colors,
alpha0/255, zero transparent interior holes, zero centre/baseline drift.
Native and8x grid previews are in `normalized/stage-5.png` and
`previews/stage-5-grid-8x.png`; exact sources, prompts, hashes and rejected
attempts are retained in `provenance.json`, `PROMPTS.md` and `sources/`.

This numeric result is **not** independent semantic approval. The parent
inspected C at8x and accepted its L mass, opaque court, roof/facade direction
and5pxfloor rhythm, while keeping the incorrectly tall entrance RED. D lost
its thin header/threshold; E enlarged the entire door; F became one pixel too
short. These localized AI edits remain recorded as rejected candidates. G
corrects that missing row through ImageGen, not code painting or geometric
warping. Its observed frame now spans x29–33,y59–63(5x5), the leaf spans
x30–32,y60–62(3x3), and both foundation rows62/63remain fully opaque. The
header and threshold are each one native pixel tall. The roof/court+cornice
still ends at52, followed by an11px two-floor frontage53–63. The parent then
independently inspected Gnative/8x and explicitly accepted those exact source
and normalized hashes; the scoped decision is in`stage5-independent-review.json`.

The source frame is[89,86,1168,1161] with one uniform0.05931417979610751scale;
the resulting target is64x64 with zero offset. The accepted native G is now
immutable geometry authority for reverse stages. The measured
opening coordinates and actual source/native hashes are recorded in
`opening-observation.json`; the actual independent acceptance is the separate
stage5review, not the author observation.

## Stage4 A

Derived through ImageGen from approved stage5only, with the same source canvas
and the unchanged common stage5frame. Tall west roof remains, approximately
50–53%of the original Lroof; the full-width south bar opens into five rooms
with opaque floors, raised straight partitions and small internal materials.
The original northeast courtyard remains an attached court, not a room or
new roof area. Six finished roof vents are gone and all14apertures are dark.
Source/native hashes and generation provenance are in`provenance.json`.

Per-family verification exits0:64x64,31colors,hardalpha,0holes,0centre/baseline
drift. Read-only comparison finds0alpha differences across foundation rows62/63
versus5. Parent independently accepted the exact4hashes and authorized stage3;
the decision is recorded in`stage4-independent-review.json`. No global build.

## Stage3 and temporary background diagnostic

Stage3A derives from approved4with5as immutable registration reference. The
west roof is completely removed, exposing opaque rooms with half-assembled
partitions and internal materials. Existing south-bar rooms and original
northeast court remain. Partial frontal infill shows the construction state;
it does not shrink the building to half height. All-three geometric gates pass.

The simple key left three bright fringe pixels in A. AI background-only edit B
reduced this to two, but does not yet meet visual cleanliness. C requested true
alpha and instead returned a fully opaque painted checkerboard, so it is rejected.
No background noise was silently published and no code-painted repair was used.

Parent authorized a temporary diagnostic using the existing broad-magenta mode,
not a new threshold or shared-normalizer change. The original finished frame
[89,86,1168,1161] must be declared explicitly in that trial to preserve the exact
approved sampling transform; deriving a new tight frame would shift it by one
source pixel. With the original frame pinned, stage5native is byte-identical;
only the two stage3edge pixels and one stage4right-edge pixel change alpha.
Palette quantization also remaps135opaque pixels in3and55in4(max channel change
26/23). Source inspection finds all newly removed source components touching
the original transparent background, maximum thickness2sourcepixels, and no
enclosed removed components. Native court/door/foundation alpha is unchanged.
The parent inspected the before/after source contact, complete sequence and
diagnostic, accepted this exterior-only recovery and revised3/4native hashes,
and approved the entire5→4→3source sequence. The original common frame is now
explicit and the existing broad key is adopted in`geometry.json`; no shared
normalizer changed. Full exact native difference coordinates and source component
measurements are retained in`diagnostics/background-recovery.json` alongside
before/after sequence and high-resolution source-fringe contact.

## Verification performed

```sh
.venv-assets/bin/python scripts/verify-compact-building-art.py \
  --family assets/pixel-city-pack/reference/ai-authored/compact-corner-court-v1 \
  --require-complete --require-review
```

A: exit1, width57. C,D,E,F,G: exit0, general numeric gate only; their different
semantic outcomes are above. Read-only Pillow checks confirmed Balpha[255,255]
and inspected the native opening/foundation rows without changing any
image. No full asset/application build, browser, database, commit or deployment
was performed. The source sequence is accepted; catalog registration and
runtime integration remain separate parent-owned gates.

Final scoped verification above exits0,`report.errors=[]`,all3stages64x64,
31colors,alpha0/255,0holes,0centre/baseline/foundation drift,0foundation-mask
differences. Source/native hashes exactly match the independent review and
the proposed entry. JSON parsing and scoped`git diff --check`also pass.

Remaining parent-owned integration: register8x8shape and catalog proposal,
verify site/fence clearance and saved-layout stability, run coordinated assets
build/verify and actual map acceptance. This document does not claim those steps.
