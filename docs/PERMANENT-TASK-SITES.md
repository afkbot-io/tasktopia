# Permanent task sites and sprint transfer

Implemented locally on 2026-09-05. A district is a sprint; a block is physical placement, not a new business grouping.

## Contract

`POST /api/tasks/:taskId/transfer` accepts a strict body:

```json
{"targetDistrictId":"UUID","comment":"Optional reason, at most 4000 characters","idempotencyKey":"4–160 characters"}
```

The authenticated active country scopes both task and destination. OWNER/MEMBER may move; VIEWER cannot. Source and target must be different sprints in the same city/project. A completed or abandoned destination is rejected. Task identity, number, status/progress, authored family, visual kind and business history survive. The old placement is replaced by a permanent `RELOCATED` marker; destination placement, task ownership, marker, event and idempotency receipt commit atomically. Any allocation/write failure rolls them all back. A repeated key returns the same task's current canonical DTO rather than moving it again.

`task.transferred` invalidates CITY and both atlas levels; its affected bounds cover the previous access/footprint and new layout. The notice targets the current task. Old MOVE markers retain a direct FK to the same task, not a chain of intermediate addresses. Existing authorized task resolution supplies its current location.

MCP exposes the same operation as `task.transfer` with a strict additional required `countryId` and `tasks:write` authorization against current country membership. It never reads or changes the web-selected country. Its result adds a canonical human URL containing both country and task UUID. The real SDK tests cover required/unknown fields, write scope, viewer and foreign-country rejection, reconnect/idempotency and read-after-write.

## Durable ownership

Migration `0026_permanent_task_sites.sql` makes site history country-owned. City/layout deletion nulls only disposable layout/block links. It retains historical city/sprint IDs, an immutable versioned block snapshot, exact geometry, limited historical task fields, marker kind and variant seed. Normal deletion and history/geometry rewriting are rejected by a database trigger. Country deletion still cascades all its history for privacy; this is not retention outside the country.

Existing version-25 markers receive ownership and a frozen block snapshot during migration. They resolve against that recorded versioned template, never a replacement active block. Their next city-layout mutation or city deletion freezes exact cells in `geometry_json`; newly created markers are frozen in their creating transaction. Template versions must remain immutable. Reads never perform this backfill. Marker-bearing city rebuilds preserve their physical block/street topology; only disposable projections are rebuilt. Orphaned markers remain queryable in any intersecting country viewport and exclude their land from later city/block selection.

The public `WorldFeatureDto.siteMarker` exposes only kind, permanence, nullable current target, deterministic `brick`/`frame`/`overgrown` variant and snapshot `{taskNumber,title,buildingFamily,lastStage,recordedAt}`. It never exposes old descriptions, comments, account details, attachments or full task payloads. Deleted targets null the MOVE FK; the old historical marker remains but cannot open a deleted task.

## Infrastructure intent

The first real placement records the task's nullable service role and reservation trigger durably. Moving an airport preserves that role on the same task; its old marker is not an active airport. Already-placed ordinary tasks do not consume a pending next-task infrastructure reservation when moved. New tasks still consume those reservations under the existing thresholds. No phantom tasks, automatic sprint creation or business task reassignment is introduced.

## Geometry versus authored families

Template v2 packs only the immutable ordered structural shapes `6×6`, `6×3`, `6×4`, using its original three shape keys. Adding or reordering catalog entries cannot change this pool. A separately persisted `block.parameters.slotFamilies[slotKey]` selects the authored building. An alias must match the exact physical footprint, centred south entrance, native width and bottom-centre anchor. Unknown, mismatched or nonexistent-slot aliases fail closed; no image or site is stretched.

Explicit new-family requests map `firstFamily` to the existing structural shape key and store the actual art separately. Newly consumed FIRE reservations prefer an available compatible `6×4` parcel and use the accepted fire-family art there. If no such parcel exists, FIRE is still assigned to the next eligible task with its fitting generic family; artwork availability never postpones the business service. An already assigned FIRE family is not automatically repainted after catalog expansion. The same saved-family and footprint guarantees apply through stage changes, fresh reads, transfer and permanent-site history.

An explicit service-family image does not grant a service before its business threshold. If an available parcel is already reserved for another role, mismatching service artwork is rejected even when its geometry fits; an ordinary fitting family remains allowed.

`tests/block-art-family.test.ts` covers geometry/order independence, strict alias validation, new and preexisting services, explicit family mapping and the no-compatible-art fallback. `tests/block-art-family-runtime.test.ts` verifies the real catalog/database/service/transfer path.

## Verification and limits

- `tests/permanent-task-sites.test.ts`: repeated moves, exact footprint/identity/history, irreversible occupancy, reset, city deletion, later city exclusion, country privacy deletion, rollback injection, role preservation and next-task reservation.
- `tests/task-transfer-route.test.ts`: anonymous/viewer/malformed input, country/project boundaries, idempotency, event and canonical resolver navigation.
- `tests/mcp-task-transfer.test.ts`: explicit-country SDK contract, live role/scope authorization, canonical links and reconnect retry.
- `tests/permanent-site-migration.test.ts`: populated version-25 upgrade, service intent backfill, old exact address and deletion ownership.
- `tests/country-overview-events.test.ts` and `tests/realtime-notifications.test.ts`: transfer invalidation and canonical notice.

No production migration or deployment has been performed. Migration 26 removes the retired clearable-marker column, so a pre-26 binary is not a safe application-only rollback; use a coordinated release/forward fix, never discard newly created permanent history to downgrade. The separate 20-sprint capacity policy remains pending explicit confirmation: this feature does not allow detached physical sprint blocks or silently create another sprint to evade a blocked frontier. Intercity road integration remains separate and unwired.
