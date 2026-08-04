# QA

## Preconditions

- Disposable database with one city and ten districts.

## Scenarios

1. Inspect bootstrap: no `districts` or `tasks`; counts remain correct.
2. Load app: network contains bootstrap plus only current viewport chunks.
3. Open Plan: city summaries load; choose a city and only its districts load; choose a district and only its tasks load.
4. Emit task status/comment: canvas persists, affected chunk reloads, open plan scope refreshes.
5. Switch country and verify plan/map state resets.

## Negative scenarios

- Foreign city/district ids return not found/forbidden without leaking summaries.
- Failed plan request shows a retryable message without breaking the map.

## Expected result

Initial payload and retained client state do not scale with district cells or task geometry.
