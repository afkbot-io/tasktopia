---
name: tasktopia-map-visual-verifier
description: Audit Tasktopia PLANET, COUNTRY, and CITY rendering, interaction, pixel-art cohesion, geography continuity, network behavior, and first-frame reliability. Use for map hotfix QA, screenshot review, renderer regressions, or release acceptance involving any world view.
---

# Tasktopia map visual verifier

Use the pixel-art rules in `../tasktopia-pixel-city-art/SKILL.md` and treat a clean automated suite as necessary but insufficient.

## Automated gate

- Run lint, typecheck, the relevant unit/integration tests, and a production build.
- Run browser tests with WebGL enabled at desktop, tall desktop (including `1440×1100`), and compact viewport sizes.
- Assert CITY loads through exactly one `/cities/:id/scene` request and makes no `/api/world/viewport` or `/api/chunks/*` requests.
- Assert the scene covers every chunk intersecting the city's canonical bounds.
- Assert city pan changes the camera and reveals already loaded terrain, buildings, trees, shrubs, and props.
- Assert CITY zoom stays `0.8..4` for both small and large cities, and `data-minimum-render-scale` reports0.8 after resize. Local canonical padding must cover any exposed exterior without extra chunk/entity reads. A further outward step at0.8 enters COUNTRY without a timed hold. The retired viewport-dependent zoom floor is not an acceptable way to hide missing padding.
- Assert each parent/child transition preserves the selected territory focus.
- Assert clicking a task paints a modal loading shell in the same frame, before its details request completes.
- Fail on uncaught exceptions, WebGL draw errors, passive-listener warnings, or Pixi container deprecations.

## Native-pixel visual gate

Capture PLANET, COUNTRY, and CITY at native `1x`; inspect nearest-neighbour `4x` copies when individual pixels are ambiguous.

- Projection: terrain cells, props, vehicles, residents, and buildings share one top/frontal-top camera family.
- Scale: country cells are no larger than their planet counterparts at the transition boundary; city sprites preserve the `8x8 px` gameplay grid.
- Geography: compare at least one mountain/coast/river/forest and one diagonal neighbour across all three levels. Identity and relative direction must remain stable.
- Semantic projection: COUNTRY v7 draws one compact house icon per block, PLANET v4 one per district, at their canonical relative positions. Do not require the retired occupancy-code raster or a detailed city screenshot at either overview level. Preserve recognizable city extent and relative geography without stretching a house across it; verify4×4/2×2 material patches independently of geographic cell size.
- Boundary: COUNTRY inherits ocean, coast, or neighbouring land from PLANET. Reject white side walls, artificial water moats, soft ellipse masks, or textures outside the atlas bounds.
- Planet aperture: it is one coherent world silhouette at every zoom and aspect ratio; reject circle-plus-rectangle/keyhole frames.
- CITY v4: inspect the full resident navigable bounds and exterior padding, not only the opening viewport. Use settled queue state for composition screenshots, but also sample actual wheel/drag/resize frames: a final screenshot cannot certify absence of transient blank terrain. Compare actual native atlas pixels across resident/padding seams and natural-tree origins/depth; include prune, warm return, explicit Retry and teardown. Old tiny-scatter sprites are not required.
- Roads: compare actual COUNTRY route IDs and CITY exit pixels to the canonical network. Check dry projection, boundary continuation and no extra reads. Record unavailable-route reasons and connected-component counts; a passing partial-network test is not evidence that every city is connected.
- Airports: routes require completed task-backed endpoints. Test no airport, one airport and two eligible airports; a ten-city or two-airport fixture is evidence only after it is actually created and verified. CITY's bounded `airportConnections` may reach a remote city without loading that city's chunks.
- Cohesion: hard alpha, muted palette, crisp nearest-neighbour scaling, upper-left light, blue-grey outlines, and no vector-smooth primitives that conflict with authored sprites.

## Release evidence

Record the tested immutable revision, viewport sizes, request trace, console errors/warnings, screenshots for all three levels, auth/registration result, health result, and a short server-log observation. Any failed item blocks release and invokes the documented managed rollback path.
