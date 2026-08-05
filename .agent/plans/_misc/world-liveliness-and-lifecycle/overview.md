# Goal

Remove the artificial district SP gate and ship a safer, more legible and more varied living world, including MCP lifecycle tools for deleting cities, districts and tasks.

# Scope

- Keep `capacitySp` as an informational planning target, never as a write blocker.
- Add explicit MCP delete tools with ownership checks, confirmation and idempotency.
- Preserve database/world-index consistency when entities are deleted.
- Improve district variation, active-district legibility, road/crosswalk/shore correctness, pedestrian connectivity and sparse environmental life.
- Add fishing boats, shore fishers, fish-water variants and varied residents/actions to the v4 asset pipeline.
- Move building stage badges to a lower corner and expose concise hover context.
- Update tests, AI/MCP docs, asset provenance, QA and release notes; deploy with resource checks for both hosted projects.

# Non-goals

- No unbounded first-load payload or whole-world prerender.
- No replacement of the chunk protocol, renderer or PostgreSQL.
- No automatic sprint sizing: teams decide what workload is healthy.

# Acceptance criteria

- A task can be created after a district exceeds its planning target; the response exposes workload rather than an error.
- `city.delete`, `district.delete` and `task.delete` are discoverable and require an exact-name/title confirmation plus an idempotency key.
- Cascading deletes leave no task, feature or chunk-index orphan and invalidate affected chunks.
- Active districts are immediately recognizable in detail view.
- District layouts are deterministic but visibly varied; fences are optional and access paths remain connected.
- Crosswalks exist only on valid road crossings; roads and props do not terminate incorrectly in water.
- Sparse boats/fishers/fish-water/lights/resident variants appear near appropriate terrain without increasing first-load chunk count.
- Building badges render in a lower corner and hover shows title/status/description.
- Focused tests, full test suite, asset audit, production smoke and resource checks pass.

# Current status

Implementation and local release verification complete. Independent reviews were resolved: feature ownership/cascades, full prop footprints, active-district affected bounds, conservative city-road cleanup and compact chunk task previews are covered. Production backup/deploy and dual-project health checks remain.

# Risks

- City roads are country-owned and require conservative cleanup so shared roads are not removed.
- More visual entities can regress frame time; new life must be sparse and chunk-local.
- Existing clients still send `capacitySp`; compatibility must be retained.

# Finish checklist

- [x] Implementation complete
- [x] Review findings resolved
- [x] Tests and asset audit pass
- [x] Docs/changelog/QA updated
- [ ] Backup, production deploy and dual-project resource check complete
