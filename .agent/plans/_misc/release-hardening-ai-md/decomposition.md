# Decomposition

## Verdict

- Recommended shape: hybrid slices on one release-hardening branch.
- Reason: MCP transport/docs form one public contract; onboarding and CSS cleanup are independently verifiable; final release requires all gates together.
- Main risk: protocol migration changing interoperability.

## Dependency graph

MR-1 -> MR-2 -> MR-5
MR-3 -> MR-5
MR-4 -> MR-5

## Slices

### MR-1: Modernize MCP boundary

- Outcome: current and legacy official SDK clients use the same authenticated endpoint.
- Owned surfaces: MCP server, HTTP entrypoint, token auth, MCP tests/smoke, package dependencies.
- Dependencies: none.
- Contract: Streamable HTTP `/mcp`; strict Bearer personal keys; dual protocol eras.
- Rollout: public replacement with documented compatibility.
- Verification: official client smoke, scopes, revocation, Origin and auth tests.
- Risk: SDK v2 API changes; use official handler rather than custom protocol code.

### MR-2: Publish AI handoff contract

- Outcome: one public URL teaches an AI how to connect and operate Tasktopia safely.
- Owned surfaces: `public/ai.md`, route/static delivery, README, MCP docs, tests.
- Dependencies: MR-1.
- Contract: `/ai.md` is anonymous Markdown and matches registered tools exactly.
- Rollout: additive public documentation.
- Verification: HTTP/content tests and manual client-config review.

### MR-3: Centralize onboarding

- Outcome: account, country and first city are one application use case.
- Owned surfaces: application/auth service boundary, route, tests, architecture docs.
- Dependencies: none.
- Contract: atomic success/rollback remains unchanged.
- Rollout: internal refactor with identical API.
- Verification: existing registration and rollback tests.

### MR-4: Remove proven UI/runtime legacy

- Outcome: obsolete CSS and compatibility paths are gone; safe dependencies are current.
- Owned surfaces: styles, package lock, QA/changelog.
- Dependencies: none.
- Contract: supported responsive UI remains visually and accessibly equivalent.
- Rollout: cleanup.
- Verification: exact searches, build, E2E, accessibility, dependency/security scan.

### MR-5: Release verification and deployment

- Outcome: tagged production version with synchronized docs and clean health evidence.
- Owned surfaces: version/changelog/deployment metadata.
- Dependencies: MR-1 through MR-4.
- Contract: release gates and public endpoints are green.
- Rollout: Docker deployment with existing rollback backup.
- Verification: full local gates, independent review, production health/log/MCP/AI checks.

## Rejected splits

- Separate MCP code and MCP documentation: rejected because it would temporarily publish a misleading contract.
- Rename version-suffixed PostgreSQL tables: rejected because it adds migration risk without removing runtime legacy.
- Delete all historical asset packs: rejected until every build/provenance dependency is formally replaced.
