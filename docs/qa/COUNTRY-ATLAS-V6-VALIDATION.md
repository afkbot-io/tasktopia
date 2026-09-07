# Compact multi-level maps — validation contract

This document is the release gate for the lightweight COUNTRY map. A change is
not accepted from one attractive screenshot: the same canonical geography,
city identity and camera continuity must survive several deterministic worlds.
Updated 2026-09-05 for COUNTRY v5 / PLANET v4 / CITY v3; the historical filename
is retained for existing links. Retired occupancy rasters and a fixed CITY
minimum of `0.8` are not current acceptance rules. This is a checklist, not
evidence that fixtures or browser runs already exist.

## Deterministic fixtures

The validation seed must contain at least three countries and three city forms:

| Fixture | Macro geography | City form | Required evidence |
| --- | --- | --- | --- |
| Island | land surrounded by ocean | compact, one district | PLANET and COUNTRY coast silhouettes, airport, COUNTRY miniature |
| Coast | coast with a diagonal neighbouring country | elongated, two or more districts | the diagonal neighbour direction, water side and city aspect ratio |
| Inland | forest, hill/mountain and river macro cells | irregular multi-district | the same terrain families in PLANET and COUNTRY and a non-rectangular city silhouette |

Fixtures use stable seeds and IDs. The scale/performance fixture additionally
requires ten actual cities and two completed task-backed airport slots; verify
their IDs, statuses and physical slot centers before counting any route test as
passed. Pending AIRPORT roles or injected decorative feature rows are not
airport fixtures. Record NOT RUN while that setup or browser run is absent.
Visual tests capture desktop `1440×900`, tall desktop `1440×1100` and mobile
`390×844` views. Every pixel-art crop is reviewed at native `1×` and at
nearest-neighbour `4×`; browser interpolation is a failure.

## Screenshot matrix

For every fixture capture:

1. PLANET at minimum, entry and maximum zoom.
2. COUNTRY at fit, `1.6×` and maximum zoom.
3. CITY immediately after COUNTRY entry at its effective minimum, before pointer
   movement: fixed `0.8`, with same-seed local terrain beyond the resident city
   and no additional chunk/entity requests. Capture resize and
   edge-pan at the tall viewport too; black clear-space strips fail acceptance.
4. The reverse CITY → COUNTRY → PLANET transition, centred on the source city
   and country rather than reset to the global top/centre.
5. On the confirmed two-airport fixture, a COUNTRY frame at an airport and a
   later frame in flight. Separate no-airport and one-airport cases must have
   no invented routes.

The automated comparison uses a stable mask for animated aircraft/clouds. The
static terrain and city layer has a strict golden image; the complete frame uses
a perceptual threshold. Review also records country coastline overlap, city
silhouette occupancy and aspect-ratio drift.

## Data and geography gates

- COUNTRY geography is derived from the selected PLANET macro cells. Each
  COUNTRY cell retains its owning macro-cell ID and terrain family.
- COUNTRY has no synthetic inter-city roads and never transfers full CITY roads,
  surfaces, task geometry, props, trees or district cell lists.
- A COUNTRY v5 miniature contains uniformly projected semantic `blocks` and
  completed task-airport `airports`. Each block is rendered as one compact house
  icon; PLANET v4 draws one icon per district. Canonical centers and relative
  geography remain stable. The old coverage/shape/district strings and
  four-quadrant occupancy raster are not required or accepted as the new contract.
- The payload contains at most `800` country terrain cells and bounded semantic
  block/airport records, not per-pixel city geometry. The confirmed ten-city
  fixture has a `200 KB` uncompressed budget and is
  served by exactly one scoped overview request.
- The built projection is stored in `country_overview_snapshots_v1` and reused
  only when user, country, schema and PLANET revision match. CITY rows remain
  canonical and no overview mutation is written back into them.
- CITY entry still performs exactly one city-scene request. Pan and zoom perform
  zero `/api/world/viewport` and `/api/chunks/*` requests.
- CITY v3 `airportConnections` contains at most eight directed connections
  between completed task-airport slot centers of the same country, with at
  least one endpoint in the selected city. A remote endpoint does not fetch
  the remote city's chunks. Incomplete/deleted/foreign airports are ineligible.

## Renderer and performance gates

- COUNTRY scene contains one immutable raster canvas, zero scene SVG nodes and no per-cell
  React elements. Labels and bounded animated aircraft are DOM overlays.
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
- COUNTRY → CITY starts at its effective minimum, with a complete painted
  viewport before pointer movement. The `160×100` initial frame does not clip
  the full resident city scene. Read `data-minimum-render-scale`; tall/wide
  viewports may legitimately stop above `0.8`. Pan clamps to loaded chunk bounds
  without extra requests. Reverse navigation restores the prior country focus.
- PLANET surface and clipping aperture scale together while existing pan and
  cursor-centred zoom behaviour remains intact.
- Airport markers use one shared visual contract on PLANET and COUNTRY.
  Deterministic aircraft routes start/end at real airport anchors and remain
  visible in both map levels.

## Release sequence

Run unit and API tests, typecheck, lint, production build, asset audits, the
three-fixture Playwright matrix, console/network assertions and the performance
trace. A failed gate blocks release. After managed deployment repeat health,
auth/registration, first-frame CITY, viewport-safe minimum zoom, one-scene network and log smoke;
use the managed rollback runbook on failure.
