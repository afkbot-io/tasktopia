# QA

## Preconditions

Disposable SQLite; one city, 10 districts; Playwright Chromium installed.

## Positive

- Owner/member issue 30/90/365-day custom-scope tokens and use allowed tools.
- Viewer issues read-only token and can read country/tasks.
- Plan consumes multiple small cursor pages in stable order without duplicates.
- Legacy null-expiry token remains valid.
- Backfill completes all district/task/feature membership and clears progress.
- Map behavior and counters remain unchanged after reconciler extraction.

## Negative

- Viewer write scope, unknown scope, empty scope, invalid expiry are rejected.
- Expired/revoked/insufficient-scope MCP token cannot mutate.
- Invalid/tampered cursor returns 400.
- Restarted backfill does not duplicate or skip rows.

## Expected

All fresh gates pass; large growth E2E remains explicitly skipped by default.
