# Production-CDN release correction

Status: verified locally, **not deployed**. The requesting user's approval of
the previous candidate remains recorded, but does not approve this new six-file
diff. No runtime/deployment policy, credentials, database schema or art changed.

## Reproduced failures

The original AMD64/CDN image
`sha256:f75dc0ab58ff28f8c06c6cf68d6be03c2fb7d360e871d888b2fffffa70cadc82`
uses `STATIC_ORIGIN=https://store.tasktopia.online` (the actual production value).
An isolated Chromium151 probe reproduced four cross-origin Worker
`SecurityError`s and a blank offline React root despite a cached HTML200.
The former same-origin-only PWA assertions did not detect that blank shell.

## Exact correction

- `chunk-materializer.ts`: bundle the worker using Vite's supported
  [`?worker&url` import](https://vite.dev/guide/features#web-workers), then load
  its identical hashed file from the app origin. Existing `worker-src self`
  remains intact; no blob bootstrap, CSP weakening or new dependency.
- `pwa-service-worker-source.ts`: precache and serve only exact emitted public
  CDN build assets. No authenticated request, private API path, foreign origin,
  arbitrary CDN file, source map or credentialed CDN request is admitted.
  Cross-origin installation/refill uses CORS and omitted credentials.
- `vite.config.ts`: bind the configured CDN origin into the shell revision and
  generated worker. Empty/same-origin configurations still work.
- Unit regressions cover Worker origin, CDN offline fetch and adversarial cache
  inputs. The mobile PWA regression clears browser HTTP cache (not CacheStorage)
  and requires visible React controls, not merely a successful HTML response.

## Verification

| Check | Result |
|---|---|
| Worker regression | RED witnessed; GREEN10/10 |
| PWA generated-worker regression | RED witnessed; GREEN21/21 |
| Worker/PWA/deployment/push regression set |5files/63tests PASS |
| Independent read-only code/security review |No confirmed actionable finding |
| Clean curated checkout lint and TypeScript |PASS, no lint exclusions added |
| Clean curated same-origin build |PASS;601files, all5CLI bundles |
| Corrected linux/amd64 CDN Docker build |PASS |
| Exact-image CDN browser acceptance |PASS, exit0 |

Corrected image:
`sha256:6ab064c3ccbed67da72f7c25e6060b96c1487cc9ee6bc6b7df2142317510a968`
(`tasktopia:compact-cdn-fix-20260907`). Docker build log is local
`tmp/release-amd64-cdn-fix-20260907-build.log`.

The clean candidate's509 source files have SHA256
`cb9d8f77b4a705a92e09a4a9febeb935af3596da48d4ebe18afd6b0f0feb2486`.
The previous519-file passport mistakenly counted ten ignored Python bytecode
cache files; the original clean509-file source digest was
`546c4dc611bb9002a12b5b5e2ec6193f5007a5cd3b5a9ba89d9946a83ecff91c`.
Do not publish those caches to reproduce the old digest. The original clean
candidate build exactly matched all601 R4 artifacts before this correction.

New same-origin601-artifact digest:
`69a81c870ec224c003ef3e6131a17e85d774fb2730e407006d5a069e61165b60`.
It is not the CDN artifact digest; different build origins intentionally change
client and worker references.

Full-worktree `npm run lint` sees local ignored `tmp/*.mjs` probe scripts and
reports53 errors there. It is **not** recorded as passing. The clean curated
candidate passed the unchanged full lint command; no production/test source
was excluded to obtain that result.

## Actual browser evidence and limits

Run:2026-09-07T07:33:50Z–07:33:57Z, Chromium151, preserved66-task local fixture.
Four app-origin materializer workers produced nine replies, zero errors.
The service worker fetched38 CDN entries; the cache held43 app-origin and38
exact CDN files, with zero private or other-origin entries. After clearing only
HTTP cache and going offline, the HTML and React/auth controls rendered with
zero failed JavaScript/CSS requests. Online recovery passed.

CDN requests (including service-worker-owned fetches) were fulfilled from the
exact local image. Chromium DNS fallback for the real CDN was blocked. No
production/domain writes occurred in this browser test. The browser and local
container were removed afterward.

Private API calls and seven decorative game images remain unavailable offline;
this is an application-shell guarantee, **not an offline-world guarantee**.
Actual production CDN availability, physical-device push and an existing
installed PWA upgrade lifecycle are not claimed by this probe.

Local evidence:

- `tmp/final35-cdn-browser-20260907/`: preserved original RED report/screens.
- `tmp/cdn-fix-browser-20260907/`: new GREEN report/screens and harness hash.
- GREEN report SHA256:
  `86e57de5905d4ee9fdae29347a668be65c6cc2bf4fb21b46691b8dec3c861a41`.
- Executed GREEN harness SHA256:
  `eff402b6335a7d5fe348d95e9bcd9463961b975c95a4d25a81d1255c9389e487`.

Production merge/cutover remains governed by
[the preflight](RELEASE-PREFLIGHT-2026-09-07.md) and
[the paired-restore runbook](COMPACT-PRODUCTION-RUNBOOK.md).
