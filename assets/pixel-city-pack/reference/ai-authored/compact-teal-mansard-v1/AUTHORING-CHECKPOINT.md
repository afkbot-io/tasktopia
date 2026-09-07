# Teal mansard — approved source-family checkpoint

2026-09-07. The parent reviewer independently accepted stage 5J, then 4A, then 3G and the complete sequence at native 1× and 8×. This is source-family approval, not a global catalog, runtime or release claim. No global publication was performed in this slice.

## Frozen geometry and normalization

The original 48×48 native canvas, 6×6-cell footprint, anchor (24,48), south entrance offset 3 and one-cell clearance remain unchanged. All stages use the one frozen source frame `[139,164,1114,1089]`, aspect-preserving nearest-neighbour normalization, hard alpha, the existing narrow `magenta-recovery` key and at most 32 colors. MAXCOVERAGE was selected while stage 5 was an unapproved draft and accepted in the final native review. No new chroma threshold, source-pixel painting, alpha repair, axis stretching, frame search or geometry-tolerance relaxation was used.

Stage 5 has a 30-pixel roof region and 16-pixel facade with three rows at a five-pixel pitch. Three small cream/teal dormers, a rear chimney and a double teal roof band distinguish its architecture. The approved Garden was the primary scale reference; the prior Teal draft supplied secondary roof identity. This is a new mansard design, not a palette-only copy.

Every stage retains the 4×3 door leaf `[22,45,26,48]` within the 7×5 frame `[20,43,27,48]` (half-open bounds). Its two-row header and glass reaching the baseline match accepted related families; a separate bottom threshold is not required by the contract. Foundation rows 46/47 remain opaque and identical in silhouette.

## Reverse construction and disclosed registration

- **5J:** 48×46 occupied pixels; eight 2×2 facade panes and three 2×2 dormer apertures.
- **4A:** 48×46; left half slate roof retained, right four opaque rooms exposed, all final dormers/chimney removed. Eight dark 2×2 facade panes and the portal preserve their stage-5 coordinates.
- **3G:** 48×44; roof absent, full opaque eight-room plane, reduced upper front masonry and five dark 2×2 panes. Remaining panes are one pixel lower, and the left bay one pixel left, versus stage 5. These disclosed offsets were independently accepted under the unchanged gate. Source bounds extend 15 source pixels left, 14 right and 6 below the frozen frame (approximately 0.74/0.69/0.30 native pixels); native entrance, center, baseline and foundation silhouette have zero drift. The source bounding boxes are therefore not claimed to be identical.

All stages have binary alpha and zero enclosed transparent holes. The warmer, dustier construction interiors are intentional and were reviewed. Rejected and intermediate sources remain in `sources/`; `PROMPTS.md` and `provenance.json` record every attempt. Unused stage 5K was not adopted after the parent clarified that the accepted two-row header is valid.

## Exact accepted bytes

| Stage | Source SHA-256 | Native SHA-256 |
| --- | --- | --- |
| 3G | `428ac32d8891c60e9d978a67ee510cf0fe46ac642fb3a53f6f7a14ad8bc6eb01` | `4e8ffff61c4e27adcc94fed63d527eb52c56db634f3adb541c3879e54d9b1b16` |
| 4A | `b00ba75e082c89741accff56a2b6930015a168173e238c99b31f58a686cecf0c` | `a5c6b3ba771fc5f7bdcd962eeb02c109407f0e27d506e2d1c898e1fac17de74c` |
| 5J | `7bc85125a3c218bde1bccd68207371c77823858550faa8a5644aa72983803344` | `69e9d2f81448cc12cea5ea22deadc868d550ad15c5364b7eb31c24b45c6e0d26` |

Review: `visual-review.json`. Numeric evidence: `report.json`, `stage5J-measurements.json`, `sequence-measurements.json`. Native sequence: `previews/stage-sequence.png`; enlarged sequence: `previews/stage-sequence-8x.png`. Proposed metadata is isolated in `catalog-entry.proposed.json`: HOUSE / RARE / STANDARD / STONE, estimates 3 and 6, no infrastructure role.

## Local verification

Run from the integration worktree:

```sh
.venv-assets/bin/python scripts/verify-compact-building-art.py --family assets/pixel-city-pack/reference/ai-authored/compact-teal-mansard-v1 --require-complete --require-review
.venv-assets/bin/python assets/pixel-city-pack/reference/ai-authored/compact-teal-mansard-v1/audit-stage5.py
.venv-assets/bin/python assets/pixel-city-pack/reference/ai-authored/compact-teal-mansard-v1/audit-sequence.py
.venv-assets/bin/python -m py_compile assets/pixel-city-pack/reference/ai-authored/compact-teal-mansard-v1/audit-stage5.py assets/pixel-city-pack/reference/ai-authored/compact-teal-mansard-v1/audit-sequence.py
```

The read-only measurement scripts do not replace independent visual approval. Integration, generated catalog publication and in-world screenshot acceptance remain separate parent-owned gates.
