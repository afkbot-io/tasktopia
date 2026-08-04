# Changelog

## Completed

- Lightweight 927-byte bootstrap without all-world district/task geometry.
- Lazy plan summaries scoped by city and district.
- SQLite chunk membership index maintained by triggers and one-time backfill.
- Overview-specific payloads, compact chunk DTOs, quarter-viewport prefetch and visible-only PNG loading.
- Initial 18-chunk overview payload measured at 531,711 bytes versus 4,067,218 bytes for the same detail range.
- Removal of large generator test commands and fixtures.
