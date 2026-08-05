# Preconditions

- PostgreSQL test database is available.
- Asset pack can be rebuilt deterministically.

# Positive scenarios

- Create tasks whose total estimate exceeds the district planning target.
- Delete a task, an empty/filled district and a city using exact confirmation; retry the same idempotency key.
- Generate one city with ten districts and inspect topology, fences, crossings, shore life and routes.
- Pan/zoom repeatedly while chunks load; verify no black seams and bounded requests.
- Hover a completed and an active building badge.

# Negative scenarios

- Wrong confirmation, foreign country ID, completed/unknown entity, or reused idempotency key with different input.
- Decorative entities on roads/buildings/deep-water mismatch or disconnected pedestrian access.

# Logs and expected results

- No capacity rejection, CSP/cache warning, unhandled Pixi promise or request storm.
- World audit has no structural violations.
- Only visible detail chunks load expensive assets/entities.
