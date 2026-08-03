# Planned release notes

## Fixed

- Map freezes and high memory use during pan/zoom.
- Duplicate email registration returning a server error.
- Silent bootstrap/session failures in the authentication UI.
- Inconsistent perspective and palette in private-house sprites.

## Changed

- Static world tiles render as cached chunk layers with level of detail.
- Dense districts can form 3–5-building rows; private districts form coherent housing streets.
- Authentication uses an explicit loading/error state and environment-specific cookie policy.

## Compatibility

- Country/city/district/task and MCP contracts remain compatible.
- Existing completed districts retain stored geometry.
- Cookie-name migration may require one deliberate re-login unless a one-release compatibility read is enabled.

