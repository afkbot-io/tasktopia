# References

- `src/server/mcp.ts`
- `src/server/index.ts`
- `src/server/auth.ts`
- `src/server/routes.ts`
- `src/server/app-service.ts`
- `src/client/styles.css`
- `scripts/mcp-smoke.ts`
- `docs/MCP.md`
- `docs/ARCHITECTURE.md`
- `docs/QA-1.2.md`
- MCP Streamable HTTP: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- MCP Authorization: https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- SDK v2 migration: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/support-2026-07-28.md

## Decisions

- Current personal API keys are externally managed Bearer credentials, not OAuth access tokens.
- OAuth remains unsupported until a complete authorization-server flow exists.
- Active versioned schema and required asset sources remain.
