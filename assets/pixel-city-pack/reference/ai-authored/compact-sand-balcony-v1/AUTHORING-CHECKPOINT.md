# Sand balcony — complete source family frozen

Status: **APPROVED_SOURCE_FAMILY_NOT_PUBLISHED**. Parent independently approved stage5H4,4A,3A and the entire sequence at native1×/8×. Canonical sources, normalized PNGs and the frozen common frame are complete. The original source/native and all failed candidates remain recoverably preserved. Global catalog, runtime/public pack, publisher and actual-map validation belong to the parent; none was performed in this art slice.

Frozen stage5 authority: source `f8564996afceaa76935ab815b24ca3c8285db613bf49ef49de1dd96fc07af805`, native `84a7410435697185516442f344da3387ab2ac11cc0a767c81d3422b5f31218db`. Common frame `[127,155,1135,1069]`, broad magenta recovery, MEDIANCUT, native48×48/occupied47×44. Roof28/front16, floorpitch5/5,16 panes2–3×2, leaf4×3 `[22,45,26,48)`, flat frame7×5 `[20,43,27,48)`. All approvals and exact source/runtime hashes are recorded in `visual-review.json`.

`measure-stage5-openings.py` checks all16 finished opening envelopes and rejects prior H3's extra top row. `measure-reverse-registration.py` checks fixed entrance/portal/foundation and16/10 surviving dark-aperture ROIs; substituting stage4 as stage3 rejects all6 still-present upper windows. Reverse-stage shadow rims are not all one exact color, so this helper does not claim to measure their entire envelope automatically. Parent inspected those boundaries visually. One stage4 upper second-left opening widens2→3px/right+1px, explicitly disclosed within the original allowance. Stage3's new left room plan is not pixel-identical masonry; its high camera, full floor envelope and lower facade registration remain the same.

Stage4 source `23e253f14895d80c806505644ae8545981609364bb278f8db51dcf7df9ee8a27`, native `90d9a7281348afd50672943872b7ce5cdd90ebd6c67acafb401e243b6ad14902`: approximately51% left roof, six right opaque rooms, no final equipment.

Stage3 source `1f7debe239526f949bd4bc1560657742ba092f0ad68c06d8a7ba4bd0a9316066`, native `e1cc1a8bfb24ca20ef3982535768f8947ed1cd8f8f4fd88f06eea9aea3e538ad`: roof0%, upper6 windows/masonry removed,10 lower apertures retained, full opaque room floor and internal material piles. All stages have0 holes, hard alpha and0 foundation-mask difference; palettes5/4/3 are32/32/31 colors. Native centre/baseline drift0. North stage3 posts extend5 source pixels upward inside the frozen frame, without changing native bounds.

Current verification commands (family-only, no asset publication):

```sh
.venv-assets/bin/python scripts/verify-compact-building-art.py --family assets/pixel-city-pack/reference/ai-authored/compact-sand-balcony-v1 --require-complete --require-review
.venv-assets/bin/python assets/pixel-city-pack/reference/ai-authored/compact-sand-balcony-v1/measure-stage5-openings.py
.venv-assets/bin/python assets/pixel-city-pack/reference/ai-authored/compact-sand-balcony-v1/measure-reverse-registration.py
```

The historical sections below describe rejected intermediate states, not the current family or permission to derive from those drafts.

## Original draft — historical, superseded by approved H4

- Source SHA-256: `0d503f95702d25247833129e66e5a369c86dc818a99f16d82ea8f5e36fa3b11d`.
- Native SHA-256: `838da6a22f9b5a1625c9c7f72f46f2d14b074cfc680100150feb9bdbdc4995ed`.
- Physical footprint 6×6 cells at 8px, canvas 48×48, anchor (24,48), south offset 3.
- Occupied 48×44, roof depth 28px and facade height 16px, three floors at 5px pitch.
- Small facade openings and overwide personnel door fail the fixed window/door contract.

## One focused source correction

Candidate A preserves the recognizable inset balconies, central roof hut, skylight and sand/teal palette. It improves separation of the 16 windows, but its default native image still has a 5×4 leaf and some 3px-high middle windows. It is explicitly unapproved.

- Source: `sources/candidate-stage-5-a.png`.
- Source SHA-256: `56f789d13063b73d5860f2befe3097fb4f12ec102eedff72e278a72edc2a00d8`.
- Diagnostic native SHA-256: `bfd67a914e7953bf5c68f561af357868317136ae403b3725d0c273b268847426`.
- Default source frame: `[136,179,1118,1075]`; uniform scale `48/982`; target 48×44, offset (0,4).
- Diagnostic family: `tmp/long-building-art/diagnostics/sand-correction-a/`.
- Read-only frame search: `tmp/long-building-art/diagnostics/sand-frame-diagnostic.py`; no passing fully compliant frame in the bounded samples described in `PROMPTS.md`.

Do not publish or derive reverse stages from this candidate. A future source correction or genuinely different replacement remains necessary; no geometry contract was relaxed to mark this family complete.

## Closest candidate C — architecture accepted, portal rejected

Two parent-authorized local corrections after A repaired the leaf and window height. B is preserved but unapproved. C now measures16 panes2–3pxwide and2pxhigh, a4×3 leaf at `[22,45,26,48)`, roof28px/front16px, occupied48×44 and bottom anchor(24,48). The upper balcony panes occupy rows32–33 while the central upper panes occupy33–34; subsequent rows are38–39 and43–44. The floor rhythm stays within the existing4–6px contract.

The portal's rectangular body is7×5 at `[20,43,27,48)`, but the top cap projects one additional pixel to the right at(27,43), giving a total8px top silhouette. The parent independently accepted the architecture/camera but rejected this cap: it cannot be reclassified as a non-portal detail. C is not approved as a full stage; no reverse stages or catalog/publication changes exist.

- C source SHA: `a836d4f9d7e204e488eb2508bf7da2e397ccefb007ef187eb23dd8a68b1d77ed`.
- Default MEDIANCUT native SHA: `b7e72466026865836a14ac7850ff771c12b8954a365908ced7ec8e9f3f86b528`.
- C tight source frame `[133,172,1119,1073]`; uniform48/986, target48×44, offset(0,4).
- Evidence: `tmp/long-building-art/diagnostics/sand-correction-c/normalized/stage-5.png` and `previews/stage-5-grid-8x.png`.
- The alternate MAXCOVERAGE diagnostic improves glass contrast but introduces roof patching; it is unapproved and was not selected.
- Only single candidate normalizations were run after the parent requested CPU quiet; no additional frame searches.

## D/E local cap edit results

D still has the8px cap. E additionally damages the right jamb while leaving that cap. Both are preserved and explicitly rejected; hashes and exact source prompts are recorded in `PROMPTS.md`.

## F/G plain-frame correction results

Parent authorized replacing the whole decorative portal with a flat cream frame using intact C. F and its narrowly edited successor G remove the projecting cap and retain the correct4×3 leaf, but the resulting frame is only6×4 at `[21,44,27,48)`. G's requested one-pixel extension left/up did not occur. Both are rejected; the fixed7×5 contract remains unchanged. Sources and exact prompts are preserved, with hashes in `PROMPTS.md`. No reverse stages are authorized from these drafts and the original family authority remains untouched.

## H reference-crop and single-frame result

The parent-approved mechanical crop/NN reference uses accepted Garden doorway pixels only as an ImageGen reference, never composited into Sand. H gives an8×5 flat frame with its4×3 leaf. One explicitly authorized outward-only background frame corrects the portal to7×5, but makes both central-left windows1×2. That result is rejected. See `sources/h-frame-diagnostic.json` for exact before/after hashes and measurements. A source-only correction of these two panes remains possible but is not yet authored at this checkpoint. No complete family or approval is claimed.
