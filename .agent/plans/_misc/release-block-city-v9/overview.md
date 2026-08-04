# Tasktopia V9 — release block city

## Outcome

Replace per-building road-and-lot generation with deterministic block groups. New districts must read as coherent real city fragments: dense residential complexes, private-house streets, commercial strips, and civic clusters. Automatic task creation fills an existing compatible block before any district expansion.

The same release removes prototype wording from the public product, hardens the authentication journey, and gives the application a production-ready entry state.

## Product hierarchy

- Country: the user's project/world.
- City: an epic/subproject inside a country.
- District: a sprint.
- Building: a task with five construction stages.

UI copy must use only the world vocabulary above.

## Acceptance criteria

1. A `NEW_BUILD` district can reserve and fill a contiguous 3×3 residential superblock of up to nine high-rise tasks.
2. Buildings in the same dense row share a baseline and have no arbitrary grass gaps; internal access is pedestrian, not a new vehicle road.
3. A new district creates one main frontage street and at most one short access connection. It does not create a full cross-grid by default.
4. Automatic task creation chooses a compatible free slot in the current block group. It creates a new block group only after all compatible slots are occupied.
5. District growth appends a complete block group and its required access, never a one-building road spur.
6. `PRIVATE` districts use coherent house rows/two-sided streets/mews and contain no high-rises.
7. `NEW_BUILD` districts contain no private-house residential tasks; support buildings have a bounded quota.
8. Every task entrance reaches a public sidewalk/path and no building overlaps roads, surfaces, other tasks, or district boundaries.
9. For small deterministic cities, asphalt occupies no more than 20% of district cells and no generated road component is disconnected.
10. Existing stored districts remain readable; V9 metadata is additive in `lots_json`.
11. Registration, login, reload, invalid credentials, duplicate registration, country bootstrap retry, and logout have automated coverage with readable Russian errors.
12. Public UI contains no `MVP`, `demo`, `демо`, `prototype`, or test-account copy.
13. Browser QA covers at least three small cities and automatic task addition through an existing district.

## Non-goals

- Moving already completed buildings in old countries.
- AI-authored layouts.
- A city editor in the web interface.
- Replacing the deterministic terrain generator or pixel asset pack in this slice.

## Rollout

- `square-v7` terrain/chunks stay compatible.
- V9 block metadata is optional on `PlannedLotDto`; old lots remain valid.
- New districts use `block-v2`; existing lots are not migrated in place.
- A rollback can disable block planning for newly created districts without a database rollback.

