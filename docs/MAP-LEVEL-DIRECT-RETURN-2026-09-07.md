# Direct map-level return — 2026-09-07

The bottom navigation now offers the current authorized country from PLANET and
the last selected city from either overview level. CITY alone is unavailable
when there is no selected city. Selecting the already active level is a no-op.
This does not select another country, change authorization, bypass wheel gates,
clear task focus, or replace the retained CITY canvas/prepared scene.

## Scope and regression

Only `MapLevelNav` and its `App` navigation callback changed. Before the fix,
the real overview journey timed out on a disabled COUNTRY button; the focused
component regression failed 6 of 8 cases. After the fix, these 8 cases and the
existing transition component test pass. Production build (including typecheck)
and scoped ESLint pass.

Fresh Chromium production journeys ran serially against the preserved local
`block_plan_preview_53273d1097dd44798f13b315b25395e2` schema, on port 5197 with
provider push disabled. No seeding, world regeneration or business mutation was
performed. The fixture contains one city, three sprints and 96 tasks; its scene
revision is `61d42ca1bcb32013f42523ef657989ea9142d356492d24a0781b418d5d0ce280`.

- `overview-material-scale.spec.ts`: PASS, 5.3 seconds. Direct PLANET → CITY
  takes 346 ms including the transition-cover settling in this one local run;
  this is not a percentile or real-device latency claim. Exact CITY camera
  `(96, -128)`, scale `1.175`, original canvas identity and ambient session are
  preserved. Mobile PLANET → COUNTRY → CITY also passes.
- `block-infill.spec.ts`: PASS, 13.3 seconds. All 96 tasks are represented by
  six block plaques; task-backed park stages 1, 3 and 5 open the correct tasks.
  District boundaries, lighting phases and the mobile round trip remain valid.
- Each journey makes exactly one scene, one country-overview and one
  planet-atlas GET. There are no viewport/chunk requests or browser/API errors.
  Overview warnings are limited to the intentionally blocked service worker and
  screenshot-related WebGL `ReadPixels` performance messages.

## Visual review and limits

Fresh screenshots are in `screenshots/release-completion-overview` and
`screenshots/release-completion-districts`. Desktop country materials are sharp
and distinguish grass, forest, sand and water. The measured material patch is
12.22 screen pixels versus a 17.72-pixel block glyph; the backing raster remains
576 × 352. PLANET preserves the same island/forest arrangement, with three
distinct district IDs and 80 land macro cells (four material subcells each).
CITY has connected streets, compact plots, visible construction phases and
separate district outlines; no missing-ground rectangle was observed.

At the mobile whole-planet fit, miniature districts and the country label are
necessarily very small; this pass proves navigation and material continuity,
not readable individual buildings at every zoom. Country water outside the
bounded terrain raster remains the existing flat background. Neither detail
was changed by this navigation slice. These short journeys are not a traffic
frame-rate, large-country scale or native mobile/PWA benchmark.

Evidence reports: `docs/evidence/map-direct-return-20260907/`.

## Source checkpoint

SHA-256 at verification:

- `MapLevelNav.tsx`: `6e62d16896ee1abd2499fa7595f206e49ea39fcb1bd2c3ea6c2dc1ac5f6dd9bd`
- `App.tsx`: `8b3b3070c85c7e89cc9a9e5ebd6e7a7a15519da58ae089f58201e182da661d06`
- `map-level-nav.test.tsx`: `220f6592b9d8df7a552151e5150e463b526741d348355af58a77af9750f36c6b`
- `overview-material-scale.spec.ts`: `5882eaa49994e36074372c06875e20303af80957fe23600200219fa6285642e5`
