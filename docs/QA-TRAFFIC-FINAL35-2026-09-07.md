# Final35: preserved40-task browser traffic gate

## Build scope

This300-second measurement was performed before the final R4 Tailwind
source-discovery fix. That later change excludes art prompt tokens from CSS
scanning; application JavaScript and the mobility/render engine were unchanged,
but the emitted CSS and dependent bundle filenames changed. The300-second gate
was not repeated after that fix: it is prior-CSS-build performance evidence,
**not an exact-final-R4-bundle performance measurement**. The final byte-matched
host/image build instead received fresh48-stage, settled overview and focused
mobile/PWA acceptance, documented in `QA-COURTYARD-ART-48-2026-09-07.md`.

The frozen production client passed the complete300.020-second browser sample,
then task/district focus and COUNTRY/PLANET return (5.8min total test duration).
No seed, regeneration, geometry mutation or business command was performed.
An explicit PostgreSQL read-only transaction first confirmed the preserved
schema `compact_delivery_20260905_a`, city
`ec5d45dc-bcf5-43f7-91e4-cfd8ee7b9eef` (Riverside), country
`a8135fb9-973e-441b-9940-a0d9fde03f13`,40 tasks and3 districts. Its existing
canonical road snapshot was present; this run needed no derived-data repair.

## Workload and result

| Metric | Observed |
|---|---:|
| Population, unchanged for full sample |14 cars /25 walkers|
| Ten-second windows with both groups moving |30/30|
| Current and cumulative unsafe pairs, all3 pair types |0|
| Wrong-way cars, walkers off paths, road activities, pole conflicts |0|
| Vehicle /walker peak waiting |9.15s /8.90s|
| Completed trips /crossings during sample |217 /1513|
| Mobility fixed-step p95 /maximum |1.0ms /2.6ms|
| Network builds /retained CITY canvas |1 /same|
| RAF p50 /p95 /maximum |16.7ms /25.0ms /33.7ms|
| Observed RAF intervals /browser long tasks |18,253 /0|
| Unexpected console errors, failed requests, HTTP failures |0|

The scene and task geometry digest remained unchanged across the entire
journey: `89a6cf0025de1526ef6eacd0517dab5017e49f6ff8a8252b77c0e3bd86e59a64`.
Every one of the30 windows contains positive completed-cell transitions for
both populations. The raw100ms observations are preserved, including lifetime
unsafe totals from every fixed simulation step, rather than only an end frame.

This is **not a steady60FPS claim**. The prior `native-padding-traffic-final`
sample used NIGHT, asset revision `1f0db47e1c6f9291` and522 world objects;
this final run used DAWN, revision `750f26edc463160e` and520 objects. Stored scene
revision, city identity, population, viewport, camera and padding counts match,
but lighting, source/art revision and frame-timed trajectory are not an identical
A/B benchmark. The earlier sample had RAF p95=18.0ms/max33.3ms; final35 has
p95=25.0ms/max33.7ms. Both have0 long tasks. The original release-gap recording
(`world-finishing-traffic-final`) had p95=26.8ms/max150.7ms and33 long tasks.
These observations establish the current bounded gate; they do not isolate a
single cause for the differences in p95.

## Environment and artifacts

Started `2026-09-07T05:02:16.199Z`; Node24.19.0, Chromium151.0.7922.34,
macOS25.5.0 on Apple M5 Pro (18 logical CPUs). Headless graphics uses
ANGLE/Vulkan SwiftShader, not a physical-phone GPU. Viewport1440×1000, DPR1,
CITY scale1.05, camera106.29,−108.00;1184 padding trees,16 padding chunks,
10 terrain atlases and0 temporary native padding cells. There was no overlapping
build, other test, asset processing or screenshot during sampling. Captures
were taken afterwards. Profiling/CDP trace export was disabled for this gate.

Observed scene revision:
`dd0492e606bd83b48c337324b7cc270c8d157e855e1bb49b963b4520b519e718`.
WorldCanvas source SHA256:
`49ea1c9a3bdbbbe660f0055a50816b1e28bdad814ff219c6c873fe3420807e3a`.
Built server SHA256:
`bbf000192cb556306bd9cf270fa5ed0292802f19ceff4ecb56f4128fc19243b7`.

The anonymous startup401 and four startup driver ReadPixels warnings remain
in the report. All were before sampling; the transparent readPixels observer
recorded0 application calls. No warning was hidden or reclassified as a
measured frame stall. Physical-device/browser-vendor performance remains a
separate release check.

Evidence directory: `screenshots/world-finishing-final35-traffic-300s/` contains
`metrics.json`, `mobility-samples.json` and post-sample CITY/district/COUNTRY/
PLANET images. Console timeline, raw movement windows and full environment are
inside the metrics. Log: `tmp/world-finishing-final35-traffic-300s-20260907.log`.
Read-only precheck: `tmp/final35-baseline-readonly-check-20260907.json`.

Reproduction: set `CI=true`, `E2E_BASE_URL=http://127.0.0.1:5197`,
`E2E_DATABASE_URL=postgres://tasktopia:tasktopia@127.0.0.1:5432/tasktopia_test?options=-csearch_path%3Dcompact_delivery_20260905_a`,
`E2E_MOBILITY_FIXTURE=true`, `MOBILITY_SAMPLE_DURATION_MS=300000` and a fresh
`MOBILITY_SCREENSHOT_DIR`. Use the builtserver/VAPID-disabled command documented
in `QA-COURTYARD-ART-48-2026-09-07.md`, never the default seed/build command.
Run `node --import tsx node_modules/@playwright/test/cli.js test tests/e2e/city-mobility.spec.ts --project=chromium --workers=1`.
