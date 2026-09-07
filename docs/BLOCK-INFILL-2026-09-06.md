# Directional blocks and residual public spaces

Local development on `codex/task-14-block-runtime-integration`, base HEAD
`b42fe5946350897dbb9b3bb904b0262dd591783d`. The user explicitly requested continuing
local implementation without a tracker binding. No provider task, commit, push,
deployment or production regeneration was performed. This extends, but does not
complete every item in [the accepted plan](art/RECTANGULAR-PUBLIC-SPACE-DRAFT.md).

## Implemented behavior

- New residential blocks cycle through seven dimensions:32×32,32×24,24×32,
  24×24,24×16,16×24,16×16 cells, with terrain-aware template fallback. A persisted
  `packingCorner` selects NW/NE/SW/SE from the country seed and block/sprint order.
  This reflects parcel positions only; sprites and south entrances never rotate.
- The explicit `parameters.infill=true` policy protects complete reserved site
  envelopes (including unassigned houses/services/history) and entrance routes,
  then appends rectangular PARK reservations. It does not replace future houses
  with parks or create business tasks automatically. Ground-only parcels can be
  one cell wide/high and have zero external construction clearance. A fragment
  with no reachable gate remains ground/access land rather than an invalid task.
  This is a greedy partition, not a claim of mathematically optimal packing.
- New tasks use eligible reservations before expansion; no old address moves
  when tasks progress or are added. A park variant is selected once and retained.
  Tiny lots use `urban-park`, not a fountain whose minimum footprint cannot fit.
- Task-owned public spaces have three visual phases: workflow1–2 preparation,
  3–4 planting/construction,5 completed. Task statuses and ordinary houses retain
  their existing five stages. Stage0 is still an unassigned marked reservation.
  A one/two-cell planting strip is tiled earth → partial meadow → meadow, with
  one gate where possible. It carries no oversized prop or overflowing badge;
  hover/click still resolve the real task. Public-space work bounds stay inside
  the parcel in both rendering and pedestrian navigation.
- Block plaques show actual sorted task-number membership. Consecutive numbers
  become a range; gaps become separate ranges. Long labels show the first range
  plus task count. No number is reassigned after moves/deletions. Plaques are
  non-interactive, do not capture building clicks and add no individual fetch.
  `summary.taskNumbers` is written by compilation; `blockPlaques` is carried by
  district/chunk DTOs. Published chunks missing that array are rebuilt, not reused.
- Historical first pass (superseded by `WORLD-FINISHING-2026-09-06.md`): dense forest cores used a globally phased two-cell candidate grid, with seeded
  density falloff/clearings and crown collision rejection. Grass/coastal species
  retain their sparse policy; adjacent chunks still agree. Existing tree art and
  house art are unchanged by this slice.
- The existing true-territory district outlines were checked enabled/disabled
  in the browser; park clicks work with boundaries enabled. No new district
  corridor geometry was added.

## Explicit remaining scope

Attached rows/shared construction envelopes, long vertical or whole-block house
families and additional district separation corridors are not implemented here.
Current houses still occupy6×3,6×4 or6×6 cells. No stretched image is presented as
a new house. Exact expanded plaque membership on selection and forced globally
consecutive membership after explicit size/service choices also remain outside
this slice; plaques report the truth, including gaps.

## Storage and rollout boundary

No new table, migration or per-cell records. Version2 block parameters are durable
geometry, not a renderer fallback: records without the new policy keep their
original layout. Existing blocks are never silently reinterpreted. A separately
authorized regeneration is needed to apply the policy to an existing city and
populate its old block summaries. Permanent MOVE/RUIN ownership must survive;
historical blocks can remain in their old geometric policy when preservation
requires it. Do not run an older compiler against blocks with the new parameters.

The previous compact RC fingerprints and performance screenshots are historical
baseline, not approval of this changed source. Follow
[the production runbook](COMPACT-PRODUCTION-RUNBOOK.md): freeze an exact reviewed
revision, backup/restore rehearsal, matching client/server/static deployment,
regeneration and invariant audit before opening traffic. This slice does not
authorize those operations.

## Reproduction and evidence

- `tests/block-infill.test.ts`: all7house templates ×4corners ×8seeds, site
  exclusion/entrance access, persisted policy and deterministic replay.
- Regression coverage: strip stages, crown clearance/chunk edges, task allocation,
  spatial negative coordinates, old payload rejection, park neighbour walkways.
- Isolated PostgreSQL schema `block_infill_20260906` at loopback5432:
  `tests/fixtures/seed-block-infill.ts` creates96tasks in3sprints through real
  commands and deliberately refuses to recreate an existing schema.
- `tests/e2e/block-infill.spec.ts`: actual production build in local Chromium;
 96task scene, public-space stages1/3/5 and narrow lot selection with boundaries
  enabled, CITY→COUNTRY→PLANET→CITY,390px layout, console/network assertions.
  Screenshots: `screenshots/block-infill/`. One read per scene/overview/atlas,
  no viewport/chunk calls on the round trip. Not a touch/Safari/PWA test.
- `scripts/benchmark-block-infill.ts`: Node24 pure CPU, no network/database.
  Warmed40block samples,5compiles of1000tasks/20sprints,30forest64×64 samples.
  p95: old packing0.161ms, infill0.423ms,1000task compile80.19ms, forest3.263ms.
  Declared ceilings10/1500/50ms passed. New packing is slower than the old
  single pass, but remains below1ms here; this does not measure browser FPS.
- Final command logs under `tmp/block-infill-*`; completion counts must be read
  from the latest run after all relevant edits, not the earlier RED diagnostics.

Final local gate2026-09-06: `npm test -- --reporter=dot` passed155files/777tests
(167.39s); `npm run build` (including typecheck), `npm run lint` and
`git diff --check` passed. Final scoped Chromium journey passed1/1(19.0s), with
zero asserted console/network errors; CITY, boundary, park, country, planet and
390px screenshots were visually inspected. The main-agent review found and
fixed stale published plaque payloads and the obsolete external park-worksite
walking exclusion, each with a failing-then-passing regression. RepoWise doctor
passed; its installed CLI reports only an optional update warning.

Full release reacceptance (480task visual tour,1000task DB/browser scale, traffic
duration, real PWA upgrade/push and production restore) is not claimed for this
incremental slice. Earlier evidence is linked in the historical compact RC.
