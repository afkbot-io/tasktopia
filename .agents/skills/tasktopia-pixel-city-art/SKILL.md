---
name: tasktopia-pixel-city-art
description: Create, expand, integrate, or audit Tasktopia Pixel City V4 terrain, props, vehicles, buildings, landmarks, and five-stage construction sprites. Use for pixel-art generation, style matching, proportion checks, manifest/catalog updates, contact sheets, world-generator variety, or diagnosing an asset that looks inconsistent in the game.
---

# Tasktopia Pixel City Art

Produce runtime-safe assets that read clearly at native `1x`, remain stable at every zoom, and preserve one visual language across the world.

## Load the contract

Before drawing or reviewing, read:

1. `assets/pixel-city-pack/docs/GENERATION-SPEC.md` — canonical geometry and style contract.
2. `assets/pixel-city-pack/docs/ASSET-EXPANSION-PLAN.md` — requested catalog and quotas.
3. `references/visual-grammar.md` — measurable proportions and stage rules.
4. `references/prompt-template.md` only when generating concept/reference art.
5. `references/production-acceptance.md` when generating, migrating, or approving AI-authored runtime buildings.
6. `references/ambient-asset-acceptance.md` when working on vehicles, stops, playgrounds, park furniture, trees, shrubs, animals, boats, or other ambient props.

For construction buildings, delegate the fragile parts to the focused project skills:

- use `$tasktopia-building-stage-generator` to approve stage 5 and derive separate authored stages 4→3;
- use `$tasktopia-building-stage-verifier` to measure geometry and render every
  stage independently on its semantic 8×8 site grid (urban pavement or an
  ordinary residential yard).

Inspect `screenshots/pixel-city-v4-expanded-assets.png` at original resolution and at nearest-neighbour `4x`. Treat it as the style reference, not as a source to copy pixel-for-pixel.

## Choose the production path

- Every building uses exactly three independently approved AI-authored sources for stages 3–5 as the visual authority. Stages 1–2 come only from the shared construction tile kit. Combined building sheets and five-source building families are not catalog formats.
- Generate one coherent subject per request, pause `2–5 s` after each completed request, then normalize it into the exact runtime grid. For reverse construction work, generate one stage per request rather than a sheet. Reject and regenerate any source that violates strict frontal projection or category-specific occupied bounds before adding it to the catalog.
- Import hand-authored PNGs only when source, provenance, dimensions, alpha, anchor, stages, and catalog metadata are explicit.
- Never ship a concept sheet, scaled preview, antialiased output, or unregistered PNG as a runtime asset.
- Treat the verbal style fingerprint in `references/ambient-asset-acceptance.md` as a blocking contract. Reject attractive pixel art from another camera, palette, outline weight, detail scale, or lighting model; "pixel art" alone is not a style match.

## Build an asset family

1. Define semantic role before appearance: category, density, service role, rarity, quotas, footprint, platform, entrances, and allowed estimates.
2. Select a silhouette not already overrepresented in the category. Compare against the category contact sheet.
3. Draw at final resolution in multiples of `8 px`; never downsample into pixel art.
4. Use bottom-centre `anchorPx`. Keep the visible entrance aligned with manifest `entrances`.
5. For every building and large progress-bearing prop, publish exactly five distinct runtime stages. Keep the building footprint separate from the one-cell construction clearance:
   - stage 1: shared earth/survey tiles inside the projected site rectangle;
   - stage 2: shared foundation/edge/rebar tiles inside the same rectangle;
   - stage 3: recognisable structural frame;
   - stage 4: the same final silhouette with scaffolding/unfinished surfaces;
   - stage 5: finished building with no construction elements.
6. Keep footprint, anchor and entrance constant across all five runtime stages; keep authored canvas, palette family, ground line and identity constant across stages 3–5. A stage is progress, not a separate design variant.
7. Give ordinary small props artistic variants instead of fake construction stages. Terrain families need at least three seamless variants; water may use five.
8. Register every runtime file in the manifest/catalog and connect the semantic key to world generation. An unused PNG is unfinished work.
9. Generate native and `4x` nearest-neighbour contact sheets. Review stages in a row and category variants side by side.
10. For directional ambient assets, draw each required orientation independently while preserving identity. Runtime rotation is not an authored orientation.
11. For every standard tree, enforce the `16×32`/`1×1` planting contract:
    anchor `[8,32]`, ground contact inside the lower-centre `8×8` cell, no
    opaque pixels outside `x=4..11` in ground-contact rows `30..31`, and crown
    overhang only above that band. Review the tree on the same pavement grid as the
    building rather than on a plain color card.
12. Give ordinary low-rise `HOUSE` entries a `YARD` platform: deterministic
    grass as the dominant surface, sparse meadow/dirt accents and a short path
    aligned with the declared entrance. Keep dense apartment/new-build families
    on continuous urban pavement; never bake either surface into the sprite.

## Enforce variety without noise

- Separate construction stages from visual variants. Five stages are mandatory per building; catalog variety comes from additional stable keys.
- Cap unique civic/service/landmark assets with `maxPerCity` or `maxPerDistrict`; do not make every rare asset unique.
- Prefer materially different massing: narrow/wide, courtyard, corner, row, tower, pavilion, campus, or roadside composition. Palette swaps alone do not count as variety.
- Avoid repeating the same finished silhouette more than twice in one district when alternatives fit the same estimate/category.
- Add one task-linked city landmark at most per city. It must occupy a task lot and follow the task's five stages; never publish a ready decorative `LANDMARK` world feature. Country-level complexes such as the State Archive are separate.
- Keep decorative density subordinate to task readability and runtime budgets.

## Generate reference art

Use one request per building or one large landmark. Include two approved benchmark images from the same category as projection references. State the exact runtime canvas and occupied-bounds target from `references/production-acceptance.md`. Approve stage 5 first and derive two independent images in order `4→3`. The approved sources become visual authority; rejected generations must not enter the repository or catalog.

Between external image requests, wait `2–5 s` after completion. Do not use long sleeps. Do not request several unrelated buildings in one image: it weakens proportions and stage identity. Review in groups of at most five accepted sources before continuing the queue.

After generation:

1. Save accepted authored stages as `assets/pixel-city-pack/reference/ai-authored/building-stage-study/<key>/sources/stage-{3..5}.png`.
2. Register the three relative `stageSources` and `stageSha256` values in the matching `catalog/buildings.json` entry. Building catalog entries must not contain combined-sheet fields.
3. Set `reviewed: true` only after projection, five-stage and native-scale review; runtime manifests never expose authoring provenance.
4. Normalize the approved source deterministically at its exact target size; never replace it with code-drawn geometry.

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
- exact canvas, hard alpha, bottom anchor, palette budget, and registered files;
- visible change between consecutive stages;
- stable centre/ground line and plausible footprint coverage;
- distinct completed silhouettes within a category;
- props, terrain, transitions, tiles, and vehicles for grid size, palette, alpha, anchors, and visually distinct variants;
- every `TASKTOPIA_V5_TREE_FRONTAL_TOP` prop for its exact `16×32` canvas,
  `[8,32]` anchor, `1×1` footprint and lower-centre `8×8` planting cell
  with a centred two-row ground contact;
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
