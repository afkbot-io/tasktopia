# Architecture

## Current boundary

`BootstrapDto` embeds every `DistrictDto` and `TaskDto`. District cells/lots and task footprints duplicate data subsequently returned by chunks. PlanDrawer filters this full in-memory world.

## Target boundary

- Bootstrap: identity, country access, city envelopes, aggregate counts, chunk size.
- Map: visible `/api/chunks/:x/:y` only.
- Plan: `/api/plan/cities`, `/api/plan/cities/:cityId/districts`, `/api/plan/districts/:districtId/tasks`.
- Task modal: existing single-task endpoint.

Plan DTOs intentionally omit geometry. Structural realtime events reload bootstrap; task status/comment events update chunks and signal scoped plan refresh.

## Alternatives considered

- Keep full bootstrap compressed: rejected because parsing and retained heap still scale with the world.
- One full `/api/plan` response: rejected because opening the plan would recreate the same all-world payload.
- Store world bounds separately: deferred; city envelopes are small and remain useful for navigation.

## Rollout/rollback

This is an atomic contract migration within the monorepo. Rollback is the prior BootstrapDto and synchronous PlanDrawer.
