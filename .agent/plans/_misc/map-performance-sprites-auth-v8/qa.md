# QA plan

## Preconditions

- Seeded 350-task demo country and empty newly registered country.
- Desktop 1440×900 plus mobile 390×844.
- Development renderer counters enabled.
- Cold-cache and warm-cache profiles are recorded separately.

## Performance scenarios

1. Open Riverside at detail zoom; idle 10 seconds.
2. Drag 30 bounded steps without crossing a chunk boundary, then across one boundary.
3. Apply eight wheel inputs to country overview and return to detail.
4. Focus four cities from the plan drawer.
5. Open/close task, plan, account, and country dialogs.
6. Apply 20 bounded overview/detail cycles.
7. Hide/show the tab and verify simulation pause/resume.
8. Trigger a task progress socket event and count renderer/chunk changes.
9. Record stable agent ids/routes/progress, pan/zoom through all four LODs, and verify the same records continue.

Expected: budgets from `overview.md`, no black edge, no input freeze, no duplicated canvas, no accumulating agents/chunk textures.

## Sprite scenarios

- Contact sheet at native 1× and nearest 4× for every five-stage set.
- One NEW_BUILD district with 3-, 4-, and 5-building rows.
- One PRIVATE district with one-sided and two-sided streets.
- Mixed construction stages in each row.
- Adjacent canonical high-rise and every replacement house to expose scale/camera drift.
- Night/dark UI background is not used to hide alpha halos.

Expected: one camera/light/palette; no roof perspective jump; correct y-order; no footprint/anchor drift; platforms join cleanly.

## Placement invariants

- No overlapping task footprints, roads, surfaces, or protected features.
- Every entrance has a path/driveway to the public network.
- Dense-row baselines align; private spacing stays in configured range.
- Support buildings never exceed per-city/per-district rules.
- Completed districts do not move or expand.
- Same seed and task sequence produce the same block groups.
- PRIVATE has zero dense-residential tasks; NEW_BUILD has zero private-residential tasks.
- Mews have edge service access; long cul-de-sacs have a turn head.
- Metrics for isolated buildings, frontage length, singleton groups, support ratio, and access distances remain inside configured limits.

## Authentication matrix

| Scenario | Expected |
| --- | --- |
| Unique email registration | 200, session cookie, empty country, authenticated map |
| Existing email registration | 409, clear Russian message, form remains usable |
| Malformed email/name/password | 400, field-level/general message, no user created |
| Valid login | 200 then bootstrap 200 |
| Invalid login | 401, no session created |
| Stale/unknown cookie | bootstrap 401, auth form shown |
| Bootstrap network/500 failure | retryable error shown, not silent auth form |
| Logout | cookie cleared, bootstrap 401, auth form shown |
| Repeated submit | one in-flight request, button disabled |
| Rate limit | 429 with visible retry message |
| Production cookie config | Secure, HttpOnly, SameSite=Lax, Path=/, no Domain |

## Commands

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build`
- `npm run assets:build`
- `npm run test:e2e`
- `npm run test:performance` (new)

## Release evidence

- `proof/performance-before.json`
- `proof/performance-after.json`
- asset validator report
- canonical catalog screenshot
- dense/private district screenshots
- auth route test output
- browser trace only for failed budgets
