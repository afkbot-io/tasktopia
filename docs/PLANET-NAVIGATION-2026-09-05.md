# PLANET / COUNTRY geography and wheel navigation

Scope: integration worktree at base `b42fe594`; changes are not deployed. This slice changes derived atlas geography and navigation, not stored city terrain, city layouts, task data or building assets.

## Geography

- `projectPlanetAtlas` still chooses seed-derived preferred groups. Neutral land links now advance on exactly one axis per step, matching `SQUARE_4`. Public `continent` is the actual connected land component, not a hash label that could disagree with touching coastlines. Several countries may share a component; separated components remain islands/continents.
- Ocean and neutral coastal land are disjoint cell sets. COUNTRY inherits the exact PLANET macro terrain family, including foreign ownership and neutral shore. It no longer independently replaces rivers with grass, forest with meadow or border grass with coast. Texture variants remain a rendering detail.
- COUNTRY schema is **6**. Existing process/browser data is recreated with the build; persisted overview snapshots are rejected by schema and replaced by normal reads. No city/world regeneration is needed.
- `projectPlanetWorldPoint` owns settlement projection onto country macro cells. `createCountryWorldProjection` transforms that same macrocell and subcell position into COUNTRY coordinates. `getCountryOverview` no longer normalizes the city bbox separately or assigns cities to arbitrary nearest free terrain cells.
- This is revision-consistent derived geography, not a new durable planetary write model. Country growth, world extent and accessible-country set still influence existing seed projection. District/building symbols remain level-specific miniatures, not a 1:1 city raster.

## Navigation

- One `createAtlasWheelNavigation` instance belongs to App and is shared by all levels. App capture observes input even during async loading and retained-renderer transitions. A continuous same-direction wheel burst can commit at most one level change.
- The first eligible delta triggers immediately: no required extra steps, timed hold, `abs(deltaY) <= 600` exception, or forced zoom-out retreat after returning to a parent. An opposite direction is a new intent. A 220 ms input silence separates bursts; it is not a transition delay.
- CITY exits at its actual viewport-dependent minimum; COUNTRY exits at `.55`. COUNTRY enters the real city footprint under the cursor at `2.6`. PLANET enters a real owned cell under the cursor once country coverage reaches `.56`, never the nearest country over ocean or outside the surface aperture.
- Wheel magnitude and RAF camera smoothing remain. Normalized cursor focus reaches the transition presentation; COUNTRY city entry also passes the corresponding source cell. Existing level-entry cameras retain selected entity anchors. SVG `xMidYMid meet` letterboxing is included for PLANET wheel/pinch coordinates on desktop/mobile.
- Directory controls retain native scrolling and cannot zoom/change levels. Dense city labels, local city search, retained CITY and bounded data caches are unchanged.

## Verification

Red witnesses: COUNTRY turned canonical grass into coast; ocean included coastal land; missing shared world projection; missing single-burst navigation; missing letterbox-correct cursor transform. Regression suites now cover four-connected continents over three seeds, exact inherited macro terrain/ownership, shared source/subcell projection, 100 distinct city points, long inertia across loading, immediate reversal, ocean/aperture exclusion and mobile letterboxing.

Focused Node 24 run: `tests/atlas-wheel-gesture.test.ts`, `atlas-zoom-navigation.test.ts`, `country-canonical-projection.test.ts`, `country-geography.test.ts`, `planet-atlas-projection.test.ts`, `country-city-labels.test.ts`, `planet-visible-countries.test.ts`, `country-overview-projection.test.ts`: **41/41 passed**, 8 files, 766 ms (2026-09-05). Scoped ESLint passed. Whole-tree TypeScript is temporarily blocked by parallel incident/task-move implementation types; the earlier checkpoint was green. Do not mistake this scoped result for an executed final release gate.

Browser regression: `tests/e2e/atlas-wheel-navigation.spec.ts`, enabled only by `E2E_ATLAS_WHEEL_FIXTURE=true`, against the explicitly selected isolated 40-task demo schema. It uses real wheel input, read-only DTO observation, same-city reentry and no chunk/viewport requests. Browser/build execution is coordinated by the main agent; **NOT RUN by this slice yet**. Existing map-streaming and country-camera tests now reflect immediate boundary transitions rather than the removed large-delta exemption.

## Remaining road boundary

There is still no canonical runtime country-to-country/city-to-city ground route graph. Existing COUNTRY `connections` are completed-airport flight links, not roads. A proposed bounded intercity planner was deferred when permanent task-move/ruin handling became the parallel priority. This slice deliberately adds neither fake overview lines nor a phantom `groundConnections` contract. Real routes must originate at actual city boundary road nodes, validate the authoritative terrain, and supply the same geometry to CITY clipping and COUNTRY projection. Nearest-owned macro projection can be nonlinear: nonadjacent projected route steps must not be drawn as a synthetic bridge.

## Documentation surfaces

Updated: this design/verification note, maintained architecture navigation paragraph, QA schema/zoom cases. No DB migration, asset manifest, task API, MCP contract or permission model is changed by this slice. Release/MR and final browser evidence remain the main agent's coordinated gate.
