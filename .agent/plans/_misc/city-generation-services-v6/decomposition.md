# Decomposition verdict

- Recommended shape: hybrid, stacked behavior slices in one MVP branch.
- Reason: contracts/assets can land additively, but generator, audit and renderer must switch together to avoid publishing spatial layers the client cannot interpret.
- Plan source: `overview.md` and `architecture.md` in this directory.
- Main risk: a half-migrated world can visually render while having invalid mobility/access constraints.

## Dependency graph

```text
MR-1 contracts + asset catalog
 ├─> MR-2 mobility-aware districts and entrances ─> MR-4 UI + agents
 └─> MR-3 morphology, civic and roadside features ─┘
MR-2 + MR-3 + MR-4 ─> MR-5 audits, migration, docs and cleanup
```

## Slices

### MR-1 — Add spatial contracts and v6 asset pack

- Outcome: backward-compatible DTOs and exact registered sprites exist without switching generator behavior.
- Owned surfaces: `src/shared`, asset builder, manifests, asset docs.
- Dependencies: none.
- Target/base: direct, safe foundation.
- Interface contract: named surfaces, entrances, district archetypes and world features have stable identifiers.
- Rollout: data types/assets available but unused.
- Verification: catalog tests, dimension/alpha/palette validation.
- Risk: sprite registration mismatch; validate every five-stage sheet pixel bounds.
- Out of scope: route planning.

### MR-2 — Publish mobility-valid districts

- Outcome: new/expanded districts publish road profiles, sidewalks, paths and reachable building entrances atomically; sealed cells are immutable.
- Owned surfaces: app service, database, spatial helpers, world audit.
- Dependencies: MR-1.
- Target/base: stacked on MR-1.
- Interface contract: every building has entrance/access; every street exposes drive/walk topology.
- Rollout: generator version `square-v6` and migration/regeneration gate.
- Verification: unit tests, growth lifecycle, zero-intrusion diff.
- Risk: routing retry explosion; bounded candidates and timing budget.
- Out of scope: animated agents.

### MR-3 — Add morphology, civic coverage and roadside service

- Outcome: districts look intentional; mature cities receive services; intercity entrances receive signs/stops/service areas.
- Owned surfaces: catalog scoring, fixtures, world-feature planner, chunk contract.
- Dependencies: MR-1, mobility primitives from MR-2 where driveway/sidewalk is required.
- Target/base: stacked on MR-2.
- Interface contract: immutable archetype and deterministic feature placement by seed.
- Rollout: public for newly generated v6 worlds.
- Verification: distribution/property tests across seeds, multi-city audit.
- Risk: semantics of auto-selected civic tasks; explicit building selections always win.
- Out of scope: economy/service simulation.

### MR-4 — Render layers and lightweight life

- Outcome: quieter district UI, correct surfaces/props and deterministic visible cars/walkers.
- Owned surfaces: `src/client`, runtime asset manifest.
- Dependencies: MR-1 and MR-2; MR-3 for roadside rendering.
- Target/base: stacked on MR-3 for final MVP.
- Interface contract: client reads additive chunk layers and degrades safely if absent.
- Rollout: local agents feature flag on by default for v6.
- Verification: Playwright interactions, screenshots, console/performance smoke.
- Risk: frame regressions; visible-chunk cap and pooling.
- Out of scope: server-authoritative traffic.

### MR-5 — Release verification and cleanup

- Outcome: fixtures, docs and migration are synchronized; obsolete curb/access assumptions removed.
- Owned surfaces: tests/scripts/docs/README and stale code.
- Dependencies: MR-2, MR-3, MR-4.
- Target/base: stacked finalization.
- Interface contract: documented v6 invariants and reproducible QA commands.
- Rollout: release-ready.
- Verification: all gates plus 100-task and 5-city evidence.
- Risk: fixture-only success; browser and seed matrix required.
- Out of scope: post-MVP traffic economy.

## Rejected splits

- Separate sidewalks from entrance routing: rejected because either half can publish inaccessible buildings.
- Separate civic assets from civic selection: acceptable only as MR-1 foundation; behavior must ship with tests.
- Separate renderer before generator: rejected because screenshots would validate synthetic data rather than production flow.

## Execution notes

- Suggested order: MR-1 → MR-2 → MR-3 → MR-4 → MR-5.
- Parallelizable work: asset drawing and additive contracts only; this execution keeps them sequential in one workspace to avoid manifest conflicts.
- Cleanup trigger: v6 growth and multi-city audits pass and the browser renders all new layers.

