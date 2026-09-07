---
name: tasktopia-building-stage-generator
description: Generate one compact Tasktopia building stage at a time in reverse order 5→4→3, preserving the approved high-45-degree camera, footprint, anchor, entrance, roof depth, palette and facade grid. Use for new or regenerated building sources; stages 0–2 are runtime composition and must not be image-generated.
---

# Tasktopia Building Stage Generator

Use the compact-city profile `TASKTOPIA_COMPACT_CARTOON_HIGH_45_V1`. The old
18-cell buildings, shallow roof, 8×16 door and stage-3 silhouette-height ratio
are retired. Accepted families are listed in the reviewed building catalog;
their different compact geometries must not be stretched into one square.

## Load before generation

Read these sources completely:

1. `docs/art/COMPACT-BUILDING-ART-CONTRACT.md` from the repository root.
2. The selected family's `assets/pixel-city-pack/reference/ai-authored/<key>/geometry.json`
   and its accepted source review, when present.
3. `references/reverse-stage-prompts.md`.
4. `../tasktopia-pixel-city-art/references/visual-grammar.md`.

Inspect the approved normalized stage 5 and its original source. Use the
imagegen skill/tool for authored image changes. Do not substitute procedural
architecture for an accepted AI source.

## Lock the family

Use the reviewed catalog and `COMPACT_BUILDING_SHAPES` in
`src/shared/compact-building-families.ts` for the current geometry vocabulary.
It includes long and courtyard envelopes as well as the initial six-cell homes.
All use8px cells and bottom-centre anchors; entrance offset, floor rhythm and
roof/facade depths come from the individual contract, not one global template.
Read actual door/window measurements
from geometry and visual review, not old category-wide human-scale rules.

All roof, floor, door and window edges share screen axes. This is a high,
roof-dominant 45-degree art convention, not an isometric rotation: no receding
side facade or diagonal corners. Prefer coarse dusty beige/olive/slate/teal
planes, warm roof rim, parallel bands and no heavy black baseline.

Keep physical footprint, projected room depth, entrance and anchor unchanged.
Stage 3 assembly is about50% of the structure, not50% of the image height.
Never reduce the floor-space rectangle to make a numeric height ratio pass.

## Generate one stage at a time

1. Approve stage5 first, then derive4, then3.
2. Keep stage5 as immutable geometry authority. Derive4 from5 and3 from4;
   include5 as an additional reference when registration needs correction.
3. Preserve source canvas, subject scale and source margins. The verifier uses
   one common stage5 frame and transform; independently recentering stages is
   forbidden.
4. Request one isolated subject with real transparent alpha. No sheet,
   checkerboard, external fence, pavement, UI, people or scenery.
5. If transparency fails, an explicit solid-magenta recovery source is allowed
   only when recorded in geometry. Remove background mechanically; do not fill
   interior holes with code. Never mistake painted checkerboard for alpha.
6. Keep drafts outside catalog/runtime until verified and visually reviewed.

Stage4 keeps the same outer shell, dark unfinished windows and approximately
half the roof, with open rooms/materials where roofing is absent. Remove all
finished rooftop equipment. Stage3 has no roof, partially assembled frontage
and interior walls, opaque shaded floors, and small construction materials or
tools inside the unchanged footprint. Walls and partitions follow the same
camera and floor-height rule. Stage5 is clean and finished.

Stage0 is a reserved slot marker. Stage1 is a separate fence/gate/site.
Stage2 adds the compact foundation, crane/cabin/material kit. They are composed
by `constructionStageLayout()` and the block renderer, never generated as
whole-building images. The one-cell external fence envelope remains separate
from the building's contracted physical occupancy.

## Verify each result

Use `$tasktopia-building-stage-verifier` after each request. Inspect each stage
independently at its contracted native size and nearest-neighbour zoom, then compare the row.
Check entrance, roof coverage, opaque floors, walls, palette and building identity.

Reject wrong perspective, shifted foundations, baked ground/fence, roof holes,
soft edges or a different building. Fix the source with a targeted image edit,
not code repainting, warping, stretching or per-stage cropping. Do not loosen
the approved contract to accept a failed draft.

Only after all three independent stages pass, record source/runtime hashes and
semantic evidence in `visual-review.json`, run
`npm run assets:compact:verify`, then publish with `npm run assets:build`
followed serially by `npm run assets:verify`.

Return source paths, normalized PNGs, the geometry/report/review and the
separate grid previews. A comparison sheet is review evidence, not a runtime asset.
