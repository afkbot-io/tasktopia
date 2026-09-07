# Server scale gate — 2026-09-07

Both real-generator workloads passed the existing service budgets on the
current local working tree, after gallery registration and migration0029.
This is server/DB evidence, not a browser frame-rate, WAN or production claim.
No production state was accessed or changed.

## Final35-family checkpoint

An existing-only repeat on the same two schemas passes after the final halo,
transit and pointer work. Both reports assert complete workloads, unchanged
source hashes during sampling and no budget failures. The subsequent CSS
source-discovery fix leaves all server bundles unchanged.

| Operation | 1 city / 20 districts / 1,000 tasks | 100 cities / 300 districts / 1,000 tasks |
| --- | ---: | ---: |
| Cold CITY, one sample |396.8ms /22SQL|75.4ms /32SQL|
| Cold COUNTRY, one sample |35.3ms /9SQL|95.0ms /9SQL|
| Task open p95 |7.20ms /2SQL|3.09ms /2SQL|
| Warm CITY p95 |1.96ms /3SQL|1.34ms /3SQL|
| Warm COUNTRY p95 |4.32ms /2SQL|9.53ms /2SQL|
| PLANET p95 |4.03ms /2SQL|9.30ms /2SQL|
| Stage update p95 |75.10ms /17SQL|18.65ms /17SQL|
| Two concurrent stage updates p95 |129.48ms /34SQL|40.58ms /34SQL|
| Cold CITY JSON / gzip |3,643,869 /511,792bytes|154,440 /17,714bytes|
| Final process RSS |341MiB|185MiB|

[The final compact report](evidence/compact-rc/final35-server-scale.json)
retains metrics, source fingerprints and hashes of the complete raw local SQL
reports. The larger CITY payload includes the corrected clipped reservation
masks; no rendering exclusion was removed to reduce bytes. The earlier results
below remain a historical checkpoint, not additional samples of this repeat.

## Workload and method

Node24 on local macOS, PostgreSQL16 on loopback port5432. Fresh dedicated
`tasktopia_test` schemas `release_perf_20260907_b` and
`release_perf_20260907_d` were generated through `AppService`, seed424242;
no hand-authored layout rows or forced road geometry. Fixtures remain locally
for browser review. Stages are predominantly planning, with two active tasks
advanced by the measurement harness.

The existing `scripts/server-scale-audit.ts` records20 sequential warm samples,
one genuinely cold materialization after clearing only this disposable
country's derived read caches, restart-from-published reads, eight concurrent
task opens and two concurrent stage commands. It runs `ANALYZE`, then read-only
`EXPLAIN (ANALYZE, BUFFERS)` for the12 slowest observed SELECT shapes. Core
server/layout/planner source SHA256s are identical before/after each run.
Complete city, district and task counts are now a hard harness gate.

## Results

| Operation | 1 city / 20 districts / 1,000 tasks | 100 cities / 300 districts / 1,000 tasks |
| --- | ---: | ---: |
| Cold CITY, one sample | 401.9ms / 22 SQL | 69.5ms / 32 SQL |
| Cold COUNTRY, one sample | 42.2ms / 9 SQL | 98.9ms / 9 SQL |
| Task open p95 | 8.0ms / 2 SQL | 3.4ms / 2 SQL |
| Warm CITY p95 | 2.7ms / 3 SQL | 2.4ms / 3 SQL |
| Warm COUNTRY p95 | 5.6ms / 2 SQL | 14.2ms / 2 SQL |
| PLANET p95 | 5.4ms / 2 SQL | 11.9ms / 2 SQL |
| Stage update p95 | 75.8ms / 17 SQL | 27.0ms / 17 SQL |
| Two concurrent stage updates p95 | 146.7ms / 34 SQL | 49.6ms / 34 SQL |
| Cold CITY JSON / gzip | 3,428,386 / 475,900 bytes | 143,650 / 16,015 bytes |
| COUNTRY JSON / gzip | 20,645 / 4,570 bytes | 159,480 / 30,570 bytes |
| Process RSS at final sample | 416MiB | 328MiB |

SQL counts describe this service seam, not an HTTP authentication middleware
or query count observed by the browser. Summed SQL durations may exceed wall
time when independent reads run concurrently. Cold values are not p95. RSS is
not peak memory and does not include a browser/GPU.

Fresh generation took129.9s for the20-district city and186.0s for the100-city
country. Those are1,000 sequential business task mutations plus setup, not
opening an existing world; they are not advertised as an instantaneous bulk
regeneration. Stage changes do not rerun country route planning.

## Geometry and query evidence

Read-only whole-world audits passed with zero violations on both fixtures:

- Large city:100 blocks,19 persisted district separators,20 occupied gallery
  sites. Audit113.8ms.
- Large country:300 blocks,200 separators,101 gallery sites,92 accepted
  intercity roads,8 actual road components and37 explicit planner failures.
  Audit545.6ms. This is **not** a claim that all100 cities are connected over
  land; unavailable routes are retained as explicit bounded-search outcomes.

The task detail uses the task primary-key index and task-local history/document
indexes where cardinality warrants them. Sequential scans of single-row or
empty tables in this isolated fixture are valid planner choices, not evidence
that a new index is needed. The1,000-task CITY materialization legitimately
reads all1,000 placements once; warm reads do not repeat that scan. No new DB
index or renderer optimization was invented to improve already-passing numbers.
The separate10,001-comment locality regression remains a required full-suite
gate; these scale fixtures do not benchmark one task with huge attachments.

## Reproduction and retained evidence

Run serially with the supported Node24 runtime on PATH:

```sh
TEST_DATABASE_URL=postgres://tasktopia:tasktopia@127.0.0.1:5432/tasktopia_test PERF_TIER=b PERF_SCHEMA=release_perf_20260907_b PERF_OUTPUT=tmp/server-scale-20260907-b.json node --import tsx scripts/server-scale-audit.ts
TEST_DATABASE_URL=postgres://tasktopia:tasktopia@127.0.0.1:5432/tasktopia_test PERF_TIER=d PERF_SCHEMA=release_perf_20260907_d PERF_OUTPUT=tmp/server-scale-20260907-d.json node --import tsx scripts/server-scale-audit.ts
```

The script reuses only its explicit local performance schemas. An existing-only
repeat can set `PERF_EXISTING_ONLY=1`; it still updates disposable fixture task
progress and clears only its derived caches. Never point it at production.

Full measured values, source fingerprints, budgets and SQL plans are retained
under `docs/evidence/server-scale-20260907/`. Integrated browser screenshots,
first-frame timing, smooth input, memory across level changes, final artwork,
PWA/device acceptance and the current cutover/rollback rehearsal remain
separate gates. This document does not mark the release complete.
