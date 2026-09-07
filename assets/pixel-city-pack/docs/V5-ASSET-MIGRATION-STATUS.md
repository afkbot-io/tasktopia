# Compact asset cutover status

Updated: 2026-09-05. Working-branch status, not a production release report.

This retained filename replaces the former V5 migration checklist. The old
167-family catalog, 18–24-cell residential geometry, full-size door review and
`building-stage-study` authoring pipeline are retired. Do not use historical
research or dated changelog entries as current generation instructions.

## Current authority

- [Compact world cutover](../../../docs/COMPACT-BLOCK-CUTOVER.md).
- [Compact building art contract](../../../docs/art/COMPACT-BUILDING-ART-CONTRACT.md).
- `reference/ai-authored/compact-apartment-v1/geometry.json`,
  `visual-review.json` and `report.json` under the asset pack.
- The active `catalog/buildings.json` and `manifest.json`.

The initial family is `compact-apartment-v1`: canvas 48×48, physical 6×6 cells
at 8 px, anchor [24,48], south entrance 3. Its approved measurements are a 4×3
door leaf in a 7×5 portal, paired 2×2 window panes, 30 px roof region with 25 px
open plane, 15 px facade and 5 px floor step. The high 45-degree frontal-top view
is roof-dominant and axis-aligned, with no receding side facade or heavy black
baseline. Read the canonical contract for ranges and registration tolerance.

## Active inventory

| Scope | Current count |
| --- | ---: |
| Building families | 1 |
| Building runtime stages | 5 |
| Independent AI-authored building sources | 3 (stages 3–5) |
| Shared compact construction tiles / props | 7 / 4 |
| All props | 269 |
| Terrain families / vehicle models | 12 / 8 |
| Pixel City pack runtime PNGs | 362 |
| Public v5 runtime PNGs including additional atlas files | 491 |

Counts describe the currently published local manifest, not deployment evidence.
Terrain, tree, vehicle and ambient families retain their approved audits.

## Building production path

Approve stage 5, then derive 4, then 3 from the same authority. Stage 4 preserves the
shell with unfinished dark windows, roughly half a roof and no final rooftop
equipment. Stage 3 removes the roof and leaves roughly half the masonry, visible
partitions and opaque shaded room floors. It keeps the physical lot and projected
interior depth; the old height-ratio validator does not apply.

Stage 0 is a planned-slot marker. Stages 1–2 are runtime composition from the
compact site/fence/gate/crane/cabin/material kit. Their catalog PNGs are
thumbnails, not the live construction-site rendering. External terrain, fences
and sidewalks are not baked into authored stages 3–5.

Use one source frame measured from stage 5, uniform nearest-neighbour
normalization and hard alpha. Do not repaint architecture, stretch axes or
independently recenter stages. Each source and normalized output is hash-pinned.
Automated raster/structural-mask checks and independent visual review both gate
publication; an accepted source is not silently replaced by a builder.

## Current commands

Run serially:

```bash
npm run assets:compact:verify
npm run assets:build
npm run assets:verify
npm run assets:storybook
```

`assets:construction:build` rebuilds the compact kit explicitly;
`assets:build` already invokes it and verifies authored stages before publishing.
The obsolete residential geometry/migration/door-acceptance commands and the
old building-stage verifier were removed. The building tests now cover the
compact catalog, common frame, alpha holes, foundation masks and stale review.

## Spatial rollout and remaining scope

Migration 0023 removes derived legacy placements and caches. Task product data,
IDs/numbers, statuses, documents/history, city/district identity and the terrain
seed survive. Rebuild every city before map traffic resumes. Rehearse on a DB
copy; rollback restores the pre-cutover snapshot and application revision
together. No release has been performed as part of this working-branch change.

The first cutover does not implement relocation click-through, automatic
school/hospital quotas, airport/rail/bus-station construction or additional
district-specific building families. Park/water/parking tasks and planned slots
are not substitutes for those deferred requirements. Final full-test, build,
browser and deployment results belong to the final revision's review evidence.
