# QA

## Generator invariants

- Deterministic output for identical country seed and commands.
- No road, surface, task, feature, or district collision.
- Every task footprint is inside its district.
- Every entrance reaches a sidewalk/path.
- Road graph is connected to the city gateway.
- District asphalt ratio ≤20% for NEW_BUILD and PRIVATE small-city fixtures.
- NEW_BUILD primary buildings are all dense residential; PRIVATE primary buildings are all private residential.
- Dense group sequential fill produces at least one row of three touching/aligned buildings after three compatible tasks and a 3×3 group after nine.
- Adding tasks within capacity does not increase road cells while compatible group slots remain.

## Test scenarios

1. One NEW_BUILD district, nine compatible tasks added sequentially.
2. One PRIVATE district, ten small tasks added sequentially.
3. Three small cities, one district each, mixed estimates and services.
4. Fill a district, trigger one expansion, assert one complete group and bounded road growth.
5. Replay each scenario with the same seed and compare normalized geometry.

## Auth scenarios

- New registration creates and opens a country.
- Existing user login restores the last country.
- Invalid credentials show a Russian message.
- Duplicate email shows a conflict message.
- Bootstrap failure offers retry without creating a second account/session.
- Logout returns to anonymous state and protected endpoints reject the session.

## Browser review

- No development-phase wording.
- Dense city reads as blocks, not a road maze.
- District borders stay hidden by default.
- At region zoom, city massing remains legible.
- Keyboard focus, labels, errors, and pending state are visible.

