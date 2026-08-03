# World and sprite verification specification

## Scope

Verify the current square-grid MVP before changing art or generation. Regeneration is permitted only for assets that fail a repeatable geometry/style gate or produce a visible runtime defect.

## World acceptance

- The 10-seed, three-city/three-district/30-task-per-city soak has zero topology, overlap, access, zoning, stage, service, or diversity violations.
- A 10-city scale world with eight districts and at least 25 tasks per city has connected national roads, non-overlapping city/district/task geometry, and bounded generation/chunk time.
- Growth checkpoints preserve all previously placed tasks, completed district geometry, and existing roads while reaching at least 100 tasks.
- A representative large city reaches 200 tasks with exactly one active district, one planned district, and all older districts completed.
- PRIVATE districts contain no dense-residential buildings; NEW_BUILD districts contain no private-residential buildings.
- Every task footprint lies inside its district and has pedestrian or road access.

## Sprite acceptance

- Manifest, catalog, and runtime files reference the same building keys.
- Every building has exactly five non-empty RGBA stages with identical native dimensions.
- Dimensions and declared footprint use the 8 px grid; anchors remain bottom-centre and inside the canvas.
- Alpha is hard (`0` or `255`), no unexpected transparent halo is introduced, and non-transparent bounds stay inside the canvas.
- Construction stages have a stable footprint/anchor and progress from site/foundation/frame/shell to the completed silhouette.
- Runtime props/vehicles referenced by the manifest exist and match declared sizes.
- The generated contact sheet and real in-game views show one camera, outline family, palette and pixel density.

## Browser acceptance

- Login, cold map load, district toggle, task modal, zoomed overview, city switching and mobile viewport pass without console errors.
- A representative world exposes cars, walkers and resident chunks after cold warm-up.
- Production build, Docker healthcheck, unit tests, lint, typecheck and GitHub CI remain green.
