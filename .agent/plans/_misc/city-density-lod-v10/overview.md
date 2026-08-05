# Goal

Make district layouts visibly varied and compact, keep minor streets readable in overview, and explain all asynchronous map loading without blanking already rendered ground.

# Scope

- District pedestrian topology and lot density.
- Lightweight overview surfaces and semantic LOD filtering.
- Initial and streaming map loading feedback.
- Deterministic generation and browser/performance regression coverage.

# Non-goals

- Replacing the pixel-art asset set.
- Loading detail sprites or all world entities in overview.
- Large multi-city stress tests in the default test suite.

# Acceptance criteria

- At least five deterministic district access topologies are produced across seeds/archetypes.
- An empty district publishes one frontage road and no unused branches.
- Overview contains simplified local paths but hides detailed props and service-building sprites.
- Initial load is blocking and later chunk/LOD loads show a non-blocking indicator over retained ground.
- One city with ten districts stays within the existing generation and memory budgets.
- Unit, type, lint, build, and targeted browser tests pass.

# Current status

Complete and verified in production as Tasktopia 1.7.0.

# Risks

- Changed paths can invalidate task placement access.
- Overview surfaces can increase payload size if not strictly filtered.
- React loading state can flicker during fast pan/zoom.

# Finish checklist

- [x] Implementation complete
- [x] Regression tests green
- [x] Browser evidence captured
- [x] Separate scale test green
- [x] Documentation and changelog updated
- [x] Production health verified
