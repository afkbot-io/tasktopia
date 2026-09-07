# World finishing — implementation and evidence

Current scope (local branch; no production deployment):

1. Restore seeded grid forests with overlapping crowns, unique trunks and protected roads/access. Fix CITY zoom limits independent of city size. Test negative coordinates, chunk ordering, dense and sparse areas, small/large viewports.
2. Add a shared continuous day/dawn/dusk/night clock and inexpensive city illumination. Preserve readable labels and UI, respect reduced motion, verify lamp positions and deterministic preview states.
3. Trace real intercity geography and road endpoints; connect city streets to the boundary in the direction of actual neighbours without fabricated water crossings.
4. Author ~10 additional AI building families, individually derive stages 5→4→3, verify geometry/alpha/palette/native scale before catalog integration. Expand park/courtyard props without obstructing access. Review airport/rail/services and all stage mappings.
5. Refine COUNTRY/PLANET glyph variety and terrain presentation with the same geography. Verify transitions, label occlusion and task opening.
6. Run real-time traffic evidence at 60s and 300s; measure queues, illegal crossings, stuck agents and simulation cost. Run regression/build/assets gates and browser screenshots before any release-readiness claim.

Status: in progress. Previous RC evidence is not fresh evidence for these changes.
Production rollout/regeneration remains a separate verified and authorized action.

## Implemented locally

- Forest placement admits seeded integer-cell candidates with overlapping crowns,
  dense grove cores and clearings. Plain grass retains sparse planting. Crown
  masks still protect roads, water, reservations, footprints and entrances.
- Small 6×3 homes can receive frontage furniture; a compact planter replaces a
  tree when no candidate can safely fit its crown. No synthetic task is created.
- CITY has a fixed 0.8–4 zoom interval and the same 160×100-cell opening frame.
  Visible terrain outside the resident city is generated from the same seed,
  without adjacent-city/chunk/entity requests. It does not invent roads.
- Superseded lighting prototype: the20-minute session cycle and header selector
  have been removed. Current real Europe/Moscow lighting and fresh evidence are
  in `MOSCOW-LIGHTING-AND-BUILDING-EXPANSION.md`; the historical clock tests below
  are not acceptance evidence for that replacement.
- CITY has continuous ambient tint, warm stepped lamp pools, matching illuminated
  street/park lamp textures and restrained tree/lamp ground shadows. Number
  plaques, tooltips and navigation are not tinted. COUNTRY/PLANET use ambient
  brightness on artwork only; they do not simulate individual street lights.
- PLANET district miniatures select deterministically from at least ten already
  reviewed house families, preserving their individual proportions. These are
  existing reviewed assets, not the ten new draft families below.

## Fresh evidence and review

Base HEAD `b42fe5946350897dbb9b3bb904b0262dd591783d`, branch
`codex/task-14-block-runtime-integration`, dirty local integration worktree. This
is not an immutable release candidate; earlier user changes remain in place.

- Full suite: 781 tests /157 files passed, `tmp/world-finishing-tests-final.log`.
  The subsequent one-line nullable Pixi-label fix is exercised by the browser
  regression. The final targeted lighting/clock/camera/miniature run passed
  14 tests /4 files (`tmp/world-finishing-unit-final.log`), including the new
  shared-epoch, unsubscribe and reduced-motion test.
- Production build: passed, `tmp/world-finishing-build-final.log`.
- Lint: passed, `tmp/world-finishing-lint.log`.
- Registered compact asset gate: passed for the existing reviewed catalog.
  Unregistered new drafts are deliberately excluded from that release gate.
- Browser: `block-infill.spec.ts` passed in23.1s after fixing the null-label
  crash in park lighting. It exercises96 tasks/3 districts, stages1/3/5 of
  public spaces, narrow park click targets, correct task modal identity, plaques,
  district boundaries, all lighting previews, map round trip and390px mobile.
  Exactly one scene/overview/planet-atlas read and no chunk/viewport reads were
  observed in that journey. No unexpected browser errors. The final extended
  run also checks fixed0.8 CITY minimum and actual nighttime filters/screenshots
  on COUNTRY and PLANET.
- Screenshots: `screenshots/world-finishing-final/`. Visual review confirms
  readable nighttime plaques and overlapping forests, but also finds oversized
  COUNTRY terrain cells and miniature-to-territory scale needing further work.
- CPU workload: `tmp/world-finishing-cpu.json`. Local1000-task/20-district
  compilation p95=83.913ms;64² forest generation p95=5.635ms; infill p95=0.395ms.
  Denser forests intentionally cost more than the preceding sparse baseline.
  These are CPU microbenchmarks, not browser/DB/production latency guarantees.
- Actual300.102-second browser traffic run passed on40 tasks/3 districts with
  14 cars/25 pedestrians. Both agent types moved in all30 ten-second windows;
  no unsafe pairs, wrong-way cars, off-path pedestrians or post-path conflicts.
  At60.121s:30 completed trips and299 cumulative crossings; at300.102s:206
  trips and1500 cumulative crossings (1493 new crossings during sampling).
  Peak waits: vehicles7.3s, pedestrians13.2s; network built once. Simulation
  step p95=2.0ms/max3.2ms. Full report and samples:
  `screenshots/world-finishing-traffic-final/`; log:
  `tmp/world-finishing-traffic-final.log`.
- Frame performance is **not a clean60fps claim**: p50=23.7ms, p95=26.8ms,
  max150.7ms and33 observed long tasks of50–155ms on the local workstation.
  The safety/movement gate passed, but these stalls still need attribution
  before claiming ideal smoothness or release readiness. The earlier run with
  no long tasks is not substituted for this latest result.
- RepoWise structural refresh (no model calls/editor setup):678 files,
  1897 symbols, same base HEAD; `tmp/world-finishing-repowise.log`.

The main-agent review checked the new lighting, camera padding, forest/frontage
and overview selection paths against the request. The confirmed runtime defect
was an unguarded `Container.label.startsWith`: Pixi initializes unnamed labels
to null. The existing public browser journey was red before the null guard and
green afterwards. No timeout was increased to conceal the failure.

## New AI building candidates — two now published, eight still drafts

Ten independent finished-building sources were generated with built-in ImageGen:
blue-bay, copper-court, garden-house, ivory-library, olive-cafe, plum-workshop,
rose-clinic-annex, rust-loft, sand-balcony and teal-mansard (`compact-…-v1`).
Sources, common-frame normalization and reports are under
`assets/pixel-city-pack/reference/ai-authored/<family>/`.
Comparison: `tmp/new-building-art/native-contact.png` (native and nearest4×).

All ten stage5 drafts passed the automated occupied-size/alpha/palette checks;
that alone was not projection/style approval. The subsequent
[building-diversity pass](BUILDING-DIVERSITY-PASS.md) corrected and reviewed
blue-bay and copper-court through5→4→3, published them and checked all their
five stages in the real browser. The other eight remain unregistered drafts.
Foundation/frame tolerances were not relaxed to admit a failed source.

## Remaining acceptance blockers

1. Actual intercity road ownership and CITY exits: current semantic network is
   block perimeters only. COUNTRY `connections` are flight routes, not a road
   graph. A real route needs terrain-safe endpoints, shared geographic geometry,
   preservation during block growth, country projection and migration/cache
   tests. No decorative fake connector has been added.
2. Eight remaining complete, individually reviewed5→4→3 building families and their catalog
   integration; additional newly authored courtyard/park props. Current planter
   placement uses the existing reviewed asset set.
3. COUNTRY/PLANET visual scale and terrain refinement, plus fresh large-country,
   airport/rail/services and all-family-stage visual acceptance. Existing tests
   are not a substitute for these specific fresh screenshot reviews.
4. Exact committed/reviewed release candidate, complete regression evidence,
   frame-stall attribution, target-environment backup/restore,
   migration/regeneration rehearsal and the
   existing managed deployment gates. No production database or server was
   modified in this slice.
