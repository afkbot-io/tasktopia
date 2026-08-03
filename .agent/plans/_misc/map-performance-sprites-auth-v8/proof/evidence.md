# Verification evidence — world, zoning and sprites

Date: 2026-08-03

## Asset contract

`npm run assets:build && npm run assets:verify`

- deterministic rebuild completed;
- 46 building families / 230 construction stages;
- 12 terrain families, 45 props, 4 vehicle colors;
- 343 referenced PNG = 343 runtime PNG;
- maximum building palette 25 of 32 colors;
- no missing references, orphan files, soft alpha, geometry, anchor or stage violations.

Visual review used `screenshots/pixel-city-v4-expanded-assets.png` and real Riverside/Pinegate/Harborview renders. No missing sprite, wrong canvas, soft edge or runtime scale defect required regeneration. Procedural rebuilding therefore remained unchanged; the new audit is the gate for future manual/generated art.

## World generation

- `npm run test:review-worldgen`: 3 cities / 9 districts / 90 tasks, 24 building types, 6 green areas, 445 crosswalk cells, all service roles, zero violations.
- `npm run test:review-worldgen:soak`: 10/10 seeds passed, maximum seed generation 2.904 s, zero violations.
- `npm run test:growth-lifecycle`: checkpoints 20 → 60 → 100 tasks passed; no old task geometry changed, no completed district changed, no new road entered a previous district.
- `npm run test:scale`: 10 cities / 80 districts / 250 tasks / 41,849 road cells; generation 42.815 s of 60 s, 90 chunks 1.195 s of 5 s, RSS 470 MB of 768 MB.
- representative fixture: 4 cities / 35 districts / 350 tasks; Riverside has 200 tasks; every city has exactly one active and one planned district; 13 focused tests passed.
- residential zoning: incompatible private/dense families remain forbidden; mature `NEW_BUILD` keeps at least 70% dense/mixed-use buildings and mature `PRIVATE` at least 60% private homes.

## Browser and build

- isolated 100-task growth world: Chromium E2E passed in 4.4 s; 39 building types, 4,249 road cells, 36 bridge cells and zero unreachable entrances. Screenshot: `proof/growth-100.png`.
- full Chromium suite: 4 passed, 1 opt-in growth test skipped, zero console errors.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test`: 15 files / 54 tests passed.
- `npm run build`: passed; Vite reports the existing 531 kB client-chunk optimization warning.
- `git diff --check`: passed.
