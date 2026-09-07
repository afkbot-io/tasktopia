# Compact world continuation — local verification, 2026-09-05

Worktree: `codex/task-14-block-runtime-integration`, base HEAD
`b42fe5946350897dbb9b3bb904b0262dd591783d`. This is a dirty local candidate, not
a committed/reviewed release revision. No deployment, production database reset,
or external task-provider mutation was performed.

## Implemented in this continuation

- Country-owned permanent MOVE/RUIN history, atomic same-city sprint transfer,
  immutable occupied sites, limited historical DTO and canonical current-task
  navigation. REST and explicit-country MCP enforce role, scope and idempotency.
  See [PERMANENT-TASK-SITES](PERMANENT-TASK-SITES.md).
- A lazy transfer panel requests the sprint list only when expanded. Ruin
  details need no new request; MOVE uses the existing authorized task resolver.
  An open task clears old details/actions after definitive 403/404, but retains
  loaded details through temporary 5xx errors.
- Compact native incident pixels distinguish BUG/HOTFIX report, repair,
  verification and active emergency. Empty lots/parks never get a finished-roof
  fire. Effects, responder count and water length are bounded; update signature
  includes work item type. Verification does not burn. The micro responder is
  an on-site overlay, **not simulated dispatch through traffic**.
- Four-connected physical continent groups, shared geographic projection and
  COUNTRY schema 6. A shared wheel-burst guard crosses only one level per burst;
  real cursor hit testing prevents entering a nearest country across ocean.
- Two independently AI-authored service families: fire station and clinic,
  each 48×32 on a 6×4 parcel with separate reverse-derived stages 5→4→3.
  The ordered template-v2 shape pool remains immutable. Saved art aliases must
  match the existing slot footprint/anchor/entrance; adding catalog entries
  cannot repack old blocks. Newly consumed compatible MEDICAL/FIRE reservations
  select their service art; lack of fitting art never postpones the task role.

## Fresh checks

Node 24, local PostgreSQL 16 on loopback5432. Unit tests use isolated schemas;
the browser fixtures `compact_delivery_20260905_a` and `_b` were created empty.
Permanent history is intentionally retained; these fixtures must not be treated
as reusable destructive reseeds.

| Gate | Evidence |
|---|---|
| Whole unit/integration suite | 693/693, 136 files, 108.99s; `/tmp/compact-next-unit-full.log` |
| TypeScript and production build | Exit0; `/tmp/compact-next-build-final.log` |
| ESLint and diff whitespace | Exit0; `/tmp/compact-next-lint-final.log` |
| Five-family geometry/alpha/review gate + publisher | Exit0; `/tmp/compact-next-art-verify.json`, `/tmp/compact-next-art-build.log` |
| Full asset audits | Exit0; `/tmp/compact-next-assets-full.log` |
| Real CITY/COUNTRY/PLANET wheel and city/deep-link journeys | 4/4 Chromium, 17.5s |
| Actual UI transfer → MOVE → canonical task → authenticated deletion → ruins → reload | Pass; paired compact incident scenario 2/2, 16.4s |
| New login reopens both retained historical sites | 1/1, 6.2s |
| Task-modal unavailable/recovery cases | 3/3, 10.1s; actual deletion404, injected403 and503/recovery |
| Mobile/PWA on fixture `_a` | 4 passed / 2 skipped,16.6s; Chromium+WebKit navigation, Chromium offline shell and permission opt-in; WebKit PWA lifecycle cases explicitly skipped |
| Actual auto-assigned service art | 1/1,26.2s; fresh local16-task fixture assigns MEDICAL#12 and FIRE#16, loads their real stage5 PNGs and opens each task by a physical roof click |

The whole-unit run preceded only the final RUIN baseline correction and browser
test refinements; the following build/typecheck and real MOVE click/relogin
checks cover those renderer changes. Do not call all browser cases one single
suite execution: they were independent bounded runs with declared fixture state.

Source/runtime art identity is recorded per family in `geometry.json`,
`report.json`, `structure-report.json` and `visual-review.json`. The clinic's
1px envelope inset/0.5px centre drift and measured 1–2px pane widths are explicit
family-specific accepted measurements, not perfect pixel identity or a globally
relaxed contract. Roof coverage/room semantics are manually reviewed; numeric
checks alone do not prove camera angle or visual quality.

Published asset revision: `701a38e80c7448c6`; five families, 25 stage images,
97 props, 351 PNGs across `public/game-assets/v5`. Eight retired smoke/fire PNG
names were removed from each runtime/public copy (16 files) into recoverable
archive `/var/folders/hq/150r_qxx3bn4mw1lbwv8jz8m0000gn/T/tasktopia-retired-building-art-_xzr0tif`.
The shared original incident/boat sheet is retained because boats still use it.

`tests/fixtures/seed-compact-service-art.ts` refuses populated or non-local
schemas and has an explicit opt-in. Its sole fixture is
`compact_service_art_20260905`: one city, one ACTIVE sprint,16 tasks, no explicit
family hints. Ordinary neighbours use stages3/4/5; service tasks12/16 are both
finished. `screenshots/compact-service-art` contains the real city and close-ups,
with `evidence.json` recording canonical tasks, asset requests and camera state.
The browser reported no page errors, failed requests or unexpected writes after
login. Root visually checked both close-ups against terrain, roads and trees.
This does not claim that service stages3/4 were separately exercised in-browser;
their native/sequence/mask checks are the asset evidence above.

After the large source changes RepoWise was forced into fresh no-seed fast
structural indexing:516 files/1,804 symbols, baseHEAD unchanged, doctor `ok:true`.
Twenty unreachable-file and26 unused-export heuristics were not used as proof
for bulk deletion. Final whole TypeScript, ESLint and diff checks passed after
the additional browser fixture files were authored.

## Browser findings and review

- The first permanent-site test used the wrong URL shape, then clicked180ms
  after a drag while production deliberately suppresses selection for500ms.
  It now uses the canonical `/task/<number>?countryId=…&taskId=…` helper and
  waits520ms for gesture suppression, never a longer data-readiness sleep.
- The RUIN root previously sorted at its northern origin. It now sorts at the
  southern ground baseline with negative local content/hit-area offsets,
  preserving exact world pixels. Independent review checked the transform.
- Independent server review found no confirmed authority/atomicity/history
  blocker. It found the stale open task404 case; a real-browser RED reproduced
  it before the fix, followed by the three GREEN cases above.
- The initial mobile run used fixture `_b` after deleting task#1, violating
  that existing test's numeric-search prerequisite; it was not accepted as a
  mobile product failure or a pass. The repeat used `_a`, where task#1 still
  exists:4 passed and2 WebKit lifecycle cases skipped. Push permission/service
  browser plumbing is tested, not delivery from an external push provider.

Actual screenshots are in `screenshots/compact-next-20260905`: city, blocks,
country, planet, MOVE/ruin sites and history dialogs, active/verification
incident states. These are application renders, not AI city mockups. The map
overview screenshot fixture contains one country and three sprint districts;
it does not demonstrate twenty-district capacity or many connected continents.
The earlier map run measured a warm retained CITY return of305ms, one scene
request and no sampled missing ground; this is one local sample, not a latency
guarantee or a new large-city performance claim.

## Still not a complete release

- The requested ten new homes, remaining police/transport/service art and
  distinct AI-authored ruined buildings remain unfinished. Current rubble has
  three arrangements of existing construction props, not three new AI buildings.
- Twenty-sprint fixture growth is blocked by the existing surrounding-district
  frontier. Whether a sprint may continue in detached road-connected blocks
  still requires the user's product choice; no new sprint is fabricated.
- Real intercity road integration is not wired. Logical airport connections
  must not be shown as proof of ground roads or full airport/rail gameplay.
- The migration26 populated-upgrade/ownership tests are fresh; the prior
  pre23→25 whole-backup/restore rehearsal is not proof for this revision.
- Full dense-world performance and long traffic/flight sampling were not rerun
  for this continuation. Prior timings remain explicitly separate baseline
  evidence. Real push-provider delivery, device PWA installation and production
  rollout still require their own authorized target-environment gates.
