---
name: tasktopia-pixel-city-art
description: Create, integrate, or audit Tasktopia compact-city cartoon pixel buildings, terrain, trees, props, vehicles and construction art. Use for generation, style matching, proportion checks, manifest/catalog updates, contact sheets, world placement or diagnosing visual inconsistency; route buildings to the compact high-45-degree contract while preserving approved terrain/tree families and the native top-down micro ambient contract.
---

# Tasktopia Pixel City Art

Produce runtime-safe assets that read clearly at native `1x`, remain stable at every zoom, and preserve one visual language across the world.

## Load the contract

Before drawing or reviewing, read:

1. `docs/art/COMPACT-BUILDING-ART-CONTRACT.md` and the family geometry JSON — current building geometry, camera, scale and source authority.
2. `assets/pixel-city-pack/docs/GENERATION-SPEC.md` and `ASSET-EXPANSION-PLAN.md` — broader material/ambient plans. Old large-building dimensions and quotas are superseded by the compact contract; do not restore retired catalog entries.
3. `references/visual-grammar.md` — measurable proportions and stage rules.
4. `references/prompt-template.md` only when generating concept/reference art.
5. `references/production-acceptance.md` when generating, migrating, or approving AI-authored runtime buildings.
6. For cars, people, animals or aircraft, first read `docs/art/MICRO-AMBIENT-ART-CONTRACT.md`; it supersedes old large-car, upright-resident and gait rules in broader plans.
7. `references/ambient-asset-acceptance.md` when working on vehicles, stops, playgrounds, park furniture, trees, shrubs, animals, boats, or other ambient props.
8. `docs/art/TASK-PUBLIC-SPACES.md` for task-backed parks, fountains and monuments.
   Their16×16 authored centerpieces use separate3–5 sources, not building roof/
   room rules; the full lot and stages1–2 remain procedural composition.

For construction buildings, delegate the fragile parts to the focused project skills:

- use `$tasktopia-building-stage-generator` to approve stage 5 and derive separate authored stages 4→3;
- use `$tasktopia-building-stage-verifier` to normalize a common stage-5 frame,
  compare structural masks and render each stage independently on an 8px grid.

For buildings, inspect the catalog-registered family's normalized images
at its contracted native size and nearest-neighbour zoom. Resolve supported
envelopes from `COMPACT_BUILDING_SHAPES` and the reviewed catalog; do not use
the initial three-size list as a permanent whitelist. Current world terrain/road/tree
screenshots are the material reference, not obsolete large-building sheets.

## Choose the production path

- Every building uses exactly three independently approved AI-authored sources for stages 3–5 as the visual authority. Stages 1–2 come only from the shared construction tile kit. Combined building sheets and five-source building families are not catalog formats.
- Generate one coherent subject per request, pause `2–5 s` after each completed request, then normalize it into the exact runtime grid. For reverse construction work, generate one stage per request rather than a sheet. Reject and regenerate any source that violates strict frontal projection or category-specific occupied bounds before adding it to the catalog.
- Import hand-authored PNGs only when source, provenance, dimensions, alpha, anchor, stages, and catalog metadata are explicit.
- Never ship a concept sheet, scaled preview, antialiased output, or unregistered PNG as a runtime asset.
- Treat the verbal style fingerprint in `references/ambient-asset-acceptance.md` as a blocking contract. Reject attractive pixel art from another camera, palette, outline weight, detail scale, or lighting model; "pixel art" alone is not a style match.

## Build an asset family

1. Define semantic role before appearance: category, density, service role, rarity, quotas, footprint, platform, entrances, and allowed estimates.
2. Select a silhouette not already overrepresented in the category. Compare against the category contact sheet.
3. Define final native dimensions in multiples of `8 px`. AI sources may be normalized using the family's single aspect-preserving nearest-neighbour transform; never warp axes or procedurally replace accepted architecture.
4. Use centered anchors for the native micro ambient family; otherwise use bottom-centre `anchorPx`. Keep the visible entrance aligned with manifest `entrances`.
5. For every building and large progress-bearing prop, publish exactly five distinct runtime stages. Keep the building footprint separate from the one-cell construction clearance:
   - stage 0: reserved slot marker, composed without a building image;
   - stage 1: separate fence/gate around the reserved physical footprint;
   - stage 2: same fenced footprint with compact foundation, crane/cabin and materials;
   - stage 3: about half the masonry, no roof, full opaque interior floor and correctly scaled partitions;
   - stage 4: same shell, dark unfinished windows, about half a roof and no finished rooftop equipment;
   - stage 5: finished building with no construction elements.
6. Keep footprint, anchor and entrance constant across all five runtime stages; keep authored canvas, palette family, ground line and identity constant across stages 3–5. A stage is progress, not a separate design variant.
7. Give ordinary small props artistic variants instead of fake construction stages. Terrain families need at least three seamless variants; water may use five.
8. Register every runtime file in the manifest/catalog and connect the semantic key to world generation. An unused PNG is unfinished work.
9. Generate native and `4x` nearest-neighbour contact sheets. Review stages in a row and category variants side by side.
10. For directional ambient assets, draw each required orientation independently while preserving identity. Runtime rotation is not an authored orientation.
11. For trees, read `docs/art/COMPACT-TREE-ART-CONTRACT.md`. V7 uses16×16,
    anchor8,16,1×1 planting footprint and a12×14 maximum visible envelope.
    The world ground anchor is centered in its cell. Do not restore V6's tall
    canvas or trunk-only collision checks. Review beside real low-rise buildings.
12. Ground surfaces belong to the block/slot plan. The current compact
    apartment uses its declared `STONE` platform; parks, lawns and paths remain
    separately composed. Never infer platform from an old category default or
    bake any surface into the building sprite.

## Enforce variety without noise

- Separate construction stages from visual variants. Five stages are mandatory per building; catalog variety comes from additional stable keys.
- Cap unique civic/service/landmark assets with `maxPerCity` or `maxPerDistrict`; do not make every rare asset unique.
- Prefer materially different massing: narrow/wide, courtyard, corner, row, tower, pavilion, campus, or roadside composition. Palette swaps alone do not count as variety.
- Geometry and asset identity are separate: multiple independently authored homes can share an envelope, while new long/court envelopes require reviewed geometry and packing tests. Never stretch one family to create another, or load a retired large sprite to fill an unavailable category.
- Add one task-linked city landmark at most per city. It must occupy a task lot and follow the task's five stages; never publish a ready decorative `LANDMARK` world feature. Country-level complexes such as the State Archive are separate.
- Keep decorative density subordinate to task readability and runtime budgets.

## Generate reference art

Use one request per building stage. The approved compact family is the
projection/scale reference; the family geometry owns exact canvas and bounds.
Approve stage 5 first and derive separate stages `4→3`. Approved sources are
visual authority. Rejected drafts may be retained with explicit provenance for
diagnosis, but never enter the reviewed catalog, runtime pack or public assets.

Between external image requests, wait `2–5 s` after completion. Do not use long sleeps. Do not request several unrelated buildings in one image: it weakens proportions and stage identity. Review in groups of at most five accepted sources before continuing the queue.

After generation:

1. Save accepted authored stages as `assets/pixel-city-pack/reference/ai-authored/<key>/sources/stage-{3..5}.png`, alongside geometry, normalized outputs, report, visual review and previews.
2. Register the three relative `stageSources` and `stageSha256` values in the matching `catalog/buildings.json` entry. Building catalog entries must not contain combined-sheet fields.
3. Set `reviewed: true` only after projection, five-stage and native-scale review; runtime manifests never expose authoring provenance.
4. Normalize with one shared stage-5 frame; never independently crop/recenter a reverse stage or replace it with code-drawn geometry. Require `npm run assets:compact:verify` before publishing.

## Audit before integration

Run:

```bash
npm run assets:build
python3 .agents/skills/tasktopia-pixel-city-art/scripts/audit_pixel_style.py \
  --manifest assets/pixel-city-pack/manifest.json \
  --runtime assets/pixel-city-pack/runtime \
  --report tmp/pixel-city-style-audit.json
npm run assets:verify
.venv-assets/bin/python scripts/render-tree-grid-preview.py
```

Treat every error as blocking. Review warnings visually; do not suppress one without documenting why the asset intentionally differs.

Run this pipeline serially. Wait for `assets:build` to finish before starting
either audit or `assets:verify`; concurrent verification can observe the
runtime directory while files are being replaced and produce false missing-file
failures.

The audit must cover the complete pack, not only newly created files:

- five unique stages for every building;
- exact canvas, hard alpha, the family-specific center/bottom anchor, palette budget, and registered files;
- visible change between consecutive stages;
- stable centre/ground line and structural-mask registration, opaque room floors and plausible footprint coverage;
- distinct completed silhouettes within a category;
- props, terrain, transitions, tiles, and vehicles for grid size, palette, alpha, anchors, and visually distinct variants;
- every tree for the V7 compact profile,16×16canvas,8,16anchor,1×1footprint,
  centered two-row contact and the shared crown-clearance envelope;
- authored ambient provenance, paired directional consistency, semantic readability at `1x`, and silhouette diversity inside each vehicle/prop family;
- no orphan or missing runtime PNGs.

## Review in the game

Verify at minimum zoom, normal zoom, and maximum zoom:

- no blur, shimmer, restart-on-zoom, black tiles, or texture gaps;
- readable silhouette and progress badge without hiding the entrance;
- roads/paths reach the declared entrance;
- large objects do not overlap roads, water, district bounds, or one another;
- quotas and seeded selection produce variety across several small generated cities;
- unloaded chunks do not animate or allocate sprites.

Reject an asset that passes the file audit but fails native-scale readability or world placement.

## Finish the change

Update the canonical plan status, manifest provenance, contact sheet, relevant tests, and world-generation rules together. Report created keys, five-stage coverage, audit results, visual QA paths, and any plan entries still not implemented.
