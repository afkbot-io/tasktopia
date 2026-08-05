# Release hardening and AI integration

## Goal

Bring Tasktopia to a clean, current release state: remove verified dead UI code, modernize the MCP transport and bearer-token contract, centralize onboarding, eliminate known runtime warnings, and publish a self-contained `/ai.md` integration guide.

## Scope

- Upgrade the official MCP TypeScript SDK from v1 to v2 and serve current 2026-07-28 plus 2025-era stateless traffic.
- Keep personal Tasktopia API keys as externally managed Bearer credentials; reject `X-API-Key` and bare authorization values.
- Validate Origin consistently on MCP methods and preserve least-privilege scopes, revocation, expiry, idempotency, resources, and 17 tools.
- Add a public `/ai.md` containing endpoint, authentication, entity model, client config, tool workflow, schemas/examples, error handling, and security guidance.
- Move registration + first-city creation behind an application-service onboarding use case.
- Remove selectors and responsive branches proven unused after the Tailwind migration.
- Update safe production dependencies and investigate the observed `TimeoutNegativeWarning`.
- Synchronize README, MCP docs, QA, architecture, changelog, and public AI guidance.

## Non-goals

- Do not delete active versioned PostgreSQL tables or rename schema objects without a migration.
- Do not delete asset source packs used by the v4 asset build pipeline.
- Do not publish fake OAuth metadata or claim OAuth 2.1 support without a complete authorization server.
- Do not redesign world-generation algorithms that already pass the one-city/ten-district invariant gate.
- Do not run large multi-city stress fixtures as part of the default test suite.

## Acceptance criteria

- `/ai.md` returns `200`, `text/markdown`, needs no session, and is usable as the only integration handoff.
- Official MCP v2 client connects over Streamable HTTP, lists 17 tools, reads resources, and exercises scope/revocation checks.
- Both 2026-07-28 and legacy 2025 stateless MCP requests are supported by the official dual-protocol handler.
- Only `Authorization: Bearer ttp_mcp_...` authenticates MCP requests.
- Invalid Origin gets `403` on every MCP method.
- Registration atomically creates account, country, and first city through an application-service boundary.
- Confirmed unused CSS is gone; active CSS and asset provenance remain intact.
- Build, types, lint, unit/integration coverage, E2E, MCP smoke, asset audit, and isolated scale test pass.
- Production health, HTTPS, MCP anonymous boundary, and `/ai.md` pass after deployment.

## Current status

Implementation and local release gates are complete on
`codex/release-hardening-ai-md` from release `v1.1.2` (`116d03e`). Production
deployment evidence is the remaining release step.

## Risks

- MCP v2 is a package split and protocol upgrade; mitigate with official dual-era handler and SDK smoke tests.
- Removing compatibility headers is a deliberate breaking security cleanup; document it in changelog and AI guide.
- CSS selectors can be dynamic; delete only after repository-wide consumer checks and browser E2E.
- Dependency majors may require configuration changes; update incrementally and verify each group.

## Finish checklist

- [x] Implementation complete
- [x] Independent Standards and Spec review complete
- [x] Stale code/docs audit complete
- [x] Full verification green
- [x] Docs, QA, architecture, changelog, and `/ai.md` synchronized
- [ ] Commit, push, release/deployment evidence recorded
