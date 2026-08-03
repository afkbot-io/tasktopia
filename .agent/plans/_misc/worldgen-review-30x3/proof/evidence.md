# Evidence

Verified on 2026-08-03T01:43:54+03:00 from clean in-memory/temporary databases.

## Dense fixture

- Seed `424242`: 3 cities, 9 districts, 90 tasks.
- Per city: exactly 3 districts and 30 tasks; per district: exactly 10 tasks / 26 SP.
- 3,505 road cells: 554 local, 338 collector, 418 arterial, 2,195 highway.
- 53 bridge cells; all bridges lie on water.
- Global road network, all districts and all task footprints pass spatial invariants.
- Maximum task-to-road distance: 2 cells.
- 34 building types overall, 30 distinct types in every city.
- Stages 1–5: exactly 18 tasks each.
- Topological junction zones: Riverside 8, Harborview 7, Pinegate 9.
- Generation 813 ms; 12 chunks / 49,152 terrain cells in 28 ms; RSS 243 MB.

## Robustness and scale

- Ten-seed soak: 10 passed, 0 failed; maximum generation time 1,014 ms.
- Scale: 10 cities, 80 districts, 250 tasks, 21,097 roads, 90 chunks; generation 7,705 ms, chunks 537 ms, RSS 406 MB.

## Quality gates

- `npm run lint`: pass.
- `npm run typecheck`: pass.
- `npm test -- --run`: 7 files / 25 tests passed.
- `npm run build`: pass; one accepted 510.76 kB chunk warning.
- Isolated Playwright: 2/2 passed, zero collected console errors.
- MCP smoke: 20 tools discovered; revoked token rejected.
- Docker Compose config, image build and container `/health`: pass (`0.5.0`).

## Visual evidence

- `screenshots/mvp-city-desktop.png`
- `screenshots/mvp-harborview.png`
- `screenshots/mvp-pinegate.png`
- `screenshots/mvp-city-zoomed-out.png`

All three district envelopes are visible after focus; the zoomed-out frame contains generated terrain rather than black space.
