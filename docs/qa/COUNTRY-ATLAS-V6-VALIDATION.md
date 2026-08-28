# Country Atlas V6 — validation contract

This document is the release gate for the lightweight COUNTRY map. A change is
not accepted from one attractive screenshot: the same canonical geography,
city identity and camera continuity must survive several deterministic worlds.

## Deterministic fixtures

The validation seed must contain at least three countries and three city forms:

| Fixture | Macro geography | City form | Required evidence |
| --- | --- | --- | --- |
| Island | land surrounded by ocean | compact, one district | PLANET and COUNTRY coast silhouettes, airport, COUNTRY miniature |
| Coast | coast with a diagonal neighbouring country | elongated, two or more districts | the diagonal neighbour direction, water side and city aspect ratio |
| Inland | forest, hill/mountain and river macro cells | irregular multi-district | the same terrain families in PLANET and COUNTRY and a non-rectangular city silhouette |

Fixtures use stable seeds and IDs. Visual tests capture desktop `1440×900` and
mobile `390×844` views. Every pixel-art crop is reviewed at native `1×` and at
nearest-neighbour `4×`; browser interpolation is a failure.

## Screenshot matrix

For every fixture capture:

1. PLANET at minimum, entry and maximum zoom.
2. COUNTRY at fit, `1.6×` and maximum zoom.
3. CITY immediately after COUNTRY entry at scale `0.8`, before pointer movement.
4. The reverse CITY → COUNTRY → PLANET transition, centred on the source city
   and country rather than reset to the global top/centre.
5. A COUNTRY frame with at least one aircraft at its airport and one in flight.

The automated comparison uses a stable mask for animated aircraft/clouds. The
static terrain and city layer has a strict golden image; the complete frame uses
a perceptual threshold. Review also records country coastline overlap, city
silhouette occupancy and aspect-ratio drift.

## Data and geography gates

- COUNTRY geography is derived from the selected PLANET macro cells. Each
  COUNTRY cell retains its owning macro-cell ID and terrain family.
- COUNTRY has no synthetic inter-city roads and never transfers CITY roads,
  surfaces, buildings, props, trees or full district cell lists.
- A city overview is a bounded semantic snapshot where one overview cell
  represents one fixed `8×8` CITY block. Parallel code strings retain dominant
  terrain/district, coverage and four-quadrant occupancy plus the airport
  anchor. It preserves aspect ratio and never bitmap-compresses the CITY scene.
- The payload contains at most `800` country terrain cells; each city contains
  exactly `ceil(width/8) × ceil(height/8)` semantic cells instead of per-object
  geometry. The ten-city fixture remains below `200 KB` uncompressed and is
  served by exactly one scoped overview request.
- The built projection is stored in `country_overview_snapshots_v1` and reused
  only when user, country, schema and PLANET revision match. CITY rows remain
  canonical and no overview mutation is written back into them.
- CITY entry still performs exactly one city-scene request. Pan and zoom perform
  zero `/api/world/viewport` and `/api/chunks/*` requests.

## Renderer and performance gates

- COUNTRY scene contains one immutable raster canvas, zero scene SVG nodes and no per-cell
  React elements. Labels are the only DOM overlay.
- PLANET and CITY use native `8×8` terrain sheets and COUNTRY uses native
  `16×16` sheets. All four principal families (mountain, water, plain and sand)
  expose deterministic N/E/S/W joins; no level scales another level's sheet.
- Pointer movement mutates a local camera and schedules at most one RAF; it does
  not call React state setters. Wheel zoom passes through observable intermediate
  values and converges independently of display refresh rate.
- Twenty wheel events and an 18-step drag produce no long task over `50 ms` on
  the ten-city fixture. First coherent frame is below `2 s` on a cold browser.
- The static terrain/city graphics are built once per overview revision.
  Aircraft animation is bounded to five routes and does not rebuild the scene.
- Textures remain inside the planet/country mask. There are no white side bars,
  square cut-outs, WebGL buffer errors, passive-listener warnings or Pixi
  deprecation warnings.
- Ten PLANET ↔ COUNTRY ↔ CITY cycles keep exactly one active map renderer and do
  not grow renderer count or retained texture owners.

## Interaction gates

- Wheel zoom is cursor-centred. Drag, keyboard pan and click/tap city selection
  remain available.
- Zooming out at the COUNTRY minimum enters PLANET immediately after hysteresis;
  zooming into a city enters CITY only after the city target threshold.
- COUNTRY → CITY starts at `0.8`, showing the complete city without pointer
  movement. Reverse navigation restores the previous COUNTRY/PLANET focus.
- PLANET surface and clipping aperture scale together while existing pan and
  cursor-centred zoom behaviour remains intact.
- Airport markers use one shared visual contract on PLANET and COUNTRY.
  Deterministic aircraft routes start/end at real airport anchors and remain
  visible in both map levels.

## Release sequence

Run unit and API tests, typecheck, lint, production build, asset audits, the
three-fixture Playwright matrix, console/network assertions and the performance
trace. A failed gate blocks release. After managed deployment repeat health,
auth/registration, first-frame CITY, `0.8` zoom, one-scene network and log smoke;
use the managed rollback runbook on failure.
