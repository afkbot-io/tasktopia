# References

## Runtime

- `src/client/components/WorldCanvas.tsx` — current renderer, camera, chunk lifecycle, and simulation.
- `src/client/world-camera.ts` — viewport bounds and chunk range.
- `src/client/App.tsx` — renderer inputs, socket refresh, and auth bootstrap state.
- `src/client/components/AuthScreen.tsx` — login/register pending and error UX.
- `src/client/api.ts` — API error transport.

## Server

- `src/server/routes.ts` — auth routes, error mapping, origin policy.
- `src/server/auth.ts` — password/session/cookie token operations.
- `src/server/db.ts` — users, sessions, countries, task/world schema.
- `src/server/app-service.ts` — district lot planning and building placement.

## Assets

- `assets/pixel-city-pack-v4/manifest.json` — canonical runtime asset metadata.
- `assets/pixel-city-pack-v4/catalog/generated-buildings.json` — V4 additions.
- `scripts/build-pixel-city-pack-v4.py` — asset build and current validation.
- `screenshots/pixel-city-v4-expanded-assets.png` — current complete stage catalog.
- `assets/pixel-city-pack-v4/reference/expanded-city-assets-reference.png` — reference-only image; not runtime geometry.

## Existing tests

- `tests/e2e/app.spec.ts`
- `tests/world-camera.test.ts`
- `tests/agent-routing.test.ts`
- `tests/catalog.test.ts`
- `tests/routes-collaboration.test.ts`
- `tests/dense-worldgen.test.ts`

## Audit decisions

- Original five high-rises define visual style.
- Static chunk baking plus incremental entities is preferred over a Canvas rewrite.
- Overview LOD intentionally pauses tiny agents because they are not legible at that scale.
- New block patterns apply only to newly planned districts unless an explicit migration is added later.

## External primary references

- PixiJS 8 Render Groups: https://pixijs.com/8.x/guides/concepts/render-groups
- PixiJS 8 Cache As Texture: https://pixijs.com/8.x/guides/components/scene-objects/container/cache-as-texture
- PixiJS 8 performance tips: https://pixijs.com/8.x/guides/concepts/performance-tips
- PixiJS userland tilemap compatibility: https://github.com/pixijs-userland/tilemap
- UK National Model Design Code Part 2: https://www.gov.uk/government/publications/national-model-design-code/national-model-design-code-part-2-guidance-notes-html-accessible-version
- NACTO Residential Shared Street: https://nacto.org/publication/urban-street-design-guide/streets/residential-shared-street/
- URA Terrace Houses: https://www.ura.gov.sg/guidelines/development-control/development-control-handbooks/residential/terrace/
