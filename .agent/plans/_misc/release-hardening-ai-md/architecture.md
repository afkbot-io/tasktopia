# Architecture

## Current boundary

- Fastify manually creates a v1 MCP server and transport for each POST.
- Registration route composes auth and first-city services directly.
- Tailwind utilities coexist with active component CSS and verified dead pre-migration selectors.

## Target boundary

- Official MCP v2 `createMcpHandler` owns protocol negotiation and dual-era stateless dispatch; Fastify owns HTTP security/auth adaptation.
- A single application onboarding method owns account + country + first city atomicity.
- CSS retains only live semantic/component rules; new interface structure remains Tailwind-first.
- `/ai.md` is the canonical AI-facing integration contract; `docs/MCP.md` remains the developer/operator detail.

## Alternatives considered

- Keep SDK v1: rejected because it cannot serve the 2026 protocol era.
- Implement a custom 2026 protocol adapter: rejected in favor of the official SDK handler.
- Publish OAuth discovery without an authorization server: rejected as misleading and non-compliant.
- Remove all versioned schema names/assets: rejected because they are active compatibility/provenance surfaces.

## Rollout and rollback

- Preserve 2025 stateless fallback while adding 2026 support.
- Existing personal tokens remain valid but must be sent as Bearer credentials.
- Deploy through the existing health-checked Docker script.
- Roll back to the previous image/tag and database backup if MCP initialization or health fails.
