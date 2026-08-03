# QA

## Preconditions

- Clean deterministic database per scenario.
- Built v6 asset manifest.
- Desktop viewport 1440×900 and representative zoom levels.

## Positive scenarios

1. Create first city, verify entry road, city signs, stops, connected sidewalks.
2. Add NEW_BUILD district: majority apartment/mixed-use, dense facade line, normal shops, no random cottages.
3. Add PRIVATE district next to it: majority houses, small shops/gas allowed, paths from every entrance.
4. Grow city to 30 tasks: verify police, fire and clinic coverage in civic/mixed district.
5. Seal first district, grow to 100 tasks: diff all spatial cells; no mutation inside sealed geometry.
6. Add second through fifth city: road continuity, bridges, service area on long connector, signs/stops at entrances.
7. Toggle district overlay; default state off, selected district visible.
8. Observe vehicles and walkers; neither crosses buildings/water/grass and walkers use crosswalks.
9. Create two or more districts: verify at least one accessible park/grove, all furniture inside it, and no overlap with roads/tasks/water.

## Negative scenarios

- Parcel entrance cannot reach sidewalk within budget: building must be retried, never published unreachable.
- Service area candidate overlaps water/city/task: select another segment or omit with explicit audit warning.
- Explicit building type conflicts with footprint: request fails with actionable error, no partial geometry.
- Road route would enter SEALED district outside gateway: route is rejected.

## Logs and audits

- zero overlap and unreachable entrance findings;
- zero new infrastructure cells inside old sealed districts;
- all road networks connected per country component;
- service coverage counters by city;
- archetype distribution and repetition by adjacent districts;
- generation time and chunk payload size;
- browser console errors/warnings.
- green area ownership, sidewalk reachability and decor containment.

## Expected results

- 3×3×10 dense fixture and 1×10×10 growth fixture pass.
- At least 5 seeded worlds show different morphology without invalid archetype distributions.
- Growth checkpoints 20/60/100 complete without mutating sealed geometry; cumulative sequential growth stays under 3 seconds on the current machine.
- Scene remains readable at city-fit zoom; sidewalks and roads remain distinct.

## Recorded v6 evidence

- Dense fixture: 3 cities, 9 districts, 90 tasks, 30 building types, 67 world features, 6 green areas, 45 park props, 0 violations.
- Dense performance: about 2.9 s generation, 29 ms for 12 sampled chunks.
- District size range: 659–1189 cells in the representative fixture.
- Growth fixture: 10 districts, 100 tasks, 2,115 road cells; no changed task/district geometry and zero new roads inside previously completed districts.
- Scale fixture: 10 cities, 80 districts, 250 tasks and 90 chunks in about 23.4 s; park candidate occupancy is cached per district.
- Ten-seed soak: 10/10 worlds pass with no spatial violations.
- Playwright desktop/registration flow: 2 passed, no browser console errors; district toggle does not recreate the map.
