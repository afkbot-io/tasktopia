# Sand balcony authoring

The original draft and all failed correction sources remain preserved. The parent has now approved stage5H4 and it is canonical as `sources/stage-5.png`; the original was moved recoverably to `sources/original-stage-5.png` (not deleted). Reverse-stage work follows the frozen H4 frame. The entries below document chronological attempts, not current approvals unless explicitly stated.

## Stage 5 correction A

Exact prompt: `sources/stage-5-correction-a.prompt.txt`. Built-in ImageGen source edit with the original `sources/stage-5.png` as the sole reference. Goal: retain the existing three-floor balcony architecture and camera while correcting the 16 small panes and the existing 4×3 leaf / 7×5 portal contract. The source, native normalization and visual evidence must be inspected before acceptance; a successful image-generation call is not approval.

Returned source: `candidate-stage-5-a.png`, SHA-256 `56f789d13063b73d5860f2befe3097fb4f12ec102eedff72e278a72edc2a00d8`. Original generated file retained at `/Users/kikasnikita/.codex/generated_images/01a06e09-3764-78c2-9a7d-04e761ff8311/exec-d53698fb-d104-4286-8190-70b287ca5142.png`.

**Unapproved / rejected for integration.** The default normalization retains 48×44 occupied pixels and the correct roof/facade proportions, but the middle window row can occupy 3 pixels in height and the leaf remains 5×4 instead of 4×3. The 16 windows are more clearly separated than in the original; this visual improvement does not clear the fixed numeric contract. No stage 4 or 3 has been derived.

A read-only legal-frame diagnostic first sampled 3,969 outward-only frames, then a focused 12,000 frames near the top-margin boundary. Neither sample found a simultaneous pass for occupied height ≥44, sixteen 2-pixel-high windows and a 4×3 leaf. Some 43-pixel-high candidates had acceptable openings but were rejected for violating the existing occupied-height contract. This is bounded diagnostic evidence, not a claim that every mathematically possible frame was exhausted. No opaque source pixels were cropped, repainted, stretched or independently rescaled.

## Stage 5 corrections B and C

Parent authorized two further genuinely local source corrections and stopped any further frame scans. B used candidate A as its sole reference; exact prompt `sources/stage-5-correction-b.prompt.txt`. It corrected the personnel leaf to4×3, but unexpectedly shortened the upper balcony windows too. B remains unapproved and preserved as `candidate-stage-5-b.png`, source SHA-256 `fd5147348d2358d66855f633adfd21f6a6aabb36bb58521ec13e264782dabba0`.

C used B as its sole reference; exact prompt `sources/stage-5-correction-c.prompt.txt`. It extended the twelve balcony panes while preserving the already-correct door. Source `candidate-stage-5-c.png`, SHA-256 `a836d4f9d7e204e488eb2508bf7da2e397ccefb007ef187eb23dd8a68b1d77ed`. Raw output retained at `/Users/kikasnikita/.codex/generated_images/01a06e09-3764-78c2-9a7d-04e761ff8311/exec-8f6dd63c-4f69-493b-8e25-1edbec687697.png`.

C default MEDIANCUT native SHA-256 `b7e72466026865836a14ac7850ff771c12b8954a365908ced7ec8e9f3f86b528`; tight frame `[133,172,1119,1073]`, target48×44 offset(0,4), all16 pane bodies2pxhigh and2–3pxwide, leaf4×3. Upper balcony pane rows32–33 differ by1px from central upper panes33–34; lower rows38–39 and43–44. Current unapproved detail: the7×5 portal body has an extra1px rightward top cap, so its complete top silhouette is8px wide, not an exact rectangular7×5. Parent independent review is required before accepting that architectural distinction or correcting it. No stage4/3 yet.

One MAXCOVERAGE diagnostic of the same C source was inspected (native SHA `8e0476e4a9fa613b3f4b83617cd9e7e74072bb02da1661853a66eaee2459d72f`): glass contrast improves but quantization makes the roof patchier. The diagnostic was restored to MEDIANCUT; neither variant is approved. Only individual normalizations were run after the parent performance-test CPU gate; no more multi-frame searches.

## Cap-only corrections D/E — both rejected

The parent independently accepted C's architecture/camera but explicitly rejected the8px complete portal cap; the cap cannot be reclassified away to claim a7px frame. Two local source edits were then attempted without any frame search.

- D exact prompt `sources/stage-5-correction-d.prompt.txt`, reference candidate C, source `candidate-stage-5-d.png`, SHA `d90a8308220ad94db9d81e41ac18aee4b49a4a8e2eef2ba96e0f4cccdd62f798`. The extra native cap pixel(27,43) remains. **Rejected**.
- E exact prompt `sources/stage-5-correction-e.prompt.txt`, reference candidate D, source `candidate-stage-5-e.png`, SHA `10ca55bb19b7f2aac3fa87a51f7c68ca0182ac79e5c239437dae0b92ece036ff`. ImageGen removed the right jamb at x26,y44–47 instead of only trimming the cap, and the cap pixel(27,43) still remains. **Rejected**; do not use this incomplete portal for reverse stages.

D/E required the existing broader `magenta-chroma-family` recovery because the standard absolute magenta threshold retained dark background dust. That mechanical recovery changes no visible architecture. Their tight-frame normalizations use `[134,172,1118,1072]`, target48×44 offset(0,4), no per-axis scaling. D native SHA `908c19c6454f10d545dbda86c96cedd572950f39c4f06c51c090b9ddd0787010`; E native SHA `ce5b830135129561397011f32deba13f697f51954da675e29bffc3033fa5ba2a`. Neither is approved; the original family authority remains unchanged.

## Whole flat-portal corrections F/G — both rejected

The parent authorized a genuinely different source edit: replace the decorative entrance with a simple flat cream rectangle rather than continue trimming a tiny cap. F used the intact candidate C, not damaged E. G used F and requested only one extra native column left and one extra native row above the flat frame. Exact prompts are `sources/stage-5-correction-f.prompt.txt` and `sources/stage-5-correction-g.prompt.txt`.

- F source SHA `7fb21ec46faaa38555e9f0f707b901cc7a0455375b9ee6a1c198b52dabd920f2`, native SHA `a1f6027f7741ab4e3ae6cd998f9c646d2b313e4fb8504a858ae8f830cb15db19`.
- G source SHA `22a116fc458cde7e6f3577752a9165fbdb69ced7ce60a85a4c7cd0b4c0fd196c`, native SHA `7fdfd6c3ccf663ffeb1621fe18f014455d83277aa1cd5265dab7c670e496bc63`.

Both remove the projecting cornice and preserve the4×3 leaf, but the plain frame is only6×4 at `[21,44,27,48)`, not the contracted7×5. The requested enlargement in G did not occur. Both remain unapproved. Individual default tight-frame normalizations only; no frame search, no geometry/contract changes, no reverse stages or publication.

## Accepted-door ROI reference, candidate H

The parent authorized a mechanical crop of the already accepted Garden native doorway as a second ImageGen scale reference. `prepare-portal-reference.py` crops `[18,41,29,50)` from Garden's48×48 native stage5: exactly2px context around the7×5 portal, with2 transparent rows below the source canvas. It uses nearest-neighbour64× enlargement to704×576 and verifies every original crop pixel plus a roundtrip. No opaque pixel is modified and nothing is composited into Sand. Exact paths and SHA-256 values are recorded in `sources/portal-reference-preprocessing.json`.

Candidate H uses full candidate G first and `sources/reference-garden-portal-64x.png` second. Exact prompt: `sources/stage-5-correction-h.prompt.txt`. The output is a complete new AI source, preserved as `candidate-stage-5-h.png`, source SHA `933569076f48c87d1e7337faf709e0183c939828c0570eec7fd44ba60ab04cbc`. Default tight-frame native SHA `b71e0082af213b292557c378a60534dae7edc45c1444c023ba9d2d6871389848`.

H fixes the frame height to5px and retains the4×3 leaf, but the default frame is8×5 because both jambs are2px wide. It is not yet approved. The default common frame is `[134,170,1119,1072]`, target48×44 at(0,4), hard alpha, no enclosed transparency. A single mathematically calculated outward-only common frame has been proposed to the parent for review, not a new tolerance or bulk search; no reverse stage has been derived.

The parent authorized exactly that one frame `[134,160,1133,1072]`. It passes the existing safe-frame bounds and yields a proper7×5 portal/4×3 leaf, but two central-left window panes become1×2 pixels. It was **rejected**, not accepted by treating a numeric source-normalizer exit0 as a semantic pass. All before/after source and runtime hashes, frame bounds, failed pane coordinates and evidence paths are recorded in `sources/h-frame-diagnostic.json`. No other frames were tested in this diagnostic; no geometric tolerance changed.

## H2 — central-left pane source correction

Parent authorized widening only the two central-left panes in a new AI source. Exact prompt `sources/stage-5-correction-h2.prompt.txt`, sole reference candidate H. The result is preserved as `candidate-stage-5-h2.png`; the original tool output remains `/Users/kikasnikita/.codex/generated_images/01a06e09-3764-78c2-9a7d-04e761ff8311/exec-b1aeed2e-a837-4640-9b54-1775f604bb6e.png`.

H2 widens those panes but also moves the outside source bounds to `[127,164,1122,1070]`. The old H frame would crop opaque pixels at the left and therefore was not applied. A revised one-frame diagnostic has been proposed to the parent; no normalization using an opaque-cropping frame and no visual approval are permitted.

## H3/H4 and final finished-stage approval

H2's single safe frame `[127,155,1135,1072]` solves the widened central panes and the portal but exposes a third top row on four balcony apertures. H3 (reference H2, exact prompt `sources/stage-5-correction-h3.prompt.txt`) did not remove that row and remains rejected. Source H3 SHA `0021a36121e9416167645ecdbbf9e098f80c38fa0a83c4642b3b611541759767`; native SHA `766d3cf2a6fe3e12d4e9f8f3e6479ead8bdbea1a0a2295f6ade93cd27fb76cfe`.

H4 uses full H3 first and a mechanical64× crop of Garden's accepted2×2 window second; exact prompt `sources/stage-5-correction-h4.prompt.txt`. `prepare-window-reference.py` preserves every pixel of crop `[6,31,12,37)`, with2px context, and verifies a nearest-neighbour roundtrip. All source/output hashes are in `sources/window-reference-preprocessing.json`. No Garden pixels are pasted into Sand.

The new H4 source has visible bounds `[127,163,1122,1069]`. Exactly one legal common frame `[127,155,1135,1069]` was chosen for it: top8/right13 background pixels, no bottom margin and no opaque crop. This source/frame combination passes the complete16-pane envelope,4×3 leaf/7×5 portal, occupied-size and floor/roof checks. Source SHA `f8564996afceaa76935ab815b24ca3c8285db613bf49ef49de1dd96fc07af805`; MEDIANCUT native SHA `84a7410435697185516442f344da3387ab2ac11cc0a767c81d3422b5f31218db`. Parent independently inspected native1×/8× and approved exactly this combination. It is now frozen for stages4/3. The existing broad magenta recovery is documented in `sources/exterior-background-diagnostic.json`.

## Reverse stage4

Exact prompt: `sources/stage-4.prompt.txt`. Sole reference: canonical approved H4 `sources/stage-5.png`. Target: left half roof retained, right opaque rooms, all finished roof volumes absent, same facade/entrance and dark unfinished window apertures. No reverse-stage approval is implied by the prompt or generation call.

Source returned at `/Users/kikasnikita/.codex/generated_images/01a06e09-3764-78c2-9a7d-04e761ff8311/exec-a76a41c3-4462-44e6-a894-5d9214ceb825.png`; preserved as `candidate-stage-4-a.png` and canonical `stage-4.png`. SHA source `23e253f14895d80c806505644ae8545981609364bb278f8db51dcf7df9ee8a27`, native `90d9a7281348afd50672943872b7ce5cdd90ebd6c67acafb401e243b6ad14902`. Parent independently approved actual1×/8×: approximately51% roof, six opaque rooms, stable facade/door. One upper opening's right edge extends1px, within the original2–3px width allowance; no exact-pixel-identity claim.

## Reverse stage3 and sequence acceptance

Exact prompt: `sources/stage-3.prompt.txt`. References in order: approved4A canonical source, then approved5H4 identity source. Source returned at `/Users/kikasnikita/.codex/generated_images/01a06e09-3764-78c2-9a7d-04e761ff8311/exec-ae5e2ad0-1e5f-45d3-b6e9-23180169d4a9.png`; preserved as `candidate-stage-3-a.png` and canonical `stage-3.png`. Source SHA `1f7debe239526f949bd4bc1560657742ba092f0ad68c06d8a7ba4bd0a9316066`, native `e1cc1a8bfb24ca20ef3982535768f8947ed1cd8f8f4fd88f06eea9aea3e538ad`.

Parent independently approved actual1×/8× and full3/4/5 sequence: no roof, open opaque room planes, internal material piles, removed upperwindow row and visibly partial upperfront masonry; lower10 apertures/compact doorway retained. Left room plan is new and axis-aligned, not exact pixel identity. All3 use the identical frozen5 source frame/NN transform; no per-stage crop/recenter, hand-painted architecture or repaired silhouette. The source family is now frozen but not globally published by this author.
