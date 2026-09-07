# Plum workshop: source correction 2026-09-07

Original stage5 remains unchanged until an independently reviewed source fits
the existing native48×48 /6×6cell geometry. Unique slate roof, two raised square
roof lanterns, plum facade and three floor bands must remain identifiable.

Original source SHA256 `a15d2b5fa72ac00ee2b61953e822369fe5bc6a84b580520786db09e116cded40`.
Original native SHA256 `83311902cf6a244f52eef22673475ea81b0bb6f87229596bf574a715e2247f41`.
Original frame `[135,106,1119,1108]`, target47×48, offset0,0. Roof approximately
34px/front14px already fit. Native aperture audit found mostly1px-high upper
windows, too-thin lower5pane groups and about5×3door leaf. Frozen target remains
window2–3×2, leaf4×3/frame7×5; it is not relaxed to fit the draft.

Source correctionA preserves architecture/camera and increases each upper/middle
pair's glassbody to2×2with a real1px divider; lower long windowgroups become
three2×2panes instead of five too-thin ones, with same windowband footprint.
Personnel leaf becomes4×3 in7×5 rectangular portal, same baseline/entrance.
Built-in ImageGen only, one stage per request; no geometry repaint by code.
No stage4/3 derived until independent stage5 native/8× approval; no publication.

## Bounded failures before approval

- A produced too-small2px-wide door and still1px-high top/middlepanes; lower
  mullions disappeared after NN, becoming continuous9px bars. Rejected.
- B grew the facade, remaining inside roof/front/occupied ranges, but leaf5×4
  and inconsistent1/2/3px window heights fail. Rejected.
- C requested only smaller leaf and uniform pane heights; actual corrections
  were insufficient. Rejected, never derived into reverse stages.
- D requested one added left jamb and header strip. Actual native leaf remains
  5×3 and some top/middle pairs merge or become1px-high. Rejected. Existing broad
  magenta recovery was needed in this diagnostic to remove dark reserved
  background variations; it is not installed into final family geometry.

Original stage5 source/native and its geometry remain unchanged. All A–D raw
sources and exact prompts are preserved. Source D SHA256
`07426e92c7a1fef17665e4e7b74d37aa84349cf7352f913143040cfc7645161b`;
native D diagnostic SHA256
`f5d872e697d31d1845ecfe9889f7d27ed68e60ea186cc2661cb7b35dd13514be`.

A bounded read-only diagnostic sampled3234 legal outward-only common frames
with per-side margins below2%, uniform NN and no cropped opaque pixels. None
simultaneously produced18validpanes and4×3leaf. This is not an exhaustive proof
that every legal frame fails; it is evidence against repeating the same draft
acceptance. No frame/geometry contract was changed to conceal failures.

Parent then approved a different opening layout correction E: one3×2pane in
each upper/middlebay instead of unreliable paired micro-mullions, while the
two lower3pane displaygroups and the two rooflanterns retain workshop identity.
Accepted garden source was a reference ONLY for doorway scale, not architecture.
E produced3×3leaf in5×4portal and oversized/slit upperpanes; it was rejected.
F used proportional width/height source correction, still retaining camera and
workshop identity. Its upperpanes remain inconsistent after normalization; no
approval or reverse-stage derivation follows. A second3234-frame diagnostic onF
also found no simultaneous12panes+4×3leaf pass.

E source SHA256 `4ddf44aec1a6ac9ef4a55658db7706798935a30db67abd5ae83c025304d7285b`.
F source SHA256 `f9798816d67d2c59870d2bf068945848e62932efdcd8cadd7c3703dcbfee1f2f`.
F tight-frame native SHA256 `97dda4eb34e7f32535d829ec439b8f2040c6019534790b276257aff67ac933f3`.
All six failed sources are preserved. No geometric tolerance is widened.

Parent approved one technically different attempt G: mechanicallyNN-enlarged
actual native F as the coarse visual input, with no opaque pixel changes. The
input-preparation script asserts hardalpha and exact opaqueRGB roundtrip, and
`source-preprocessing.json` records its hashes. Magenta replaces only fully
transparent pixels in this authoring reference; this is not a building repaint.

Actual ImageGen G references were `sources/input-native-f-16x.png` (768×768)
and the accepted garden's original native48×48 `normalized/stage-5.png` as a
doorway scale reference. A garden16× input was also prepared but NOT used in
that call; the provenance records this distinction. Output G is1254×1254,
not the requested768×768. The model redrew a different subpixel sampling grid:
upper outerbaypanes4×2, middle1pxhigh, lower panes partly1×2, leaf3×3. G is rejected,
not derived into4/3. Original final stage5 source/native/geometry remain unchanged.

G source SHA256 `997d06e21dc66aa1485d942e27fa435d09d44f91f5e7fcd3fd5bcf4baba5bd81`.
G native diagnostic SHA256 `22ddba3f73bd68d8fc22c8b3d548a01ccd064927ba69773e33ced6652030bd0e`.
No standalone whole-family complete/review gate is claimed for this draft.
# Geometry-first reconstruction H/I — 2026-09-07

Original A–G remain unapproved. Parent requested approved Garden geometry as the PRIMARY reference and original Plum as SECONDARY roof identity. All architecture is newly authored by built-in ImageGen; no opaque pixels were copied/stretched/repainted by code.

- H prompt: `sources/stage-5-reconstruction-h.prompt.txt`. References Garden source `963f90cdb5220a68b5c9a1813d6d5e57bc1898181733abc9f28214b41c65c484` and original Plum source `a15d2b5fa72ac00ee2b61953e822369fe5bc6a84b580520786db09e116cded40`. Generated output `/Users/kikasnikita/.codex/generated_images/01a06e09-3764-78c2-9a7d-04e761ff8311/exec-c74a2582-7b0f-4cf4-b7b4-49f22a859c85.png`; retained as `sources/candidate-stage-5-h.png`, SHA `9d7e858b67a55d8819eb42355649c3d7e8e72622c2f9c9786e6d5302ddfd2cad`. Default MAXCOVERAGE native `77ac14731c51ce6a04b9849e0e7e60c32f6470fa311a75b034b118078c331e37` has short windows. Its ONE justified bottom+10sourcepx frame fixed panes but removed last foundation row (`00e777e52e70c5ae99c1167707c0075dbd703f64eb8b41be6745cb1b96dd8c65`); **rejected**, no scan or contract change.
- I prompt: `sources/stage-5-reconstruction-i.prompt.txt`. Garden PRIMARY again and H SECONDARY roof identity; ventilation block must lie wholly inside the rear roof rim. Generated output `/Users/kikasnikita/.codex/generated_images/01a06e09-3764-78c2-9a7d-04e761ff8311/exec-0b074b71-ea27-4e0d-bb99-f4b722fb13c2.png`; retained as `sources/candidate-stage-5-i.png`, SHA `9a22c025bbb4f83f05a067045ec6e47b7cda6793b8629d23d11131819fb42492`. Its ONE justified outward frame `[140,201,1111,1087]` adds only4px bottom background, preserving all visible source bounds `[140,201,1111,1083]`; MAXCOVERAGE native `ed5dbcaee9240b1d09f9a372efb5490d6645f28e414e7e0a41521ea75859ac63`. All8 panes2×2, leaf4×3/frame7×5, foundation48px on both bottom rows pass the exact helper. `sources/i-frame-diagnostic.json` records before/after hashes and mathematical sampling rationale. No acceptance or reverse stage was claimed at this checkpoint; independent parent review pending.

The following sections retain earlier failed A–G history.
# Final frozen checkpoint

Parent independently APPROVED5I/4A/3G and fullsequence actualnative1x/8x. Exactreviewhashes in visual-review.json and AUTHORING-CHECKPOINT.md; fullsourcefamily frozen, not globallypublished bythisauthor. Earlier pendingapproval references below are historical. No newart after thischeckpoint.

# Reverse-stage provenance: 4A and stage3G

4A was independently accepted by the parent at native1x/8x. Its prompt is sources/stage-4.prompt.txt and sole reference was approved5I. Raw output exec-5811c342-5638-4087-bc4e-e59346e5e856.png; source c3648c04e8a20fdfeeba7ba70bf711475fc7a64ab2a2ebe453ad97de95e8a884; native50c0184cd9bd7ec0c3b278109a48f502e4ec04a68f10fe1d46912dee6f1f78bd. Left≈50%roof/right6opaque rooms, both lanterns/ribs/vent removed. Exact8 dark2x2 apertures and4x3leaf/7x5portal preserved; one warmdarkplum doorcolumn disclosed. Stage5 remains byte-identical.

All following outputs are under /Users/kikasnikita/.codex/generated_images/01a06e09-3764-78c2-9a7d-04e761ff8311/ and copied into this family's sources directory unchanged. Source prompts are saved in the same directory.

| Draft | Prompt | Raw output filename | Reference inputs |
| --- | --- | --- | --- |
| A1 | stage-3-intermediate-a1.prompt.txt | exec-9a229d44-4ee4-4b53-9f24-097d816f5cc9.png | approved4A |
| B1 | stage-3-intermediate-b1.prompt.txt | exec-aaad97ba-3823-4c5f-a944-ad30e2b82d39.png | approved4A primary, A1 construction only |
| B2 | stage-3-final-b2.prompt.txt | exec-1e1aa693-0d74-4ae2-8304-f19d17ac0d9d.png | B1 |
| C | stage-3-final-c.prompt.txt | exec-f54a7e52-cfe7-4ce2-becd-26b75f8193f1.png | approved4A primary, B2 construction only |
| D | stage-3-correction-d.prompt.txt | exec-7d69197e-c348-4a23-8bb6-98b578bde879.png | C primary, approved4A openings only |
| E | stage-3-correction-e.prompt.txt | exec-3fbc6bfd-5210-4033-bd46-3b6b930d9863.png | D |
| F | stage-3-final-f.prompt.txt | exec-36c56015-c6d9-4308-981a-3bdeea1fcc6d.png | approved4A primary, acceptedRose3D2 semantic only |
| G | stage-3-final-g.prompt.txt | exec-51ae87cb-14bf-41dc-bdcb-2c842fc47f5f.png | B1, only upperfront strip changed |

The long source-prompt strategy drifted. G instead restricted the actual edit to source y755–855 and explicitly locked everything below y870. This preserved all five lower native window ROIs and the doorway/foundation while removing the upper row.

| Draft | Source SHA256 | Native SHA256 / reason |
| --- | --- | --- |
| A1 | 494fd02f3d59cb752143b756cc4f2fa1a7089c3bb1e2facfb40e1a58a2deaf34 | b0ab71d40e63780ec2935e4bbf58b547658a848e79c040c9203131e7f625374b; anchor lifted1pixel, rejected |
| B1 | f7d3e1c5eb600be05c02d6c38b8cc69413ca1ce6552983fd8c01237b8d80c042 | 58409b8172b7fbea4867f32e00ad909bbc6cfb0b92993f1260b2c0391f6e2eee; deliberately complete3floor intermediate, not final3 |
| B2 | 7ea305ec01cc98ec2360a7be023891ea353a4cf107c54c7b5cb7cb3365f47547 | 67050a40a19154cfc81720fc969a2f2ca178fe01be9a7697432bc5c7a9f345cc; middlewindows moveddown and narrow openings, rejected |
| C | 2394a2b8b5ceadebf6046af160ab7fabdbd3786db91cf9b5be21370d8e4f596e | a44c30b2c0de71bd9df6a88283f81bc4fc32716b22825af70904d17f0d1b497a; real2x1 middlewindows and brownleftportaljamb, rejected |
| D | cc626129a29933ff288b39719beffdf617f704753b0a125f9bf0b5677e637742 | ca984317a73cab54d817948732c2c0b78d72d122475cec178dfd9d77b502b086; same1high actualmiddle openings, rejected |
| E | d9af638be20fe50731b3a260551be63079759a36db1e69404782f8d5f31abba9 | Raw rejected: movedmiddle windows bywhole storey and rebuiltupper wall; no normalization acceptance |
| F | 7e9ed5b6e1e870fbd293f093d3fc0bd43e81fca030f878dd452e7b6a3ac2d3b6 | Raw rejected: leftphysical floor becomesmagenta;8windows/full3facade remain |
| G | 1d4387f1a8ad766410943a6733fd77c08c4d14358257189e63f2c6a6ff756ab1 | 21bc4fdc03668b36f0031582628a54d19e92682d4250b6ad52058f285423622f; all5 panes2x2,portal/foundation pass, pending final independentreview |

No per-stage frame, recentering, opaque repaint, axis warp or new tolerance was used. The frozen5 commonframe normalizes every reverse stage. G source bounds extend20sourcepx above frame and12px left, within the existing1native-pixel stage allowance; this is disclosed rather than claiming pixel-identical masonry. Allactualnative centre/anchor/foundation masks are identical. Broad chroma recovery is the same pre-approved5I mode; sourcepalette31+transparent is unchanged.

Actual G opening surfaces are {21,15,11;32,29,28;58,53,47}, including a warmcharcoal reveal whose RGBspread11 should not be falsely excluded by a neutral-only color heuristic. The helper uses the explicit measured4+3 openingpalette while retaining all fixed geometry ROIs. Negative checks reject stage4 reusedas3 and the true1high C candidate. This is material classification, not a size/registration relaxation.

The remaining sections preserve historical stage5 draft checkpoints.
