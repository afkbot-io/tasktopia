# Rust loft — approved source-family freeze

The parent independently approved finished 5F, unfinished 4B, structural 3D,
and the complete native/8× sequence on 2026-09-07. This is source-family
acceptance, not a runtime publication or a complete world visual-acceptance claim.

All stages use the frozen common source frame [116,159,1138,1095], one uniform
nearest-neighbour transform, native 48×48 canvas and physical 6×6 lot.
All occupy 48×44, use 32 colors and hard alpha, contain no transparent interior
holes, and have zero center, baseline and foundation-mask drift. Both foundation
rows 46/47 remain fully opaque. No geometry range, camera axis or tolerance was
relaxed; no source/native geometry was painted by code.

The finished loft retains its three industrial steel bays, rust brick piers,
broad 30-pixel slate roof and 14-pixel facade with three floors at 4-pixel pitch.
The parent explicitly accepted MAXCOVERAGE and the brighter golden rooftop
housing. All 22 finished apertures are 2–3×2. The entrance is a 4×3 leaf inside
a 7×5 frame, including the separate bottom threshold at row47.

Stage4 retains approximately the left half of the roof, removes all finished
rooftop gear, and exposes four opaque rooms. Stage3 has zero roof, eight opaque
rooms and partial upper frontage, preserving the two lower window rows and
the entrance. The AI removed one small protruding northern partition cap as
unfinished masonry; this cleaned a rejected pink edge without changing the
overall envelope. Stage3 has 14 dark 2×2 apertures.

The existing broad magenta key removes only exterior-connected source fringe:
stage5 954 pixels (depth1), stage4 933 (depth1), stage3 1808 (depth2).
Each stage has zero enclosed removal and zero pixels gained relative to the
narrow key. No new key or threshold was introduced. Rejected attempts and
their exact prompts, source provenance and normalized previews are preserved.

Evidence: geometry.json, visual-review.json, provenance.json, report.json,
sequence-measurements.json and previews/stage-sequence-8x.png. The read-only
audit-sequence.py asserts dark aperture/leaf bodies, opaque foundations and
zero enclosed chroma removal. Source approval still includes independent
visual inspection; numeric checks alone are not sufficient.

The proposed catalog entry is HOUSE / RARE / STANDARD / STONE, estimates3/6,
serviceRole=null. It is only a proposal for root's separate batch integration.
No catalog, live scene, stored geometry or public runtime atlas changed here.

Final verification:
`python scripts/verify-compact-building-art.py --family <this-family> --require-complete --require-review`
must exit0 with errors[]. The source/native hashes are recorded in the report,
visual-review and proposed entry; previews are nearest-neighbour evidence only.
