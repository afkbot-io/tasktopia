# Garden house: bounded stage-5 correction

The original AI source remains preserved until a corrected finished source
passes independent review. Its unique roof garden and small upper-right access
hut must remain identifiable; this is not a palette swap of another house.

Original source SHA256:
`ed6131648cea945b1c651341289259a39e817e1ae8f7def6bae92664272115e5`.
Original native SHA256:
`e96a6d9cf31aeabe5e097e3f58a5bed93319c30dcea1a3c95f53f95d8466f626`.

Read-only initial audit: target44×48 at offset2,0 inside native48×48, source
frame135,89,1101,1149. Outer dimensions fit the existing contract. However
roofapproximately37px/frontapproximately11px, mostly one-pixel-high windows,
4×2leaf and about6×4portal do not. Existing contract remains roof28–34,
front14–18, floor4–6, panes2–3×2, leaf4×3/frame7×5.

The bounded correction redraws the source facade into three5px floors inside
the unchanged silhouette, moving the roof/front junction up about4nativepx.
Roof garden/access-hut identity and physical lot/camera remain unchanged.
Window bodies become separate2×2panes; source frame/leaf corrections are AI
authored, never repainted or stretched by normalization code. Flat muted
terracotta/olive/cream with contrasting teal prevents the tiny apertures being
lost to roof gradients during palette normalization.

Each source and native stage requires independent review before reverse
derivation5→4→3. No catalog registration or runtime publication is claimed.

## Corrective source history, 2026-09-07

All requests used built-in ImageGen, one whole stage per request. Exact
prompts are preserved beside the sources. Only source-authored architecture
was changed; normalization is mechanical. After independent D approval the
original was preserved as `sources/original-stage-5.png` and D installed.

- A: rejected; overcorrected approximately20px facade, occupied43×48 below
  width44 minimum, leaf5×4. Thin paired apertures collapse unpredictably.
- B: rejected; occupied44×48 fits but facade20px, floor pitch7/6,
  glass2×3 in upper/bottom rows and door4×4 still violate the contract.
- C: source correction used the accepted ivory library only as a proportion
  and camera reference, not copied architecture. Roof/front now fit, leaf4×3
  fits, but eight window bodies became1×1 and fail. Original garden/hut remain.
- D: window-only enlargement to40×40source-pixel bodies. Tight source-frame
  sampling still produced one-native-pixel rows. The permitted explicit common
  frame adds only4px background below the visible source: `[141,201,1111,1113]`
  versus visible `[141,201,1111,1109]`. No opaque source pixel is cropped;
  the margin is0.44% of visible height, below2%. One uniform transform yields
  all eight2×2panes,4×3leaf,7×5portal, and5/5floor pitch. No per-axis scaling,
  geometry repaint, or contract relaxation. Parent independently inspected
  native/8× and explicitly accepted these exact D source/runtime bytes.

Source A SHA256 `ef492b0f827ac84b722cad35abade52e22ff75e6c236b52ae5edb53da23a52d8`.
Source B SHA256 `25e5296bff4674db517f3df85c4103a34e21b92e3c8e10d9dde18317a10aa8e2`.
Source C SHA256 `91c7e2f89af4d11378e92e16f6d91b8a7bfd9101360333eca9f9d44a76d67379`.
Source D SHA256 `963f90cdb5220a68b5c9a1813d6d5e57bc1898181733abc9f28214b41c65c484`.
Candidate D native SHA256 `6345738ba36ae28cd77a46363b3cad7a0172c24d04af2edff1fecf7bf5ebe98d`.

The existing broad `magenta-chroma-family` recovery removes reserved background
compression shades. Existing `MAXCOVERAGE` palette quantization retains the small
teal apertures that `MEDIANCUT` lost to the large roof area. Neither operation
alters architecture. Candidate approval must refer to these exact final bytes.

## Reverse-stage derivation

Stage4 was derived from accepted5D using `stage-4-from-5d.prompt.txt`. Parent
independently approved exact source/runtime in `visual-review.json`: all garden
bed/hut/vegetation removed; LEFT half roof remains, RIGHT six rooms are open with
opaque floors and raised orthogonal partitions. Inclusive roof coverage is about
50% of the entire surface, not only the former open terracotta area. The shared
frame/palette mode and stage5 bytes remain unchanged.

Stage3 was derived from accepted4 with5 as an identity reference, then corrected
only in source through `stage-3-b/c/d.prompt.txt`:

- A rejected for trapezoid/leaning exterior walls, expanded footprint and door.
- B restored rectangular axes and exact surviving openings, but occupied45px
  height violated the unchanged stage3 maximum44. No contract relaxation.
- C removed the upper part of north coping, reaching occupied48×44 and keeping
  opaque physical rooms and foundation. Rejected for pink blended exterior edges.
- D restored the hard straight cream exterior strips. No pink edge samples
  remain; five surviving2×2lower window bodies and4×3leaf/7×5portal match exact
  stage5-native coordinates. All three top facade windows are absent and the
  upperfront masonry is visibly dismantled across the three bays. Roof coverage0.
  Native stage3 interior partitions vary by up to1px versus4; this is recorded,
  not claimed to be pixel-identical. External footprint/anchor/baseline and
  foundation alpha rows46/47 have zero drift. Parent independently accepted3D
  and full sequence after native/8× review. Source family is now frozen; no
  global registration, runtime publication or actual-world preview is claimed.

Family-local opening measurement distinguishes charcoal apertures from real
chromatic olive lintel shadows (example52,59,23). It does not mistake those
structural pixels for a surviving window. A negative diagnostic copying stage4
into stage3 still rejects all three complete upper apertures; real3D passes.
