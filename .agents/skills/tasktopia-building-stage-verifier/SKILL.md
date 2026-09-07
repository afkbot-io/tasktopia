---
name: tasktopia-building-stage-verifier
description: Normalize, measure and visually audit compact Tasktopia building stages against their shared geometry contract. Use for source registration, structural masks, alpha holes, palette, high-45-degree projection, stage continuity, entrance and window scale, or grid previews before publishing.
---

# Tasktopia Building Stage Verifier

Code verifies raster invariants; independent visual review verifies architecture.
Neither gate substitutes for the other.

## Load the current contract

Read completely:

1. `references/geometry-contract.md`.
2. `docs/art/COMPACT-BUILDING-ART-CONTRACT.md` from the repository root.
3. The target family's `geometry.json` and `visual-review.json`, when present.
4. `../tasktopia-pixel-city-art/references/visual-grammar.md`.

The old18-cell verifier is removed. Do not restore its shallow roof,8×16 door,
compressed3–5-cell construction depth or percentage-of-image-height stages.

## Run the current verifier

For an incomplete authoring draft, including stage5:

```bash
.venv-assets/bin/python scripts/verify-compact-building-art.py --family <family-directory>
```

For every catalog-registered accepted family and the release gate:

```bash
npm run assets:compact:verify
```

The family directory contains `geometry.json`, `sources/stage-{3,4,5}.png`
and, after manual acceptance, `visual-review.json`. Publishing requires
`--require-complete --require-review`. The verifier writes normalized PNGs,
individual8px-grid previews, a stage comparison and `report.json`.

One source-space frame measured from stage5 drives all three transforms.
Normalization may only remove the explicitly declared chroma background,
uniformly scale with nearest-neighbour, harden alpha and quantize colors.
Never independently crop/recenter, repaint or stretch a reverse stage.

## Automated gates

Require all three distinct stages for publishing and no report errors:

- exact per-family canvas and footprint from its reviewed geometry, matching
  the published catalog and approved `COMPACT_BUILDING_SHAPES` vocabulary;
- common source canvas and finished authoring frame;
- hard alpha0/255, at most32colors including transparency;
- genuine external transparency and zero enclosed transparent roof/room holes;
- finished occupied-size ranges from geometry;
- stable centre and baseline, at most1native pixel of registration drift;
- actual structural-opacity masks on the declared foundation rows, not only
  whole-image bounding boxes; report differing pixels and mask drift;
- fresh source/runtime hashes and an accepted visual review for every stage.

Stage3 preserves room/floor depth and may retain most of the image height.
Its assembly percentage cannot be validated by the retired height-ratio rule.

## Separate visual gate

Inspect each normalized image at1× and nearest-neighbour8× before accepting it:

1. Roof dominant, rectangular, high45-degree frontal-top camera; no receding
   side facade, diagonal floors, heavy black baseline or inconsistent planes.
2. Exact shared entrance axis, floor rhythm and the door/window dimensions in
   geometry. Do not use residents or decorative portals as rulers.
3. Stage5 roof equipment present; stage4 approximately50% bare roof and no
   finished rooftop equipment; stage3 no roof and roughly50% masonry.
4. Room floors remain opaque and shaded; partitions share exterior-wall scale.
   Construction tools/materials remain inside the same physical footprint.
5. No external fence, landscaping, pavement, labels or progress UI baked in.
6. Same building identity, palette, centre, anchor and meaningful structural
   coordinates across all stages. A tolerated1px edge inset is not exact identity.

Record measured roof region, primary open roof, facade, floor step, door and
window sizes in `visual-review.json`, alongside the source/runtime hashes.
Never mark unchecked semantics accepted.

## Runtime integration

Stages0–2 are composed from slot and compact-kit primitives; their native-size catalog
thumbnails are not live-site sprites. Test `constructionStageLayout()` for
the actual contracted site, one-cell fence envelope, entrance corridor, fitting props
and non-overlap. Confirm stage1 planning and stage2 crane/cabin/foundation
differ, and the fence disappears at stage5.

Run `npm run assets:build` to completion, then `npm run assets:verify`.
Never build and audit the same runtime directories concurrently. Check the
real map at supported zooms for adjacent slots, roads and tree clearance.

Report automated results, individual previews, measured tolerances and any
uncompleted runtime/semantic checks without claiming code proves camera angle.
