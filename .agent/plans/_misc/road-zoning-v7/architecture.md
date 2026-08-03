# Architecture

## Current boundary

Road centerlines are expanded directly inside `AppService`; existing road cells short-circuit expansion. Building archetypes are soft scoring bonuses. Demo fixtures explicitly reuse mixed task lists.

## Target boundary

- `world/road-geometry.ts`: pure corridor stamping, canonical junction envelope, crossing discovery and geometry metrics.
- `world/city-generation.ts`: road width policy, zoning eligibility, morphology quotas and surface graph.
- `AppService`: orchestration, persistence and transactional retries only.
- Fixtures own representative product scenarios and lifecycle transitions, not generator rules.

## Key decisions

- Keep square 8 px cells and data-driven sprites.
- Use odd width 3 for local roads to keep a real center axis; use width 4 for larger roads with explicit stable bias.
- Always stamp the requested corridor across existing asphalt, then union and recalculate masks.
- Treat residential massing compatibility as a hard constraint; use soft scoring only among compatible entries.
- Keep support uses contextual: retail/civic is allowed by quotas but private/highrise housing families cannot leak across zoning.

## Alternatives considered

- Only change widths: rejected because it preserves broken junction topology.
- Hand-authored intersection sprites: rejected; geometry is assembled from 8 px cells and must support arbitrary maps.
- Make every district mixed: rejected because cities lose readable identity.
- Persist full lane centerline schema now: deferred; v7 improves visible movement without a migration-heavy traffic simulator.

## Rollout and rollback

The generator version advances to `square-v7`. Existing SQLite data is not destructively migrated. Demo DB is backed up and reseeded. Rollback is restoring the backup and v6 code.

