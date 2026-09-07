# Country regeneration: history and transaction boundary

Fresh local Node 24 verification on 2026-09-07. This is a service/database
regression gate, not the release-bundle dump/restore rehearsal or production
acceptance.

`tests/intercity-regeneration-history.test.ts` uses two real generated cities
on seed 1, one accepted dry intercity route, two sprint groups, a transferred
task with a comment and a deleted task. All setup uses normal service commands;
only a deliberately injected database error replaces final road publication.

Both tests passed (2.18 s including runner/import; 1.85 s test work), and scoped
ESLint passed:

- A full country rebuild retains task identities, numbers, ownership, content,
  status, comments, events, documents, checklists and defects. MOVE/RUIN
  features retain exact origins, footprints, snapshots and target links.
- CITY serves the rebuilt canonical incident routes; COUNTRY either projects
  the same route ID or records an explicit unavailable projection. The world
  geometry audit reports no violations. No all-cities-connectivity claim is
  inferred from this check.
- Replaying the same regeneration command does not change layouts or road
  snapshots a second time.
- An exception at final `country_road_snapshots_v1` publication rolls back
  every rebuilt city, the deleted old road snapshot, durable task history,
  permanent markers and event log. The restored world audit stays clean.

Executed with the explicit loopback `tasktopia_test` database and generated
isolated test schemas. No application code was changed for this test and no
production database or external notification was touched.
