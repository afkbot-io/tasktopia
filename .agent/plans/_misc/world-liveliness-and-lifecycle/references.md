# Relevant files

- `src/server/app-service.ts`
- `src/server/mcp.ts`
- `src/server/world/block-planner.ts`
- `src/server/world/world-audit.ts`
- `src/client/components/WorldCanvas.tsx`
- `scripts/build-pixel-city-pack-v4.py`
- `public/game-assets/v4/manifest.json`

# Decisions

- `capacitySp` remains an advisory target for backward compatibility.
- Deletion confirmation uses the current exact visible name/title.
- Decorative life remains deterministic, sparse and chunk-scoped.
