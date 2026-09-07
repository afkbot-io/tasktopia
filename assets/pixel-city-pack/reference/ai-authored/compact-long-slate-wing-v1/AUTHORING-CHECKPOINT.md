# Long slate wing: complete source family accepted, not published

2026-09-07. **Not registered or published.** A new north–south 6×12-cell
family, not a rotated or stretched existing house. Native canvas48×96,
occupied47×96, anchor24,96, centered south entrance within1px tolerance.

Final candidate F source:
`415a5d24cec09969854fe7b75148d1a7e3d3ff1722c70139d6b7f24e7141abb2`.
Native:
`f4124e03302d063f0e37e718a7c1ceb936d49bdb487b5755f7c6d7fce76c7551`.
Uniform source frame23,23,864,1751. No geometry repair or nonuniform scaling.

The author and independent layout agent inspected native/8× images and
native aperture colors. Finished-stage source accepted:

- facade rows85–95 (11px), floor pitch6px;
- upper window openings85–86 and lower91–92, each2–3pxwide and2pxhigh;
- door leaf22,92..25,95 (3×3), frame21,91..26,96 (5×5), one-pixel header/threshold;
- high frontal-top axis alignment, no receding side facade, three slate-roof
  skylights; hardalpha0/255,32colors, no interior transparent holes;
- F also brightened the lower glass and roof glazing. This is disclosed as
  an AI-authored palette change, not claimed to be a pixel-identical edit.

Candidates A–E were not published. The requested upper-window correction in E
had correct geometry but lost teal glass at native size; F restores it.
Earlier failed sources and prompts remain for provenance. Current approved
source is `sources/stage-5.png`; derive4 from it, then3 from approved4.

Runtime packing, all-stage source verification and actual-city review remain
required. This record does not approve an unfinished stage or a release.
# Reverse-stage4 approval

Stage4D is independently accepted by main and layout reviewer at native/8×:
source`287bbb63b6154dcbd14498f3828d008bcb7d84e6b30446fd0b976dcaf4870795`,
native`236a100abc1b960c7cbf95410fcfb550bd9b9c186ca8d3abcde458294bb86b1a`.
It retains approximately44%roof (visually roughlyhalf), with no finished
equipment and six opaque rooms/corridor. Upper openings86–87 and lower91–92
are2px high; the upper row is1px lower than5, within the accepted native
registration tolerance. Door leaf[22,92,25,95]/frame[21,91,26,96] are unchanged.
Occupied47×96, foundation alpha, baseline, center and hardalpha remain exact.
Darker warm-olive stage4frame material is accepted; exact masonry-color
identity is not claimed. A failed38%roof/upper3px; Bfailed upper3px; Cfixed
upperbutshranklowerwindows to1px. Allrejected sources are retained, unpublished.

Stage3 source derivation is now authorized; it must remain unapproved until
its own native measurement and independent review. Catalog integration awaits
allthree stages.

## Stage3 corrective attempts — not accepted

A/B retained two fully assembled frontage rows or incorrect openings. C has
the intended open-room/partial-wall/one-floor structure, but salmon exterior
pixels survive the existing declared magenta key. D/E clean the background
but narrow the footprint and leave the doorway below the full foundation:
their measured bottom-mask error is44pixels/maxrowwise21px, not an accepted
1px registration difference. F/G return different source canvases (876×1795
and875×1797 respectively), so the unchanged887×1774 source-canvas gate rejects
them before normalization. All these raw attempts are retained as rejected.
No per-stage crop, axis scaling, source recentering or mask relaxation is used.

The family-local aperture helper's frame-color check was corrected after an
independent pixel review of C: the two outer bottom portal corners are opaque
darker foundation masonry, not missing sandstone jambs. The actual full5px
header, side jambs and inner3px threshold retain their color checks, and both
outer bottom corners must be opaque. This does not approve C's background or
D/E's protruding doorway, and does not change any geometry tolerance.

H restores a continuous full-width bottom foundation (4 alpha differences,
max row drift1px), but its doorway leaf is only3×2; I returns an incompatible
source canvas and is rejected before normalization. J preserves887×1774canvas
and the valid full foundation but still leaves warm threshold masonry in
native leaf row94, so the leaf remains3×2. It is also rejected. SourceJ
`59df9c6dfeabdc15fedc6e0bbdca9472ed2d0c2edfbd0b50d629d37ed6aa05bb`,
nativeJ`1ba6c254b912fc3cff7a394718c55e6937801a12fbc348a5d18bb4e9397cc4dd`.
Canonical stage3 is a work-in-progress diagnostic, NOT approved or published.

K used J plus the complete approved4 image as doorway authority, but returned
886×1774 instead of887×1774. It is rejected before normalization. A diagnostic
only native preview also retained a two-row leaf; no padding or repair was used.
L1 restarted from approved4 with only the remaining roof removed, leaving the
full facade as an intermediate. It returned877×1794 and is likewise rejected
at the unchanged source-canvas gate. Its original and prompt are retained as
`sources/rejected-stage-3-l1.png` and `prompts/stage-3-l1.txt`. Neither candidate
was approved or published; canonical3 remains the rejected J diagnostic.

## Stage 3 M continuation — accepted by independent parent review

The source-only restart uses accepted 4D as the geometry authority, without
changing the source frame, geometry, key, normalization or aperture checker.
M1 removes only the remaining roof and preserves the two facade rows as an
explicit intermediate. It keeps the exact887×1774 source canvas and restores
the contracted3×3 door leaf/5×5 frame. One lower window is ragged, so M1 is
not a final stage3 and is retained as an intermediate.

M2 removes only the upper frontage from M1, using4D as a secondary registration
reference. It preserves the full ten-room opaque interior and corridor, with
no roof, lower front wall and partial upper posts. All six lower openings are
solid2–3×2 rectangles. The door leaf[22,92,25,95] and frame[21,91,26,96], including
threshold row95, pass the existing read-only aperture checker unchanged.

M2 source`99827c9855248f033ece14dd19a6f6566a71a6e28c1e5755f7e60665a54511e5`;
native`0c05fb4870dfd41a3ada9798a3dea157110353c963b5a99c6f108ff467cb9d3d`.
Sourcecanvas887×1774; occupied47×96;32colors;hardalpha0/255;zero enclosed holes,
center/baseline drift and foundation-mask differences. Source bounds
[24,22,861,1751] differ slightly from5 while the frozen transform and measured
native foundation remain unchanged. The native texture/palette is not claimed
to be pixel-identical to4.

Exact source references and prompts are in`stage-3-completion-provenance.json`;
opening measurements are in`stage-3-m2-openings.json`. Canonical stage3 holds
independently accepted M2, not a published runtime asset. The parent inspected
native1×/8× and the whole sequence, explicitly accepting the ten opaque
rooms/corridor, zero roof, reduced upper front, bottom floor, square
leaf/threshold and continuous foundation. No approval is inferred from numeric
results; all rejected J/K/L sources remain preserved.

## Frozen final handoff

`visual-review.json` pins the three approved source/native hashes and their
measured projection. `catalog-entry.proposed.json` proposes HOUSE / RARE /
STANDARD / STONE, estimates3/6 and no service role. This family has its own
6×12 physical envelope and48×96 canvas; its registration requires separate
packing/incremental/old-plan regression tests. Those integration gates and
actual-world review are not claimed complete by the source-family approval.

Verification from the integration worktree:

```sh
.venv-assets/bin/python scripts/verify-compact-building-art.py --family assets/pixel-city-pack/reference/ai-authored/compact-long-slate-wing-v1 --require-complete --require-review
.venv-assets/bin/python assets/pixel-city-pack/reference/ai-authored/compact-long-slate-wing-v1/measure-openings.py
```

Sources, geometry dimensions, source frame and normalization are frozen.
Only `authoringStatus` changed during finalization; no architectural pixels,
normalizer, runtime catalog or shared shape registry were changed.
