# Decomposition

## Verdict

Hybrid stacked slices in the current dirty branch; contracts/data precede UI.

## Dependency graph

`V13-1 contracts/migration -> V13-2 token security -> V13-5 finish`

`V13-1 -> V13-3 pagination -> V13-5`

`V13-1 -> V13-4 backfill/reconciler -> V13-5`

## Slices

1. **V13-1 Additive contracts** — role, token DTOs, page DTO, progress schema; backward compatible; focused type/migration tests.
2. **V13-2 Least-privilege MCP** — issue/list UI and role enforcement; public behavior; auth/MCP tests.
3. **V13-3 Cursor plan** — additive endpoint and client accumulation; public read path; pagination tests.
4. **V13-4 Data/runtime cleanup** — resumable backfill and extracted reconciler; internal rollout; migration/unit/E2E tests.
5. **V13-5 Finish** — docs, security/stale review and full gate.

Rejected split: independent branches, because shared contracts and existing uncommitted V9–V12 work would create unsafe merge conflicts.
