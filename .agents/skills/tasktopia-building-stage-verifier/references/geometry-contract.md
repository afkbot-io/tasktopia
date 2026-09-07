# Compact building geometry routing

The current authority is `docs/art/COMPACT-BUILDING-ART-CONTRACT.md` plus the
selected family's machine-readable
`assets/pixel-city-pack/reference/ai-authored/<key>/geometry.json`.
Read both completely before authoring or verification. This reference no longer
defines a second set of building dimensions.

## Spaces and invariants

Keep physical lot, sprite canvas and temporary construction envelope separate.
Read the actual lot/canvas/anchor from the reviewed family contract. The
initial apartment/row/wide and the independently authored long/court families
share8px cells, not identical envelopes. `COMPACT_BUILDING_SHAPES` is the
approved packing vocabulary; unregistered drafts are not runtime shapes.
One cell of construction clearance surrounds the physical lot; it
never changes the sprite anchor. The south gate uses the declared entrance.

Store roof/facade depth, floor rhythm, window and door dimensions in native
pixels. The broad roof dominates the new high45-degree view. No legacy shallow
roof-depth multiplier or18-cell footprint remains applicable.

## Reverse-stage registration

Use stage5 as the immutable source-space frame. Apply that exact uniformly
scaled transform to stages4 and3. Record the frame, scale, offset, source hash,
runtime hash and measured bounds in the verifier report.

Stage3 roof removal does not shrink the floor-space footprint. Compare the
structural alpha mask of the declared foundation rows and report its maximum
horizontal drift and differing-pixel count. Opaque bounds alone cannot prove
structural continuity, because a parapet/scaffold can hide an inset foundation.
The approved tolerance is1native pixel, not one8px world cell.

## Acceptance boundaries

The verifier rejects wrong size, drift, missing transparency, interior holes,
excessive palette, duplicate stages and stale approval. Camera, roof coverage,
interior-wall interpretation, entrance scale and stage identity also require
individual visual inspection. Record measurements honestly: tolerances are
not exact pixel identity, and a numeric image-height ratio is not assembled
masonry percentage.

The former `verify_building_stages.py`, projection-review CLI and18-cell
geometry writers are retired. Use `scripts/verify-compact-building-art.py`,
`npm run assets:compact:verify` and the current construction-layout tests.
