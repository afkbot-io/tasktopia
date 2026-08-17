---
name: tasktopia-building-stage-generator
description: Generate one Tasktopia building stage at a time for stages 3–5 while preserving identity, frontal-top projection, footprint, entrance, anchor, palette, door scale, and grid scale. Use when approving a finished building, deriving structural stage 3 or unfinished stage 4, or regenerating a drifting stage; stages 1–2 are composed from the shared construction tile kit and must not be image-generated.
---

# Tasktopia Building Stage Generator

Derive the authored construction art backwards from an approved finished building. Keep stage 5 as the immutable visual authority and generate one separate image per request. Stages 1–2 are deterministic world composition, not building art.

## Load the contracts

Read all of these before generating:

1. `../tasktopia-pixel-city-art/references/visual-grammar.md` for projection and palette.
2. `../tasktopia-building-stage-verifier/references/geometry-contract.md` for physical footprint, projected roof depth, anchor, foundation and fence rules.
3. `references/reverse-stage-prompts.md` for the exact per-stage prompt structure.
4. The target building geometry JSON produced by the verifier.

## Preflight the finished source

1. Inspect stage 5 at original resolution.
2. Require explicit `widthCells`, `depthCells`, `heightCells`, `projectedRoofDepthCells`, entrance and one-cell construction clearance.
3. Run the verifier against stage 5 before generating. Stop if stage 5 fails canvas, coverage or projection checks.
4. Treat physical depth and screen depth separately. Never draw a `depthCells × 8`-pixel roof plane. Use `projectedRoofDepthCells × 8` for the principal roof and preserve that same compressed depth direction on every secondary horizontal plane. Porches, landings, canopies, balconies, podiums, setbacks, terraces and crowns must expose a shallow top surface; none may become a flat facade stripe or introduce a receding side wall.
5. Treat the outside fence, stage-1 site and stage-2 foundation as shared tile composition. Do not bake them or pavement into the structure image.
6. Classify scale before drawing. A private one-storey house is not a shortened
   high-rise: use a compact canvas/footprint, one 8×16 entrance module, 4–6 px
   wide windows and a building-specific finished occupied-size range. When an
   existing source is materially too large, too small or vertically stretched,
   regenerate it; do not squeeze it into the target canvas.

## Generate backwards

Generate in this order: `5 → 4 → 3`. If stage 5 is already approved, derive only `4 → 3`.

- Use one built-in image-generation request per stage.
- Pass the approved stage-5 source in every request as Image 1.
- Optionally pass the immediately later accepted stage as Image 2 only for continuity; Image 1 remains authoritative.
- Ask for exactly one isolated stage with **true transparent alpha**. Never request a checkerboard, chroma backdrop, sheet, sequence, comparison board, pavement or surrounding scene. A chroma source is permitted only as an explicit recovery fallback and must never enter the catalog.
- Preserve the approved stage-5 **source canvas aspect ratio and subject-to-canvas scale** in every reverse-stage request. Never force a landscape source into a square canvas (or the reverse): the verifier normalizes the full source canvas, so changing its aspect ratio silently changes occupied width and breaks stage registration.
- Preserve facade centre, roof bounds, entrance centre, floor rhythm, material palette and light from upper-left.
- Preserve one camera across the complete massing. On a private house show a shallow top plane on both roof and street-facing porch/landing. On a stepped high-rise show a consistent shallow top strip on every setback, podium and crown. Reject alternating flat ledges and top-visible ledges.
- Preserve the human-scale contract: a single door is an `8×16 px` outer
  module with a `6×14 px` moving leaf; a double door is a `16×16 px` outer
  module with two moving leaves occupying `12×14 px` together. Portal columns,
  canopy, transom and ground-floor glazing stay outside that measurement.
  Construction staging must not shrink or enlarge the module to make the
  facade fit.
- Keep all landscaping external: trees use their own `16×32` sprite and
  central lower `8×8` planting cell, so no tree, planter, bench or fence may be
  painted into a building stage.
- Never request stages 1 or 2 from an image model. `constructionStageLayout()` owns their dimensions, four earth variants, two foundation variants, rebar, fence, gate and seeded detail composition. The registered detail kit contains ten planning props and thirteen foundation props; do not paint those props into a building stage.
- Author a construction prop for its declared final canvas instead of drawing a full scene and shrinking it into a 16 px placeholder. Small hand tools use `16–24 px`; heavy vehicles use `40–48 px`; tower cranes use `72–96 px`. The final normalized `1x` silhouette must retain the cabin, working organ and one structural material cue.
- Heavy vehicles follow the same horizontal frontal-top road projection as the approved car family: shallow roof/top visibility, horizontal baseline and no receding diagonal. Tower cranes use a large readable `Г` silhouette and a strict frontal lattice mast.
- Pause `2–5 s` after each completed request before issuing the next one.
- Save drafts outside runtime/catalog paths until they pass verification.
- Check `hasAlpha` before normalization. A PNG whose transparency grid is painted into RGB is a rejected source even when it looks transparent in a preview.

## Enforce stage meaning

- Stage 4: target 90–100% of final occupied height and width. Preserve the
  final extrema of integral masts, spires, antennae, towers and crowns; show
  unfinished surfaces and close scaffolding without shortening the silhouette.
  The verifier's 85–105% band is a hard tolerance, not an authoring target.
- Stage 3: retain the same structural bay grid, but target 55–65% of final
  occupied height. For a low-rise this normally means one structural storey
  plus short rebar, not a nearly complete second storey. The verifier's
  45–80% band is a hard tolerance, not an authoring target.
- Before requesting stage 3, read the verifier's `authoringFrameNormalized`
  from the accepted stage 5. State the finished top and bottom fractions in the
  prompt and require stage 3 to share the exact finished bottom fraction while
  starting lower in the canvas. A reliable target is `60%` of the finished
  occupied height. Empty magenta/transparent margin must remain above the
  partial frame; asking only for a "half-built house" is not precise enough.
- If the first generated frame is too tall or too short, edit that authored
  frame with the accepted stage 5 as the placement reference. Change the
  structural height and source placement in the image model; never crop,
  stretch, translate or squash the accepted source with code to satisfy the
  ratio.
- Stage 2: shared `8×8` foundation tiles fill the full building width and a projected site depth of `clamp(ceil(physicalDepth × 0.42), 3, 5)` cells.
- Stage 1: shared earth/survey tiles fill the same projected site rectangle.
- Stage 1 selects only planning equipment; stage 2 selects only foundation equipment. A compact site receives 2–3 unique props and a tower site 5–7, seeded by task identity. Large machines require a large enough pad; every footprint stays disjoint and the two-cell gate corridor stays empty. Never place more than one `CRANE` or one `VEHICLE` group on one site.
- Stages 1–4: shared fence tiles form a one-cell outer ring with a two-cell gate aligned to the south entrance.

## Verify after every request

Run `$tasktopia-building-stage-verifier` immediately after each image. Reject and regenerate instead of repairing geometry with stretching, procedural repainting or manual perspective edits.

Read `generationGuidance` and the per-stage ratios from `report.json` after
every run. Name the failed invariant and measured percentage in the next edit
prompt. Never loosen the geometry contract to accept a draft. Keep rejected
drafts outside the repository.

Do not accept a stage when:

- the facade or foundation is shown from the side or as an isometric diamond;
- the roof/foundation depth differs from the geometry contract;
- the subject centre or ground baseline drifts by more than one cell;
- the entrance moves;
- stage 4 becomes a different building;
- a reverse stage uses a different source-canvas aspect ratio or materially different subject margins than stage 5;
- antialiasing, text, UI, a baked platform or an external fence enters the structure layer.
- the source contains no transparent pixels after chroma removal, including a baked checkerboard or opaque presentation background.
- stage 3 exceeds 80% of the finished occupied height or stage 4 falls below 85%; regenerate the authored silhouette rather than scaling or cropping it in code.

## Finish

Return the three accepted authored source paths for stages 3–5, their verifier reports, independent grid previews, and one shared five-stage composition preview. Do not publish a combined AI-generated sheet.
