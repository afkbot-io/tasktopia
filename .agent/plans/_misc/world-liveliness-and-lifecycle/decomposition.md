# Decomposition verdict

Recommended shape: one release branch with four reviewable commits. The data, chunk DTO and renderer contracts are tightly coupled, while independent production deploys would expose incomplete states.

## Dependency graph

MR-1 -> MR-2 -> MR-4
MR-1 -> MR-3 -> MR-4

## Slices

1. MR-1 — advisory workload and lifecycle operations
   - Contract: existing capacity field remains readable; delete tools are explicit and idempotent.
   - Verification: service and MCP tests.
2. MR-2 — deterministic world topology and ecology
   - Contract: chunk protocol adds only optional visual metadata; no whole-world fetch.
   - Verification: world audit, generation and routing tests.
3. MR-3 — renderer interaction and asset pack
   - Contract: lower badges, hover tooltip, active boundary and sparse chunk-local sprites.
   - Verification: asset audit, client tests and browser QA.
4. MR-4 — docs, release and production rollout
   - Verification: full suite, backup, smoke, resource health.

## Rejected split

Separate production MRs were rejected because new manifest keys, chunk decoration kinds and renderer lookup must land atomically.
