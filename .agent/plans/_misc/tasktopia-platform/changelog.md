# Changelog

## 0.2.0 — working MVP

### Added

- Country/account registration and session authentication.
- Chunked deterministic hex world with land-aware city placement.
- Project/city, sprint/district and task/building domain model.
- Connected roads, reciprocal masks and automatic bridges.
- Expandable nine-entry building catalog with 1/2/3-hex footprints.
- Separate yard/stone/asphalt/service/park platforms below buildings.
- Five procedural construction stages and task detail modal.
- MCP Streamable HTTP tools, scoped hashed tokens and idempotency.
- Socket.IO realtime invalidation.
- Docker/Caddy deployment, CI, healthcheck and documentation.

### Fixed

- Road material passes no longer cover one another at junctions.
- Adjacent road cells overlap slightly so zoom cannot reveal seams.
- District borders draw only the external perimeter.
- Mobile resize preserves the world camera focus.
- City site selection avoids seeds with insufficient connected dry land.

### Security

- Passwords use salted scrypt; tokens and sessions are stored as hashes.
- Tenant identity comes from the authenticated session or MCP token.
- Unsafe cookie-auth requests validate origin/forwarded host.
- Login/token/MCP rate limits, CSP/security headers and log redaction enabled.
- `npm audit --audit-level=high` is part of CI.
