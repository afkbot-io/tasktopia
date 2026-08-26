---
name: tasktopia-map-visual-verifier
description: Audit Tasktopia PLANET, COUNTRY, and CITY rendering, interaction, pixel-art cohesion, geography continuity, network behavior, and first-frame reliability. Use for map hotfix QA, screenshot review, renderer regressions, or release acceptance involving any world view.
---

# Tasktopia map visual verifier

Use the pixel-art rules in `../tasktopia-pixel-city-art/SKILL.md` and treat a clean automated suite as necessary but insufficient.

## Automated gate

- Run lint, typecheck, the relevant unit/integration tests, and a production build.
- Run browser tests with WebGL enabled at desktop and compact viewport sizes.
- Assert CITY loads through exactly one `/cities/:id/scene` request and makes no `/api/world/viewport` or `/api/chunks/*` requests.
- Assert the scene covers every chunk intersecting the city's canonical bounds.
- Assert city pan changes the camera and reveals already loaded terrain, buildings, trees, shrubs, and props.
- Assert the minimum CITY scale is `0.8` and the next outward wheel step enters COUNTRY without a timed hold.
- Assert each parent/child transition preserves the selected territory focus.
- Assert clicking a task paints a modal loading shell in the same frame, before its details request completes.
- Fail on uncaught exceptions, WebGL draw errors, passive-listener warnings, or Pixi container deprecations.

## Native-pixel visual gate

Capture PLANET, COUNTRY, and CITY at native `1x`; inspect nearest-neighbour `4x` copies when individual pixels are ambiguous.

- Projection: terrain cells, props, vehicles, residents, and buildings share one top/frontal-top camera family.
- Scale: country cells are no larger than their planet counterparts at the transition boundary; city sprites preserve the `8x8 px` gameplay grid.
- Geography: compare at least one mountain/coast/river/forest and one diagonal neighbour across all three levels. Identity and relative direction must remain stable.
- City silhouette: no generic square marker; its occupied cells follow current city/district extents.
- Boundary: COUNTRY inherits ocean, coast, or neighbouring land from PLANET. Reject white side walls, artificial water moats, soft ellipse masks, or textures outside the atlas bounds.
- Planet aperture: it is one coherent world silhouette at every zoom and aspect ratio; reject circle-plus-rectangle/keyhole frames.
- CITY: inspect the full navigable bounds, not only the opening viewport. Trees, shrubs and ambient objects must remain visible and correctly anchored.
- Cohesion: hard alpha, muted palette, crisp nearest-neighbour scaling, upper-left light, blue-grey outlines, and no vector-smooth primitives that conflict with authored sprites.

## Release evidence

Record the tested immutable revision, viewport sizes, request trace, console errors/warnings, screenshots for all three levels, auth/registration result, health result, and a short server-log observation. Any failed item blocks release and invokes the documented managed rollback path.
