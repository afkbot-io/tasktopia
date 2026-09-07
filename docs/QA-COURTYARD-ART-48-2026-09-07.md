# Developed courtyard art: final48-case browser evidence

## Final R4 exact-build acceptance

The final R4 repeat passed on the same66-task fixture:48-case art gate in2.9min,
settled overview recapture in4.8s, and4 focused deep-link/mobile/PWA tests in17.2s
(one explicitly unsupported WebKit service-worker case skipped). All four exact
native-pixel probes below again matched100%. No production source, fixture data,
acceptance threshold or test harness changed for this repeat.

This is the final Tailwind source-discovery build, not the preceding R3 bundle.
The read-only image audit at
`docs/evidence/compact-rc/final35-r4-image-static-audit.json` proves all601 built
files byte-identical between the tested host build and local image
`sha256:03537a60affa4ab51964a6d95cdaa0e5c28ef71ad32a21e8c7dd4cedfadb351f`.
Their aggregate SHA256 is
`5c38fee79ae8b81b7862b2801a4a778d04139c98882dd2206e72f6593843863e`;
all511 revision files also match, aggregate SHA256
`9482ea696ce175c10b9299b6bbfcf17cefacd720e2904df542e2b676a02e9840`.
This is local image compatibility evidence, not a deployment claim.

## Scope and exact fixture

The actual local production build uses asset revision `750f26edc463160e`
(35 published families). The new disposable schema is
`courtyard_art_preview_722d785067dc4440ae5a893b03717c7e`, seed424242;
country `a25c2d61-d5fa-45c1-a755-bc25b65a7693`, city
`d6f46df7-aab7-46d5-bf12-feda2cfb6d8b`.
Its scene revision is
`8f074c327c4b41408f37302840b659bac44b7ec62d6a7076c2bbc58a8e83786a`.

The fixture contains13 authored families × stages3/4/5 and3 park variants ×
stages3/4/5:48 requested cases. Eighteen additional named tasks consume actual
public infrastructure reservations, giving66 total tasks in3 sprints,
21 blocks and24 furniture placements. No placement coordinates, role overrides
or SQL task transitions are used. Seed creation took13.24s; world audit found0
violations. This is a developed-art matrix, not a fully occupied city:
92 parcels remain reserved for future real tasks.

The original12-connector cap stopped safely in schema `af0b86…`; a retry-loop
off-by-one stopped the next attempt in schema `e52ac373…`. Both full schema
names and logs remain under `tmp/courtyard-art-48-seed-*-red-20260907.log`.
The approved fixture-only limit is24 genuine connectors and3 retries after
the initial attempt. A unit test proves3 conflicts→success and4 conflicts→fail
without consuming a fourth connector. Production reservation policy is unchanged.

## Browser results

`tests/e2e/courtyard-art.spec.ts` on Chromium passed in2.9min using the same
66-task fixture, without reseeding. All48 individual stage captures assert
the full projected target footprint is visible, no task modal or transition
overlay obscures it, and two animation frames have settled before capture.
Finished buildings/parks open their correct task; the already-read apartment
revisit intentionally uses the task-detail cache rather than demanding another GET.

| Exact native4× opaque RGB probe | Matched | Acceptance |
|---|---:|---|
| Picnic table |141/141|100%|
| Cycle rack |42/42|100%|
| Square planter |54/54|100%|
| Vertical stage3, ROI `[2,2,46,86]` |3696/3696|100%|

All probes retain the strict `>95%` gate with only±4 screen-pixel registration
phase search. The fixed building ROI excludes its intentional outer fence and
bottom badge; the other building families were captured and source-verified,
not claimed to have this additional pixel-level runtime probe. Separate native1×
captures distinguish source readability from enlarged image display.

The run made exactly1 CITY scene,1 COUNTRY overview and1 PLANET atlas request;
no viewport/chunk requests, failed requests, console errors or domain writes.
The desktop harness intentionally blocks service workers; its warning and GPU
driver ReadPixels warnings are recorded, not concealed or attributed to an
application readback without a call stack.

Day is clock-controlled at09:00UTC and night at18:00UTC on2026-09-07, with live
timers. NIGHT reaches lamp intensity1 with42 lamps, unchanged1000 static prop
particles and the same retained CITY canvas. No lighting dropdown is used.

Real mouse slow-drag integration passes12×1px movement,650ms held pause, release
without opening a task, then a normal correct-task click. A separate zero-motion
two-contact sequence exercises actual DOM PointerEvent→Pixi integration and
staggered releases. It is synthetic event coverage, not physical-device touch QA.

## Screens and follow-ups

Primary48-stage, native1×/4×, city and boundary evidence:
`screenshots/courtyard-art-48-final-r4/`, including `evidence.json`.
The scoped recapture passed in4.8s and contains the final COUNTRY, PLANET and
clock-controlled night images at
`screenshots/courtyard-art-48-final-r4-overviews/` (again1/1/1 reads, errors0).
The final PLANET image was also visually inspected: its terrain and country
label are visible without the earlier transition overlay.
The original R3 `planet.png` was captured before that overlay disappeared;
it remains preserved but is **not** final planet visual acceptance. The other
R3 artifacts and settled recapture remain historical evidence of the prior build.
The earlier accidental-modal screenshots remain in
`screenshots/courtyard-art-48-modal-red/`; partial R2 images are not a full gate.

Focused follow-ups passed4 tests in17.2s: pending-terrain deep-link in Chromium,
mobile controls/touch zoom in Chromium and WebKit, and real revisioned service
worker/offline shell in Chromium. WebKit's SW lifecycle case is explicitly
skipped because Playwright does not provide production-equivalent coverage.
Screens: `screenshots/courtyard-art-48-final-r4-mobile/`.
No push opt-in mock, provider send, production deployment or physical-device
installation was performed; those are not implied by browser-emulation results.

The fixture deliberately has no MOVE/RUIN history. Negative furniture/history
and planned-site chunk-boundary masks are covered by the separate real producer
and serialized materializer regressions, not invented visual cases here.

## Reproduction and fingerprints

Use Node24, `CI=true`, port5197 and the exact local schema URL as
`E2E_DATABASE_URL`. Disable default seed/build with `E2E_SEED_COMMAND=true` and
`E2E_WEB_COMMAND='NODE_ENV=production PORT=5197 HOST=127.0.0.1 SESSION_COOKIE_SECURE=false REGISTRATION_ENABLED=false VAPID_PUBLIC_KEY= VAPID_PRIVATE_KEY= VAPID_SUBJECT= node dist/server.mjs'`.
The fixture artifact is `tmp/courtyard-art-48-fixture-20260907.json`.
For art use `E2E_COURTYARD_ART_FIXTURE=true`, `COURTYARD_ART_FIXTURE_JSON` pointing
to that artifact and `COURTYARD_ART_SCREENSHOT_DIR` pointing to a new directory;
invoke `node --import tsx node_modules/@playwright/test/cli.js test tests/e2e/courtyard-art.spec.ts --project=chromium --workers=1`.

Observed runtime source SHA256:

- WorldCanvas: `49ea1c9a3bdbbbe660f0055a50816b1e28bdad814ff219c6c873fe3420807e3a`
- Pointer gestures: `98fd69cb11c48f30132f89d7ce52c498147f1792a74af905d2e9fab99e6c7fd2`
- Nearest atlas frames: `4d1b67cdff220b8dcbfe62578decafb1e5270cb788e545ace48c2fe056aa6539`
- Built server: `bbf000192cb556306bd9cf270fa5ed0292802f19ceff4ecb56f4128fc19243b7`

Final logs: `tmp/courtyard-art-48-browser-r4-20260907.log`,
`tmp/courtyard-art-48-overviews-r4-20260907.log`, and
`tmp/courtyard-art-48-mobile-deeplink-r4-20260907.log`.
The separate300-second traffic gate predates the final CSS-discovery build;
see `QA-TRAFFIC-FINAL35-2026-09-07.md` for its exact scope and environment.
