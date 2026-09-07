# Compact trees V7

Placement update2026-09-06 (latest user revision): FOREST uses independent seeded
integer-cell candidates with overlapping crowns, dense cores and falloff/clearings. Plain
grass and coastal species remain sparse. This changes placement, not source
art dimensions/palette. See `../WORLD-FINISHING-2026-09-06.md` and
`screenshots/world-finishing-final/` for current runtime evidence.

Supersedes the16×32V6 tree profile, including the old small flowering tree.
Sources: `assets/pixel-city-pack/reference/ai-authored/compact-trees-v7`.
All17species have independent AI-authored sources, pinned source/runtime hashes,
native scale review and alpha masks. Built-in ImageGen was used, not code painting.

## Dimensions and visual grammar

- Canvas16×16, anchor8,16, logical planting footprint1×1cell (8px).
- Living trees: at most12px wide,8–14px high; the low willow and cedar are
  intentionally broader/shorter. Deadwood at most8×9. No runtime rescaling.
- Source ground contact reaches row15; rows14–15 stay within x4..11. The
  runtime places that bottom-center anchor at the CENTER of the logical cell,
  not its lower edge. Debug guides must use the same transform and draw beneath
  the sprite, otherwise they obscure half of a compact tree.
- High45 frontal-top, broad stepped upper canopy, compressed front bands,
  short trunk, screen-aligned square clusters. No realistic leaf noise, smooth
  shading, thick near-black perimeter or baked ground shadow. Palm fronds and
  willow fringe are deliberate species-specific overhead silhouettes.
- Muted olive/sage/teal greens; cream/rose/rust accents are restrained and grouped
  by grove. Compare native and nearest-neighbour views beside48×24 and48×32 homes.
- At most12colors including transparency; hard alpha. Mechanical uniform crop,
  nearest-neighbour scaling, palette quantization and magenta keying only.
  Color key removes magenta halo where min(red,blue)>90 and green<.75min(red,blue).
  Never manually reshape a crown to satisfy the validator.

## Placement

Sparse natural trees use a deterministic world-coordinate local-minimum test over3×3
origins. Forests instead admit64% of integer anchors through an independent hash,
then apply grove density: adjacent crowns may overlap, trunks remain unique,
and results never depend on chunk traversal order. Groves choose one seeded species, with denser cores,
broken edges and occasional clearing patches. Grass trees stay rare; palms belong
to dry coastal sand and willows to green shores.

The shared conservative crown envelope covers x−1..x+1,y−2..y from the planting
cell. It protects buildings, access paths, construction reservations, water and
other props. Task parks reserve the final layout before revealing its stages;
small parcels may omit a tree when it cannot fit safely. Frontage furniture must
still be placeable when a tree has no safe candidate.

Chunk decoration context carries version7 and compact off-chunk obstacle runs.
The materializer samples a four-cell terrain/surface halo shared with street
lightingVersion1 for clearance and spacing only; it never
renders or spawns that halo. Stale cached decoration contexts are rebuilt, not
interpreted through an old-tree compatibility path. No per-tree database rows.

## Acceptance

Run `assets:build` then `assets:verify` serially, and the tree planting preview.
Check native source hashes, alpha/contact/crown bounds and actual CITY forests,
frontages and parks. Unit tests cover spacing, chunk splits/order, negative
coordinates, blocked crowns, biomes, seeded clearings and stage-stable parks.
World screenshots and measured dense-world cost remain separate release gates;
the authoring review alone is not production acceptance.
