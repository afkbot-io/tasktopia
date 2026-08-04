# Chunked bootstrap V11

## Goal

Make the first application load independent of total district/task geometry and keep world data behind chunk or explicit plan requests.

## Scope

- Lightweight bootstrap with country statistics and city envelopes only.
- Chunk-only map geometry.
- Lazy city/district/task plan endpoints.
- Removal of large generator test commands; retain a one-city/ten-district gate.

## Non-goals

- Database migration or PostgreSQL rollout.
- Artistic sprite redraw.
- Infinite pagination for the small city directory; district/task detail is still scoped by selection.

## Acceptance criteria

- `/api/bootstrap` contains no district cells, lots, task footprints or access paths.
- Opening the map fetches only visible chunks, with bounded concurrency.
- Opening Plan fetches city summaries, selecting a city fetches only its district summaries, selecting a district fetches only its task summaries.
- Realtime invalidation refreshes the affected chunk and active plan scope without full-world reload.
- Default generator gate uses one city and ten districts; no package script starts a large generator profile.
- Typecheck, lint, unit, build and focused browser/API checks pass.

## Current status

Implementation and focused verification complete.

## Risks

- Existing UI and E2E code assumes full `bootstrap.districts/tasks`.
- Country switching and realtime refresh must preserve selected city.
- Plan requests must enforce current-country access.

## Finish checklist

- [x] Contract and routes
- [x] Client migration
- [x] Tests and stale-path cleanup
- [x] Documentation and QA
- [x] Fresh verification
