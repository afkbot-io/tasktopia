# Decomposition

## Verdict

Recommended shape: one coordinated local implementation with five review gates. The generator, fixtures and renderer share geometry contracts, so separate unmerged branches would repeatedly conflict.

## Dependency graph

`G1 road geometry -> G2 mobility surfaces -> Z1 zoning -> F1 fixtures -> Q1 proof/docs`

## Review gates

1. **G1 Geometry foundation** — pure functions, widths and integration tests.
2. **G2 Mobility** — sidewalks, crossings and visible agents.
3. **Z1 Zoning** — hard compatibility, city quotas and catalog tests.
4. **F1 Fixtures** — large/small cities and lifecycle invariants.
5. **Q1 Finish** — audits, screenshots, docs and cleanup.

