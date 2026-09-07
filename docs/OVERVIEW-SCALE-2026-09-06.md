# Overview material scale — local implementation

Scope: presentation only; no geography, city/block placement, API, simulation,
road or authored-asset mutation. Before screenshots:
`screenshots/building-diversity/country.png` and `planet.png`.

The COUNTRY before frame has roughly100-screen-pixel semantic terrain squares
against18-pixel block miniatures. Enlarged material motifs dominate the town.
`overviewTerrainPatches` now partitions that same rectangle into4×4 material
patches; PLANET uses2×2. Every patch inherits its parent's terrain family,
and the outside directional joins inherit its unchanged neighbour mask. This
does not subdivide the domain map or introduce a new coast/forest/river.

Country block/district glyph positions, one-house-per-block/one-house-per-district
meaning, individual sprite proportions, airport points, ownership, camera and
selected-country/city transitions are unchanged. CITY stays0.8–4. Future real
intercity roads require the separate canonical route implementation, not this
material layer.

## Determinism and resource bounds

- Material selection depends only on level, inherited family, canonical grid
  coordinate and directional mask. No clock, camera, response order or random
  state is involved; refresh/reload preserves the picture.
- COUNTRY keeps its original raster size: `(columns*cellSize*4)` by
  `(rows*cellSize*4)`, four RGBA bytes per pixel. The number of one-time terrain
  draws is16 per semantic cell rather than1. There are no extra texture URLs,
  HTTP requests, canvas nodes or camera-frame terrain draws.
- PLANET has four sheet windows per macro cell rather than one, without new
  texture URLs. The memoized material subtree is invariant during camera
  motion: only its outer rectangle changes. The one ocean pattern is unchanged.
  The DOM/draw multiplier is explicitly bounded4×; its real browser cost is a
  pending acceptance gate, not an assumed speedup.

## Verification checkpoint

RED: missing new public material-planning seam. GREEN on Node24:40 tests in
9 files, including all four edge masks/negative coordinates, exact normalized
coverage, inherited terrain families, stable variants, unchanged country and
planet projection, building art, wheel gate and visible-country filtering.
Scoped ESLint passes. No database writes or global asset/build execution.

`tests/e2e/overview-material-scale.spec.ts` is an opt-in read-only browser
journey for the isolated96-task block-plan fixture. It records actual raster
dimensions and screen-space material/glyph sizes; captures desktop/mobile
COUNTRY and PLANET; checks district identities, retained CITY and exactly one
scene/overview/atlas read with zero chunk/viewport reads. It must run after the
coordinated production build with `E2E_OVERVIEW_MATERIAL_FIXTURE=true`.

Browser screenshots, measured first-frame/large-country cost and final visual
acceptance are pending. This source checkpoint does not claim the terrain
refinement or broader world-finishing release is fully accepted.
