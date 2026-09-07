# Compact world: production cutover plan

Status: preparation, not deployment authorization. Do not execute this plan
against production until the exact revision and environment have an approved
release receipt. The working checkout is not itself an immutable release.

Current acceptance state: [completion ledger](RELEASE-COMPLETION-2026-09-07.md).
The [September6 RC matrix](COMPACT-RC-2026-09-06.md) and its
[fingerprints](evidence/compact-rc/release-fingerprints.json) are historical,
not hashes of the35-family candidate. Record fresh source, built entrypoint,
published asset and migration hashes after final verification; replace the
dirty-worktree identity with the reviewed immutable commit/image before release.

The fresh [final35 fingerprint passport](evidence/compact-rc/release-fingerprints-final35-20260907.json)
and [local acceptance summary](COMPACT-RC-FINAL-2026-09-07.md) now record that
verification. Any further source, dependency, migration or art change invalidates
the corresponding evidence and needs a new candidate.

The latest locally built image is `tasktopia:compact-local-final35-r4-20260907`
(`sha256:03537a60affa4ab51964a6d95cdaa0e5c28ef71ad32a21e8c7dd4cedfadb351f`,
linux/arm64). Its601built files match the tested host output byte-for-byte;
the511-file revision materialization also matches. See
[the isolated image audit](evidence/compact-rc/final35-r4-image-static-audit.json).
This is not an approved registry digest for an unidentified destination.
Confirm the target architecture; an amd64 rebuild needs its own verified image.

## 1. Freeze the candidate

Record the full reviewed Git revision, image digest, assetRevision from the
runtime manifest, SHA256 of each built CLI/client artifact, and SHA256 of every
migration. The candidate includes migrations0023–0029, the35-family/175-stage
catalog at asset revision `750f26edc463160e`, seven structural shapes,
V7trees and CITY4/COUNTRY7/PLANET4 contracts. Existing templateV2 plans remain
readable and unchanged during ordinary growth. No dependency,
generated image, catalog or migration edits after verification without rerunning
the affected gates. Archive source prompts, geometry reports and visual reviews.

Required fresh local gates: types, lint, full tests, compact authoring audit,
asset build/audit, production build, actual20sprint/1,000task browser evidence,
the100-city/300-district workload and the48-case building/park-stage fixture,
CITY/COUNTRY/PLANET and mobile screenshots, task/link/site interactions,
PWA/update and notification behavior, traffic/flight regression, and a successful
backup→migration→regeneration→restore rehearsal. Local timings do not establish
production capacity: repeat the workload with production-sized copied data and
the target memory/CPU/connection limits. Unexecuted gates remain release blockers.

## 2. Identify and back up the destination

The operator records the actual host/project, database name and schema, current
image/static release, PostgreSQL version, country count and migration checksums.
Never infer the destination from a default DATABASE_URL. Do not print secrets.
Verify storage for the full backup, extracted static release and rollback copy.
Keep the current VAPID keys; this change does not authorize key rotation.

Enable maintenance for HTTP writes and map traffic. Stop old app/MCP/world
workers and scheduled mutation sources; an idle web page is not a write freeze.
Drain or record outstanding durable jobs/leases. Take a complete database backup
with matching PostgreSQL tools, plus operator-owned upload/config backup.
Store its checksum and revision association. Restore it into an isolated target
and verify the restore before touching the live schema.

Capture durable baselines: country/city/district/task IDs, task numbers, titles,
descriptions, estimates, statuses, progress, dependencies, comments, event
history, documents, checklists, defects, permanent MOVE/RUIN sites and their
target/snapshot data. Include command receipts and job identities. Compare
sorted row hashes as well as counts; equal counts alone cannot prove retention.

## 3. Install the exact artifacts in maintenance

Use the approved image digest for all app/MCP/world roles. Prepare the matching
static directory without opening traffic. Preserve the previous static release
for rollback. The ordinary updater deliberately rejects first compact cutover
while0023/0024/0029are pending or reader/snapshot/geometry checks fail; do not
add a bypass flag or run the old image against the new schema. An old image
must contain every candidate structural shape and building-stage geometry
before image-only rollback could be safe. Follow the maintenance boundary in
[DEPLOYMENT](DEPLOYMENT.md). This RC always requires FORCE=1, including when
preflight passes: earlier cached decoration masks cannot identify themselves.

Before enabling static traffic, run the candidate's built
`node dist/synchronize-assets.mjs` against its identified writable revision
directory. The image ships root public assets; this command atomically creates
the content-addressed revision used by browser URLs. The existing updater
already performs this step. Check every manifest stage path under that revision;
the presence of root PNGs alone is not sufficient. The isolated local image
audit exercised the real command without a database or application startup.

Run one release-wide regeneration process in the new world image. Set a recorded
REGENERATION_RUN_ID and REGENERATION_FORCE=1. The built entrypoint is:

```text
npm run worlds:regenerate
```

Supply the identified database via the approved environment, not a copied
credential in shell history. The CLI takes a release-wide PostgreSQL advisory
lock BEFORE opening its migrating application pool. It applies pending checked
migrations and processes countries serially, with each replacement audited
before commit. Budget DATABASE_POOL_MAX=4 for the world worker plus one pinned
lock connection, alongside the other role pools. Default retry count is3;
retry only the identified interrupted run, never two simultaneous batches.

Require exit0, one successful/preserved result per expected country as appropriate
to the chosen force mode, zero world violations and the final
world-regeneration.finished event. FORCE=1 intentionally regenerates even clean
worlds. A partially successful multi-country batch is NOT permission to reopen.

## 4. Verify before reopening

Run the built, non-mutating audit in the same new image:

```text
npm run worlds:audit
```

It disables automatic migrations, reads a repeatable-read read-only snapshot,
emits country-scoped JSON and exits nonzero for any violation. It never repairs
the world. Compare durable baseline hashes; normalize only explicitly documented
new defaults, never task content/history. Old spatial placement may change;
task identities and permanent history must survive. No manual DELETE of task,
receipt, marker or event tables is part of this procedure.

Verify app/MCP/world health separately; static assetRevision and content hashes
must match the new client. In a browser check cold CITY load, resident pan without
chunk requests, COUNTRY/PLANET transitions and terrain continuity, all48selected
building/park-stage cases (including horizontal/vertical/L/U buildings), small
trees and clear sidewalks, a20sprintcity, task deep links,
MOVE navigation and RUIN history, staged parks, service reservations and completed
airport routes. Check desktop/mobile overflow and a real PWA upgrade/reopen.
Test one authorized notification target; notification permission denial or absent
optional push keys must not break normal work. Record network/console errors and
latency, not only screenshots.

Only after all checks pass: activate the matching static release atomically,
start the new roles together, run health/command-job smoke checks, then reopen
traffic. Observe task creation, job backlog, error rates, DB connections, memory,
scene payload/latency and asset404s against declared budgets.

## 5. Stop and rollback criteria

Keep maintenance enabled on any lost/changed durable row, orphaned placement,
invalid world, migration checksum mismatch, missing asset, wrong task hit target,
failed PWA upgrade, stalled generation queue, unhealthy role or exceeded capacity
budget. Do not hide a violation with cache deletion or a successful shell exit.

Stop all candidate writers. Restore the verified pre-cutover database AND its
matching previous image/static release together. Restore operator-owned uploads
only if changed and covered by the backup procedure. Verify baseline hashes and
health before reopening. An old binary alone is unsafe after compact migrations
or new building/service keys. Record failed countries, logs, exact candidate
digest and rollback evidence; investigate on an isolated copy before retrying.

## Local rehearsal evidence

`scripts/rehearse-compact-cutover.ts` is intentionally loopback-only and creates
three uniquely named disposable databases. It cannot serve as a production
restore command. Reports and synthetic dumps are placed in a distinct
`docs/evidence/compact-rc/cutover-<id>/` directory, so a later run does not overwrite
earlier evidence. A synthetic rehearsal complements, not replaces, a restore
test of the actual production backup and its permanent site history.
