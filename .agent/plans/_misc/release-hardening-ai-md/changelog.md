# Release-facing notes

## Added

- Public `/ai.md` integration handoff.
- MCP 2026-07-28 support with 2025 compatibility.

## Changed

- MCP authentication accepts only the standard Authorization Bearer header.
- Registration requires and atomically creates the first country and city through the application boundary.
- Safe dependency updates and documentation synchronization.

## Removed

- `X-API-Key` and bare-token compatibility.
- Verified unused pre-Tailwind CSS selectors.

## Fixed

- Consistent MCP Origin validation for GET, POST and DELETE.
- Realtime events and cache invalidation are published only after the outer database transaction commits.
- District routing retries alternative safe connections when the closest road pair is blocked by a reservation halo.
- Heavy world-generation tests use an explicit isolated timeout budget instead of the default unit-test budget.
