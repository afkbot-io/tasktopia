---
name: tasktopia-building-stage-verifier
description: Measure, normalize, audit, and grid-preview separate Tasktopia building stages against a geometry contract. Use for checking footprint and projected depth, roof-to-foundation continuity, one-cell construction clearance, fence placement, anchor/baseline drift, stage progression, hard alpha, palette budget, facade projection, or whether generated stages align on the 8×8 map grid.
---

# Tasktopia Building Stage Verifier

Verify objective geometry with code, then perform a separate native-scale visual gate. Passing the script never replaces projection review.

## Load the contract

Read:

1. `references/geometry-contract.md` completely.
2. `../tasktopia-pixel-city-art/references/visual-grammar.md` for style and projection.
3. The building-specific geometry JSON.

## Run the verifier

Use the project asset Python environment:

```bash
.venv-assets/bin/python \
  .agents/skills/tasktopia-building-stage-verifier/scripts/verify_building_stages.py \
  --contract <geometry.json> \
  --stage-5 <finished.png> \
  --stage-4 <stage-4.png> \
  --stage-3 <stage-3.png> \
  --output-dir <output-directory>
```

Supply stages 3–5 for the current contract. The optional stage-1/stage-2 CLI
arguments remain only for one-off forensic comparison outside the catalog; all
catalog work must use the shared construction-layout tests instead. The verifier writes:

- one normalized transparent PNG per supplied stage;
- one clean semantic-site preview per stage: pavement for dense/new-build
  families, a deterministic grass/meadow/dirt parcel with an entrance path
  for ordinary `HOUSE` families;
- one geometry-overlay preview per stage;
- `report.json` with measurements, errors, warnings and manual gates.

## Treat failures correctly

- Block on wrong cell multiples, empty art, invalid geometry, hard constraint violations, stage centre drift over one cell, baseline drift, an out-of-range stage silhouette, or a source with no transparent pixels after chroma removal. This last gate rejects baked checkerboards and opaque presentation backgrounds before catalog integration.
- Warn on excessive source colors or soft source edges; normalized drafts may harden alpha but must not be published until the authored source is approved. Generator pixels with alpha below `16` are treated as invisible noise so they cannot expand the common authoring frame and squash every stage.
- Never stretch one axis to force a pass. Regenerate the source.
- Never infer physical depth from source height alone. Require `depthCells` and `projectedRoofDepthCells` in the contract.
- For compact/private houses, require building-specific
  `finishedOccupiedWidthPxRange` and `finishedOccupiedHeightPxRange`. Reject a
  materially mismatched source and regenerate it instead of scaling one axis.
- Treat 45–80% (stage 3) and 85–105% (stage 4) as hard rejection bands.
  Author toward the safer 55–65% and 90–100% bands respectively. Read the
  exact measured ratios and `generationGuidance` from `report.json` before a
  targeted regeneration; never change the contract to fit a failed draft.

## Review every stage separately

Inspect each clean preview at native `1x` and nearest-neighbour `4x`:

1. Confirm strict frontal-top projection: verticals remain vertical, floors horizontal, no receding side facade. Inspect the roof, porch, steps, canopy, balcony, podium, every setback and crown independently; all top planes must share one compressed depth direction and none may collapse into a flat stripe.
2. Confirm the structure sits on the same bottom-centre anchor.
3. In the shared five-stage preview, confirm stages 1–2 match the building width and use the projected site depth formula rather than full physical depth.
4. Confirm the one-cell modular fence ring surrounds stages 1–4 but never changes the structure anchor; the road-facing gate aligns with the entrance.
5. For stages 1–2, confirm the selected construction props use the matching phase, fit their declared cell footprints, do not overlap, and leave the two cells inside the gate clear for access. Verify compact, medium and tower-sized sites rather than approving one fixed preview.
6. Inspect every construction prop at native `1x` before approving the composed site. Reject a heavy vehicle below `40×24 px`, a tower crane below `64×64 px`, a vehicle without the approved shallow top view, or any prop whose key parts disappear after normalization. Confirm no site contains more than one crane or one heavy vehicle.
7. Confirm stage identity and palette continuity.
8. Confirm no pavement, yard, fence, labels, shadows or UI are baked into the transparent structure layer.
9. Confirm a single entrance is an `8×16 px` outer module with a `6×14 px`
   moving leaf, or a double entrance is a `16×16 px` outer module with two
   leaves occupying `12×14 px` together. Inspect the cyan module ruler and
   magenta leaf ruler in every geometry preview; neither windows nor decorative
   portal trim count as part of the door. The same axis and scale must survive
   stages 3–5.
10. For the finished-stage environment preview, place adjacent standard trees
   only by their `[8,32]` anchor and central lower `8×8` planting cell. A tree
   must not be baked into the building source and must not compensate for an
   incorrect building footprint.
11. For an ordinary `HOUSE`, confirm the preview uses a living parcel rather
    than continuous civic pavement: lawn is dominant, dirt/meadow accents are
    sparse, and a path at most two cells deep meets the declared south entrance.
    Dense apartment and `new-build` families keep their urban paved platform.

Do not approve from a combined sheet. Review and report each stage as an independent artifact.

## Finish

Report exact occupied bounds, centre drift, baseline drift, stage coverage, construction envelope, projected-depth ratio and all remaining manual checks. An asset is accepted only when both automated and visual gates pass.

When integrating a batch, run `npm run assets:build` to completion and only
then run `npm run assets:verify`. Never execute the builder and verifier in
parallel: the builder rewrites runtime files and a concurrent audit can report
transient missing assets.
