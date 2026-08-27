# Country Atlas v6 cleanup evidence

## Scope

This cleanup removes only code and binary artifacts whose absence is proven by
the TypeScript import graph, Fastify route registration, asset manifests,
build scripts, tests, and repository-wide exact-name searches.

## Removed runtime pipeline

- schema-v5 `CountryAtlasCanvas` SVG renderer;
- `/api/country-atlas` route, service cache, DTO, projection, terrain and
  viewport helpers;
- building preview presentation used only by that renderer;
- task-progress patching that mutated only the removed schema-v5 DTO;
- rollback-only tests for those modules.

The active COUNTRY path is now uniquely:
`App -> CountryOverviewCanvas -> /api/countries/:countryId/overview -> schema v4`.

## Static code checks

- TypeScript `--noEmit` and ESLint validate local imports and unused locals.
- `ts-prune` validates exported TypeScript symbols. Findings marked
  `used in module` are retained; genuinely unused exports are deleted or made
  module-private.
- Exact repository searches confirm that deleted modules, selectors, route
  names and data attributes have no live references.

## Asset checks

The runtime pixel pack remains manifest-driven and is validated by
`npm run assets:verify`; direct-import reachability is not used for it.
Deleted images were limited to unreferenced historical review screenshots and
an unused SVG duplicate of the active PNG social card. AI-authored source
sheets, world/megacity validation captures, referenced documentation images,
and all 1,225 runtime PNGs remain.

All deleted binary files remain recoverable from Git history.

## RepoWise status

RepoWise is refreshed against the exact Game3 revision before analysis and
again after large structural changes. Findings from another repository or a
stale revision are rejected rather than used as deletion evidence.
