# Plum workshop — complete source family frozen

Status: APPROVED_SOURCE_FAMILY_NOT_PUBLISHED. Parent independently approved5I,4A,3G at actualnative1x/8x and the whole sequence. No globalcatalog/publisher/runtime/public files were changed by this author. Actual-map integration remains the parent's separate gate.

Frozen geometry: native48x48, physical6x6 cells at8px, anchor24,48, southentrance3. Common source frame [140,201,1111,1087], MAXCOVERAGE/existing broadmagenta recovery, allocated/actualoccupied48x44 at0,4. Stage5roof28px/front16px, threefloors withpitch5/5. Eight exact2x2 windowpanes atx8/23/38,y33/38/43 (no lowestcenter), with upperthree removedin3. Exact4x3leaf [22,45,26,48), plain7x5portal [20,43,27,48). Both48pxfoundationrows46/47 fullyopaque inall3. All31colorpalettes, hardalpha,0holes,0centre/anchor/foundationmaskdrift.

| Stage | Source SHA256 | Native SHA256 |
| --- | --- | --- |
|3G|1d4387f1a8ad766410943a6733fd77c08c4d14358257189e63f2c6a6ff756ab1|21bc4fdc03668b36f0031582628a54d19e92682d4250b6ad52058f285423622f|
|4A|c3648c04e8a20fdfeeba7ba70bf711475fc7a64ab2a2ebe453ad97de95e8a884|50c0184cd9bd7ec0c3b278109a48f502e4ec04a68f10fe1d46912dee6f1f78bd|
|5I|9a22c025bbb4f83f05a067045ec6e47b7cda6793b8629d23d11131819fb42492|ed5dbcaee9240b1d09f9a372efb5490d6645f28e414e7e0a41521ea75859ac63|

Unique finishedarchitecture: two raised square cream-framed teal glazed lanterns, adjacent roofribs and a rearvent entirelyinside the slateroof, dustyplum facade.4 retains≈50%leftroof and opens6rightrooms, withoutany finishedroofgear.3 has12opaque roomfloors, raisedorthogonalpartitions/materials and a visiblymissing upperfront with columns, roof0. Survivinglowerfiveapertures andportal stayfixed.

Honest variation: stage3sourcebounds [128,181,1113,1085] extend20sourcepx above the sharedframe and12px left, within the existing1native-pixel stageallowance. Actualnative occupancy/centre/foundation unchanged; the brokennorthperimeter and roommasonry are not pixelidentical acrossstages. The fixed5frame is never independently adjusted. Stage4leftdoorleafcolumn is warmdarkplum, accepted with the same4x3 opening. Stage3openingpalette includes warmcharcoal58,53,47; explicit measuredpalette selection prevents mistaking plumwalls for openings and does not relax geometry.

The only chosen5I outwardmargin adds4sourcepx bottombackground, fullycontains5visiblebounds, below2%. Detailedbefore/afterproof: sources/i-frame-diagnostic.json. H's different soleframe failedanchor and was rejected. No frame scans, opaque repaint, per-axis warp or independentstage registration were used in this reconstruction.

Verification:
- verify-compact-building-art.py --family assets/pixel-city-pack/reference/ai-authored/compact-plum-workshop-v1 --require-complete --require-review.
- measure-stage5-openings.py:8 exact2x2 tealpanes,4x3leaf/7x5frame/foundation.
- measure-reverse-registration.py:8/5 exactdarkpanes, fixeddoor/foundation, upperrowremoved.
- Negativecontrols reject complete4 reusedas3 and the actual1high C draft.
- Familyhelpers compile; scopedgitdiffcheck.

PROMPTS.md preserves allrawpaths, exactprompts, references, failedstage5A–H and stage3A1/B1/B2/C/D/E/F evidence. G is the localized upperfrontstrip edit of B1, not a repainted/compositedsprite. B1 is an intentionallycompletefacade roof-offintermediate, never approved3. catalog-entry.proposed.json is only a recommendedentry; root integrates serially.

## Historical unapproved5 checkpoint

The following text describes the earlier state before5I/4A/3G acceptance; references to unchangedoriginal/canonicalfiles and unapprovedfamily are historical, not current status.


The original48×48 stage5 draft and its geometry remain unchanged. Corrections
A–G are preserved with exact prompts under `sources/rejected-stage-5-*.png`.
None passes all actual native aperture/door requirements, so no visual-review
approval, stages4/3, proposed accepted catalog entry or runtime publication exists.
Do not treat a raster-only geometry report with `errors: []` as visual acceptance:
aperture geometry and semantic projection still require individual measurement.

The unchanged contract is6×6cells,48×48canvas, anchor24,48, south3;
roof28–34/front14–18, floor4–6, individualpanes2–3×2, leaf4×3/frame7×5.
The distinct plumfront/two raised rooflanterns identity remains in these drafts.

`PROMPTS.md` records exact failures and parents' approved corrective concepts.
Two bounded common-background-frame diagnostics (D and F,3234frames each) found
no simultaneous pane/door pass. This was not exhaustive and does not justify
changing the geometry contract. All framing/NN/palette diagnostics stay under
`tmp/long-building-art/diagnostics/`; accepted families are untouched.

G tried real nativeF enlarged16× byNN with zero opaqueRGB modifications, and
garden doorway reference. `prepare-coarse-reference.py` and
`source-preprocessing.json` preserve preprocessing provenance. G source remained
AI-authored, but resulting upperwindow/leaf dimensions still fail. It is a
rejected input experiment, not a new completed family or a code-painted sprite.

The preceding `compact-garden-house-v1` family is separately frozen and complete;
do not conflate its successful gates with this unfinished family.
