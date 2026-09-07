# Long gallery — authored family frozen, integration owned by parent

## Final source-family freeze

All three independent AI stages are accepted by the parent at native/8× scale;
the complete sequence was also inspected. `--require-complete --require-review`
passes with no errors. The family-specific opening audit passes all three3×3
doors/5×5 frames and50 remaining apertures (stage3:10, stage4:20, stage5:20).
The36 combined CLI/published-frame regression tests pass. Global catalog,
shape-list, runtime/public files and the global asset build were not modified
or run by this art subtask.

| Stage | Source SHA256 | Normalized SHA256 |
| --- | --- | --- |
|3|`38ff5e1f8d1282e9f7cfcddb8f54ee044a897ca45c3694a1ade1ba99f859b9c2`|`6eb74e25e2fd8bb79430676ba49244188f6f688681ad0385c917d57267173b7e`|
|4|`ec7cb49787412048a4feb909b16c5c9ec037b625549e3c43fe41b1c06a1cd572`|`f51d320ae26a5964f5fe48b7255c471d59da1c5ab3bdca78dd585fcd047e1fc1`|
|5|`c3a8ca83de401e40ee0a2670757d86badb2036a8bec1e4b4e2b7d0e9d690ca4e`|`98f6233bee2f1cdc466d5123fb2fff82e220ce044ecae64a749ba045bfc33d72`|

Frozen geometry:96×48 canvas/12×6 cells, anchor48,48, south offset6, occupied96×47.
Door centre47 is the accepted1px offset. All foundation masks on rows46/47 are
identical (zero difference/drift). Roof coverage is visually0→53→100%; room-wall
thickness and some pane widths vary by at most1px, not exact architectural pixel
identity. `catalog-entry.proposed.json` provides source references and proposed
HOUSE semantics; integration and rarity policy remain the parent's decision.

## Stage5 acceptance after non-destructive shared-frame sampling

2026-09-07. Source H is unchanged. The parent independently accepted native/8×
candidate `98f6233bee2f1cdc466d5123fb2fff82e220ce044ecae64a749ba045bfc33d72`:
one declared common frame `[77,52,1697,841]` adds only5 source background pixels
below the tight bounds. Uniform scale and nearest-neighbour produce96×47 at0,1
inside the96×48 canvas. All20 windows are2–3×2, roof38px, facade9px, floorstep5px,
door3×3/frame5×5 with the existing1px cream threshold. Both foundation rows46/47
are fully opaque. The normalizer now validates this explicit optional frame;
it cannot crop stage5 pixels or add more than2% per side, and all stages share it.

Verification:27/27 focused CLI tests passed, including rejected crops, invalid
coordinates and excessive/out-of-canvas margins. All23 registered default
families were separately normalized in disposable copies:69/69 PNGs remained
byte-identical. This family's `--require-review` stage5 run reproduced the
approved hash above. At that checkpoint the family remained draft pending4/3;
their subsequent approvals are now recorded. No global asset build was run.

The following earlier diagnostic history is retained; its original tight-frame
window rejection is superseded by the explicitly accepted common-frame result.

Stage4B is now independently accepted: approximately53% roof, dark2–3×2 windows,
same3×3 leaf/5×5 portal and unchanged foundation. Stage4A is retained as a rejected
38%-roof/glazed draft. Stage3A is independently accepted: roofless with partial
front masonry, full opaque rooms and internal materials.

For stage3 exterior dark-magenta noise, the family now declares the existing
`magenta-chroma-family` key. Read-only comparison proved this changes zero
native pixels and zero PNG bytes for all three stages. The final stage5 visible
source bounds under this key are `[78,52,1697,835]`; the locked declared frame
remains `[77,52,1697,841]` (1px left and6px bottom background margin). This is the
same frame originally diagnosed as a5px extension under the narrow key, not
a further sampling adjustment. No interior fill or source-image repaint was used.

## Historical checkpoint before common-frame sampling

2026-09-07. At this point only this draft directory was modified; no global catalog, runtime,
shared shape list or publisher changes. Stage4/3 have deliberately NOT been
derived from a failing stage5. Existing23 registered families remain unchanged.

## Best retained source H

- Source: `sources/stage-5.png`, SHA256 `c3a8ca83de401e40ee0a2670757d86badb2036a8bec1e4b4e2b7d0e9d690ca4e`.
- Native: `normalized/stage-5.png`, SHA256 `4f7e34358aece5fe47f29a5a576297f6bead5f0b74f56d5972fc7633575f7c5c`.
- Canvas96×48, physical12×6 cells, bottomcentre48,48.
- Common source frame `[77,52,1697,836]` on1774×887 source; NN target96×46 at0,2.
- Door leaf `[46,45,49,48)` =3×3; cream frame `[45,43,50,48)` =5×5.
  Open bottom and two-pixel lintel, matching the ordinary wide entry convention.
  Door centre47 vs canvas48 is the existing one-pixel tolerated offset.
- Roof rows2–38 =37; facade39–47 =9; pane-row pitch5.
- 31 colors, hard alpha, no enclosed transparent holes.
- Parent independently accepted this architecture/camera and door1px offset,
  but requested checking the upper window panes before proceeding.

**Confirmed blocker:** all upper panes have only one teal row at y40.
For example `[5,40,7,41)` =2×1, and `[23,40,26,41)` =3×1.
The y41 pixels are sandstone sills, not glass. Therefore this source does NOT
meet immutable window2–3×2 and has no final visual approval.
The generic shape normalizer returns no geometry errors, but that is NOT
semantic acceptance. `measure-openings.py` now independently rejects these
window sizes; it reads pixels only and never modifies the image.

## Attempts and why they were rejected

All artwork came from built-in ImageGen, one source per request with pauses.
No architecture was painted, stretched or repaired in code. Allowed changes:
chroma extraction, shared-frame nearest-neighbour normalization, hard alpha,
MAXCOVERAGE palette reduction and an enlarged NN reference in attemptF.

| Attempt | Outcome |
|---|---|
| A fresh | Distinct ribbed side roofs + central gallery, but occupied96×39/camera too low. |
| B | Higher camera; fake checker background, still short. |
| C | Occupied96×46; door2×2/frame4×4. |
| D | Door3×3/frame5×4. |
| E | Threshold correction did not preserve a full5×5 frame. |
| F from native8x reference | True coarse reference, but model enlarged entry to6×7. |
| G | Local doorway shrink instead enlarged it; rejected. |
| H | Exact door/frame and accepted architecture; upper windows1px high. Best retained. |
| I | Asked upperglass depth; model also changed skylight, upper windows still1px. |
| J | Explicit facade strip; upper dark envelope3px, lowerglass1px. |
| K | Plain square apertures; bothrows only1px after normalization, doorregressed. |
| L | Upperglass2px, lowerglass3px, door2px high. |
| M | Asked onlylowerrowtrim; model also shortenedupperrow and enlargeddoor. Rejected. |

Prompts are in `PROMPTS.md` and `sources/stage-5-[B-M].prompt.txt`.
Rejected images copied in this folder are retained recoverably; all raw
generated originals remain in the Codex generated-images directory. No claim
that a draft or a passing bounding-box check fulfils the three-stage family.

## Historical remaining work before common-frame sampling

Obtain a stage5 source that preserves the accepted massing, exact entry, and
both rows of2–3×2 windows simultaneously. Independent native/8× review and
then stage5→4→3, commonframe masks/hashes, complete review and root-controlled
publication remain required. No window exception has been authorized.
