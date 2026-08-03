# Frozen proof spec

Frozen at: 2026-08-03 before baseline execution.

## Scenario

- Seed: `424242`.
- Cities: 3.
- Districts: exactly 3 per city.
- Tasks: exactly 10 per district / 30 per city / 90 total.
- Task stages: all 1–5 represented.

## Required proofs

| ID | Criterion | Evidence |
|---|---|---|
| AC-1 | Exact entity counts | audit JSON |
| AC-2 | Connected/non-overlapping districts inside city bounds | audit assertions |
| AC-3 | Task footprints inside district, disjoint and road-free | audit assertions |
| AC-4 | Road access within 2 cells | audit assertions |
| AC-5 | Connected roads and valid bridges | audit assertions |
| AC-6 | Building diversity and five stages | audit JSON |
| AC-7 | Generation/chunk performance budgets | timing JSON |
| AC-8 | Browser visual/console/camera QA | Playwright report + screenshots |
| AC-9 | Regression quality gate | raw command logs |

The verifier must use a newly created database and must not edit production code.

