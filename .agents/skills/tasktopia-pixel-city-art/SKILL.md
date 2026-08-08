---
name: tasktopia-pixel-city-art
description: Create, expand, integrate, or audit Tasktopia Pixel City V4 terrain, props, vehicles, buildings, landmarks, and five-stage construction sprites. Use for pixel-art generation, style matching, proportion checks, manifest/catalog updates, contact sheets, world-generator variety, or diagnosing an asset that looks inconsistent in the game.
---

# Tasktopia Pixel City Art

Produce runtime-safe assets that read clearly at native `1x`, remain stable at every zoom, and preserve one visual language across the world.

## Load the contract

Before drawing or reviewing, read:

1. `assets/pixel-city-pack-v4/docs/GENERATION-SPEC.md` — canonical geometry and style contract.
2. `assets/pixel-city-pack-v4/docs/ASSET-EXPANSION-PLAN.md` — requested catalog and quotas.
3. `references/visual-grammar.md` — measurable proportions and stage rules.
4. `references/prompt-template.md` only when generating concept/reference art.

Inspect `screenshots/pixel-city-v4-expanded-assets.png` at original resolution and at nearest-neighbour `4x`. Treat it as the style reference, not as a source to copy pixel-for-pixel.

## Choose the production path

- Prefer deterministic Pillow/source drawing for runtime PNGs. Runtime assets must not depend on an image model.
- Use image generation only for reference exploration. Generate one coherent subject or family per request, pause briefly between requests, then redraw or normalize it into the exact runtime grid.
- Import hand-authored PNGs only when source, provenance, dimensions, alpha, anchor, stages, and catalog metadata are explicit.
- Never ship a concept sheet, scaled preview, antialiased output, or unregistered PNG as a runtime asset.

## Build an asset family

1. Define semantic role before appearance: category, density, service role, rarity, quotas, footprint, platform, entrances, and allowed estimates.
2. Select a silhouette not already overrepresented in the category. Compare against the category contact sheet.
3. Draw at final resolution in multiples of `8 px`; never downsample into pixel art.
4. Use bottom-centre `anchorPx`. Keep the visible entrance aligned with manifest `entrances`.
5. For every building and large progress-bearing prop, produce exactly five distinct stages:
   - stage 1: occupied construction site and boundary markers;
   - stage 2: full-footprint foundation;
   - stage 3: recognisable structural frame;
   - stage 4: the same final silhouette with scaffolding/unfinished surfaces;
   - stage 5: finished building with no construction elements.
6. Keep canvas, footprint, anchor, entrance, palette family, ground line, and identity constant across all five stages. A stage is progress, not a separate design variant.
7. Give ordinary small props artistic variants instead of fake construction stages. Terrain families need at least three seamless variants; water may use five.
8. Register every runtime file in the manifest/catalog and connect the semantic key to world generation. An unused PNG is unfinished work.
9. Generate native and `4x` nearest-neighbour contact sheets. Review stages in a row and category variants side by side.

## Enforce variety without noise

- Separate construction stages from visual variants. Five stages are mandatory per building; catalog variety comes from additional stable keys.
- Cap unique civic/service/landmark assets with `maxPerCity` or `maxPerDistrict`; do not make every rare asset unique.
- Prefer materially different massing: narrow/wide, courtyard, corner, row, tower, pavilion, campus, or roadside composition. Palette swaps alone do not count as variety.
- Avoid repeating the same finished silhouette more than twice in one district when alternatives fit the same estimate/category.
- Add one city landmark at most per city unless the canonical plan explicitly defines a country-level complex such as the State Archive.
- Keep decorative density subordinate to task readability and runtime budgets.

## Generate reference art

Use one request per asset family or one large landmark. Include the current contact sheet as a style reference. Ask for a clean sheet containing the five construction stages in order, but treat the result as reference-only.

Between external image requests, wait a short bounded interval (normally `2–5 s`). Do not use long sleeps. Do not request several unrelated buildings in one image: it weakens proportions and stage identity.

After generation:

1. Save the reference under `assets/pixel-city-pack-v4/reference/` with a descriptive name.
2. Record it in manifest provenance only if it influenced a shipped asset.
3. Rebuild the runtime asset deterministically at its exact target size.
4. Do not directly resize a large generated illustration into the runtime sprite.

## Audit before integration

Run:

```bash
npm run assets:build
python3 .agents/skills/tasktopia-pixel-city-art/scripts/audit_pixel_style.py \
  --manifest assets/pixel-city-pack-v4/manifest.json \
  --runtime assets/pixel-city-pack-v4/runtime \
  --report tmp/pixel-city-style-audit.json
npm run assets:verify
```

Treat every error as blocking. Review warnings visually; do not suppress one without documenting why the asset intentionally differs.

The audit must cover the complete pack, not only newly created files:

- five unique stages for every building;
- exact canvas, hard alpha, bottom anchor, palette budget, and registered files;
- visible change between consecutive stages;
- stable centre/ground line and plausible footprint coverage;
- distinct completed silhouettes within a category;
- props, terrain, transitions, tiles, and vehicles for grid size, palette, alpha, anchors, and visually distinct variants;
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
