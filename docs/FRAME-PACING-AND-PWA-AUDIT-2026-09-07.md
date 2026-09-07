# CITY frame-pacing diagnosis and PWA release boundary

Local investigation of the remaining frame-stall observation in
[WORLD-FINISHING-2026-09-06.md](WORLD-FINISHING-2026-09-06.md). No deployment,
provider delivery, production mutation, or speculative renderer change.

## Declared workload and evidence boundary

- Existing isolated PostgreSQL schema `compact_delivery_20260905_a`, Riverside:
  40 task buildings, three districts, 14 cars and 25 walkers. No reseeding or task
  mutation; login creates only the local browser session.
- Production bundle served at local port5197. Chromium151, 1440×1000, DPR1,
  ordinary wheel/pan to scale1.05, complete resident city; NIGHT lighting.
- Main renderer source SHA256:
  `88972e27ed017dc9dbd93305f458a008718bb097922eb909ae2ecf56de287ab4`.
  The profile metadata records the actual loaded content-addressed bundles.
- Initial diagnostic40s, then300s with CDP timeline, CPU samples, GPU and
  scheduler categories. Profiling adds overhead; these are attribution runs,
  not a clean hardware60fps acceptance benchmark.
- Budgets: unchanged zero safety violations, movement in each ten-second
  window, simulation step p95<5ms; provisional frame p95<25ms and no recurrent
  application-attributed tasks>50ms. A timing miss is reported, not hidden by
  lowering population, pausing agents or changing geography.

The preceding300s result had RAF p95=26.8ms/max150.7ms and33 long tasks up to
155ms. It retained only durations, not timestamps/stacks. Therefore those old
33 pauses cannot retroactively be assigned to a particular application call.

## Diagnostic harness

`tests/e2e/city-mobility.spec.ts` retains the existing movement and safety gates.
`MOBILITY_PROFILE_DIR` enables a diagnostic-only CDP capture; absence of this
variable leaves profiling disabled. The harness records timestamped long tasks,
CPU profile, timeline, actual graphics backend, browser/OS/CPU, camera, actor
counts, lighting, bundles and renderer source hash. Explicit screenshots occur
after the sampled period; Playwright trace thumbnails remain disabled.

Initial40s diagnostic passed: RAF p50=17.1ms/p95=25.8ms/max40.8ms, zero long
tasks. Across6219 animation callbacks, the largest was4.753ms; observed major GC
max2.261ms. This does not reproduce the old150ms symptom and does not establish
that sorting, lighting or the mobility engine caused it.

The300s environment exposes **SwiftShader software rendering**, not the Apple
GPU: `ANGLE_SWIFTSHADER`, `gpu_compositing=disabled_software`,
`rasterization=disabled_software`, with headless-shell command line
`--use-angle=swiftshader-webgl`. Browser/backend pacing must be distinguished
from JavaScript work.

## Final300s result and attribution

The repeated300s browser journey passed in6.3minutes, including sampling,
district focus, task identity and the CITY→COUNTRY→PLANET→CITY return. Population
stayed at14 cars/25 walkers; both kinds moved in all30 ten-second windows. All unsafe,
wrong-way, off-path and signal-post conflict counters remained zero. Peak waits
were6.2s for cars and11.0s for walkers; simulation p95 never exceeded1.4ms and
its observed maximum was2.8ms.

RAF intervals were p50=16.7ms, p95=25.1ms, max42.5ms, with **zero long tasks**.
The provisional25ms p95 target is narrowly missed; this is not a60fps claim.
No renderer code was changed between the diagnostics, so the lower maximum
relative to the preceding report is not presented as a code optimization.

The full sampled timeline contains1,651,859 events and identifies the slowest
main-renderer native tasks as Chromium
`cc/trees/proxy_impl.cc::ScheduledActionSendBeginMainFrame`. The largest was
38.350ms wall time but only1.132ms thread CPU; its Pixi `_tick` callback took
0.228ms. Across the sample, the longest application animation callback was
6.800ms. Recorded `FunctionCall` slices used6.76s thread CPU in300s, while the
software `VizCompositorThread` task slices used108.23s. These are separate
observed categories, not additive inclusive CPU totals.

This supports a **browser/software-compositor pacing** diagnosis for the
remaining roughly25ms frame tail in this environment, rather than a measured
long-running application ticker. It does not identify the source of the older
155ms pauses: they did not recur in the final captured sample and had no original
stacks. No speculative production change was made to hide that uncertainty.
Hardware-accelerated target-browser/device performance remains a separate gate.

Compact evidence lives in [frame-pacing-20260907](evidence/frame-pacing-20260907/):
`metrics.json`, `trace-summary.json`, `environment.json`, `browser.log` and
`stream-tests.json`. The387MiB raw trace is deliberately **outside the repo** at
`/tmp/task14-frame-profile-archive/main-thread-trace-final.json`, SHA256
`875551bf40ff6f25edac7e931868cd1c25386c4d7ec6abd3cf0638e8ffb43fd0`.
Original CPU profiles and full actor samples remain ignored local diagnostics,
not deployment assets. Do not substitute this dirty-source observation for an
exact committed release-candidate benchmark.

### Corrected diagnostic failure and bounds

The first expanded300s diagnostic finished sampling, but **failed overall**
while exporting an oversized CDP JSON string (`RangeError: Invalid string
length`). Its recovered samples had three53–60ms long tasks; they are not called
a passing E2E result. This was a defect in the diagnostic export, not evidence
of a failed application safety invariant.

The successful repeated300s run used bounded1MiB protocol reads and sequential
file writes, preserving samples before profiler teardown. A later hardening
adds a128MiB total output budget,64MiB browser recording buffer, early stop at85%
buffer usage, and explicit `profile-status.json` failure for truncated/lost
events. The default capture omits high-volume native/per-draw categories; the
one-off full native trace above is retained only externally. Byte-budget behavior
was red before the guard and passes the three focused helper tests afterwards.
Scoped ESLint and typecheck passed before the final cap addition; the parent
candidate build covers the resulting type surface. The cap's browser buffer
event path was not separately exercised in another long run, because the serial
browser slot was handed to the remaining overview/fixture checks. An incomplete
diagnostic now fails explicitly without losing its independently saved samples.

PWA/API/DB/runtime contracts and renderer assets were unchanged by the diagnosis
slice above; no deployment command was needed.

### Later padding implementation checkpoint

The subsequently authorized padding work did make a measured renderer change:
exact native material/tree continuation and a bounded first-visible layer. Its
repeat-memory gate also found renderer-owned batchers surviving disposable bake
roots. A single public-API offscreen root now bounds that cache; three identical
restore cycles plateau within0.24MB instead of growing about17MB each. Full
causal memory evidence is in
[INTERCITY-ROAD-PADDING-QA-2026-09-07.md](INTERCITY-ROAD-PADDING-QA-2026-09-07.md).

The final quiet300.008s run on the same stored Riverside city, same1.05 camera
scale/NIGHT/software backend and14 cars/25 walkers passed: RAF p95=18.0ms,
max33.3ms, zero long tasks; simulation p95/max=1.3/2.1ms. All30 movement windows
and cumulative safety gates passed. This was unprofiled and used a different
current ambient session seed, so it is not a bit-identical trajectory replay or
a controlled percentage-speedup attribution. It meets the provisional25ms
headless budget while leaving hardware/mobile performance separate. An absent
derived single-city road snapshot was initialized through the existing service
seam; all37 other table hashes and the layout hash were unchanged. Exact source,
environment and results are in `screenshots/native-padding-traffic-final/`.

## PWA / Web Push read-only audit

The inspected implementation has revisioned public-shell caches, no API/MCP/
Socket.IO cache, secure-context registration, same-origin notification clicks,
explicit permission UI, owned subscriptions and durable event delivery. The
worker rechecks country membership before sending, limits retries to three,
enforces an absolute five-second provider deadline and does not block task
mutation on network delivery. Provider endpoints are allow-listed; redirects
and secret-bearing provider error strings are not retained.

Relevant current regression sources are `tests/pwa-contract.test.ts`,
`tests/push-{subscriptions,ownership,routes,payload,delivery,gateway,worker}.test.ts`
and `tests/e2e/mobile-pwa.spec.ts`. Existing dated evidence
`docs/evidence/compact-rc/pwa-wheel-final-browser.json` reports six passing
journeys and two explicit WebKit skips. It is historical evidence, not a fresh
run of this dirty candidate. In particular:

- Chromium checks worker registration, control and offline shell navigation.
- Mobile touch-map behavior was checked in Chromium and Playwright WebKit.
- The push opt-in journey uses fake `Notification` and `PushManager` objects.
  It checks the application flow, not OS permission behavior or delivery.
- Playwright WebKit skips service-worker lifecycle and push-subscription tests;
  it is not installed iOS Safari/Home Screen acceptance.

Required external/device acceptance remains explicit: installed iOS/iPadOS and
Android permission/denial recovery, background/closed-app delivery, notification
click to the authorized current task, real worker revision upgrade, target HTTPS
and VAPID readiness, and one controlled provider delivery with redacted logs.
No permission prompt or notification was sent by this audit. The local profiling
server explicitly disables VAPID, so its startup cannot drain saved push work.
Offline mode promises the shell, not cached private tasks or offline writes.

No confirmed new PWA/push production defect was established by this bounded
source review. Device/provider items remain unverified; they must not be called
complete based on emulation or transport mocks.

### Final35-family / pointer-fix browser checkpoint

Four focused journeys were rerun after the final pointer fixes: a deep-linked
task opens while terrain is still pending; mobile controls and touch zoom pass
in Chromium and WebKit; and Chromium passes the actual revisioned service-worker
registration/control/offline-shell check. See
[the48-case browser report](QA-COURTYARD-ART-48-2026-09-07.md) for the integrated
build and retained evidence. This run did not contact a push provider. The
physical-device and WebKit worker-lifecycle limitations above remain unchanged.
