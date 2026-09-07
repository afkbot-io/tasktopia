# Moscow lighting and building expansion

Local continuation, no production deployment. Preserve tasks, placements and
the existing dirty integration worktree.

The subsequent parcel-planning slice is recorded in
[RECTANGULAR-BLOCK-PLANS.md](RECTANGULAR-BLOCK-PLANS.md): stored template-v3
plans, wide/tall packing tests, v2 preservation and a fail-closed rollback
capability check. Its newer evidence does not approve the outstanding artwork.

1. Replace session time/selector with real Europe/Moscow time: dawn06–10,
   day10–16, dusk16–18, night18–06. Smooth light, timezone-independent tests,
   correction after tab resume, no map remount or network requests. Browser
   verification controls the browser clock, not a hidden production selector.
2. Replace random1% grass-adjacent lamps with deterministic street/frontage
   spacing. Protect crossings, entrances, construction sites and circulation;
   test chunk ordering and verify the actual day/night city and park stages.
3. Extend geometry for genuinely long and courtyard buildings, not stretched
   square images. Author high45-degree sources in reverse5→4→3, validate floor
   space, entrance/anchor registration, packing and reserved courtyards.
4. Recheck remaining exits, overview scale, frame stalls and release gates from
   WORLD-FINISHING-2026-09-06. No release-ready claim for unapproved art.

Lighting requires no database migration. New physical families must preserve
existing slots; decide layout version/migration before changing durable geometry.
Release/rollback follows the existing runbook and an exact reviewed revision.

## Implemented and verified locally

- Absolute MSK clock, cached once per second; no per-object timer or network
  request. Dawn/dusk use smooth interpolation; reduced-motion does not invent
  a different time of day. Tab visibility resynchronizes ambient CSS immediately.
- Street/courtyard verge placement every8cells, opposite sides staggered4.
  No random1% roll. Crossings clear within2cells, construction/entrances remain
  blocked, concave paving corners rejected. Lamps never occupy walking tiles.
- Park fixtures reserve perimeter positions before trees, target2/4/8byarea,
  minimum Manhattan separation3; paths and existing furniture take precedence.
  Park tree candidates cover every integer anchor so narrow formal garden beds
  do not become empty after reserving lights. Final layout stays stage-stable.
- DETAIL chunks carry lightingVersion1 and compact surfaceHaloRuns, with4-cell
  terrain/surface/obstacle context. Single and batch readers reject old cached
  contexts without changing worldVersion, tasks or persistent placements.
- Long/tall art-verifier previews derive dimensions from the contract. Previous
  fixed64px grid and160px stage strip clipped large sprites; tests cover96×48
  and48×96. Synthetic test masks are never production art.

Evidence (Node24, local PostgreSQL, dirty branch based on
`b42fe5946350897dbb9b3bb904b0262dd591783d`):

- Clock/street/park/payload/AppService:52tests passed,
  `tmp/moscow-final-tests.log`, including single and batched pre-lighting cache
  recovery. Later narrow-bed regression:14tests passed,
  `tmp/park-light-regression.log`.
- Verifier CLI:12tests passed, `tmp/long-preview-green.log`; red test first
  demonstrated clipped widths64/160instead of112/304.
- Browser fixture96tasks/3districts: passed, `tmp/moscow-browser-final.log`.
  Browser-controlled fixed Date exercises dawn/day/dusk/night without freezing
  RAF. Same city canvas retained; task dialogs and mobile return work; exactly
  one scene/overview/planet request each, no viewport/chunk reads or console/API
  errors. Screenshots in `screenshots/moscow-lighting-final/`.
- Initial full suite:790passed/1failed. The failure exposed underplanting of a
20×10formal garden after adding lamps; every-integer-anchor fix above resolves
  that regression. This initial run is not a passing full-suite claim.
- Final full regression after the fix: **791tests /159files passed**, exit0,
  `tmp/moscow-all-tests-final.log`. Production build/typecheck, lint and
  `assets:compact:verify`/`assets:verify` passed; logs are
  `tmp/moscow-{build-final,lint-final,assets-compact,assets-audit}.log`.
  Final browser rerun after the planting fix passed in15.3s, same screenshot
  directory. These elapsed values are test duration, not application latency.
- Forced no-seed structural RepoWise refresh completed; doctor returned
  `ok:true`, `tmp/moscow-repowise-doctor.json`. No generated editor policy or
  tracked index was added. `git diff --check` passed.
- Additional real-browser public-space fixture30tasks/15parkvariants passed
  in32.2s: `tmp/moscow-parks-browser.log`, `screenshots/moscow-parks/`. Checks
  cover fountain/monument3–5, large park, canonical task clicks, all map levels
  and mobile. Screens captured real current MSK night; no production selector.

Local review covered the changed clock, placement, cache identity, client
materialization, park progression and verifier preview seams. Findings fixed:
viewport snapshots needed the same4-cell halo as individual reads; cached
pre-lighting contracts needed explicit rejection; dense lamps exposed the old
two-cell park planting stride; fixed-size art previews clipped future families.
No tracker/MR review or release acceptance is implied. The existing unrelated
dirty integration diff was preserved, not presented as newly reviewed code.

## Remaining release gates

The wide gallery AI candidate is NOT approved: actual90×48occupied pixels and
about17px facade violate the96×48/10px contract. Sources, exact retained prompt
and failed report are in `tmp/long-building-art/`; see
`art/LONG-BUILDING-AUTHORING.md`. No new runtime family or fabricated review was
added. Long/vertical/L/Upacking, reserved courtyards, all reverse-stage sources,
eight of the previous ten draft families, road exits and frame-stall work remain
open. Blue-bay and copper-court are now published with all stages; see
[the diversity pass](BUILDING-DIVERSITY-PASS.md). Rectangle-plan/template-fit
support has landed separately, but large authored silhouettes are not approved.

## Release preparation, not deployment authorization

1. Finish the remaining art/packing and performance gates, then freeze an exact
   committed revision and review its scoped diff. Current dirty checkout is not
   a releasable artifact.
2. Run full tests, lint/typecheck/build, complete reviewed asset gates, browser
   journeys and isolated1/5minute traffic/load runs. Verify all five construction
   appearances, permanent MOVE/DELETED lots and service allocation.
3. Rehearse the existing `DEPLOYMENT.md` compact-cutover procedure on a restored
   database with an identified backup. Lighting itself requires no business-data
   regeneration or SQL migration; do not wipe towns merely to change lamps.
4. Deploy matching server/client artifacts together. New clients require
   lightingVersion1/surfaceHaloRuns; the server invalidates derived stale chunks.
   Avoid mixed old-server/new-client replicas and refresh controlled PWA shells.
5. Perform target-environment smoke/observation only after release approval.
   For this lighting-only change rollback matching artifacts; the broader
   compact database cutover requires the backup/restore rollback in the runbook,
   not running incompatible old code against the new schema.

No production deployment, DB reset, tracker status or release approval occurred.
