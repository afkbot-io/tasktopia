# Relevant files

- `src/server/world/block-planner.ts`
- `src/server/world/city-generation.ts`
- `src/server/app-service.ts`
- `src/client/components/WorldCanvas.tsx`
- `src/client/styles.css`
- `tests/block-planner-v9.test.ts`
- `tests/e2e/map-streaming.spec.ts`

# Decisions

- Keep one real frontage road per initial district.
- Represent internal variety with connected pedestrian surfaces.
- Send only PATH/PAVERS/ASPHALT summaries in overview.
- Hide PROP/BUILDING world features in overview.

# Open questions

None; existing contracts support the required lightweight surface cells.
