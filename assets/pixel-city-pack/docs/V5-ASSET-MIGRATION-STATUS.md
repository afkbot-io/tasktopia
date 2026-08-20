# Tasktopia V5 asset migration status

Updated: 2026-08-20

This file is the release checklist for the frontal-top V5 building pack. The
active catalog is authoritative; removed private-house studies are not runtime
families and do not count as pending migration work.

## Current inventory

| Scope | Active families | Geometry studies | Pack-audit verified | Remaining |
| --- | ---: | ---: | ---: | ---: |
| All buildings | 167 | 167 | 167 | 0 |
| Residential and high-rise landmarks | 60 | 60 | 60 | 0 |
| Low-rise residential | 10 | 10 | 10 | 0 |
| Mid-rise residential | 16 | 16 | 16 | 0 |
| High-rise residential + office landmarks | 34 | 34 | 34 | 0 |

The former 36 detached/private HOUSE families are absent from the catalog,
runtime pack and public pack. The stable district code `PRIVATE` remains for API
and stored-data compatibility, but now selects low- and mid-rise apartment
buildings. `NEW_BUILD` selects mid- and high-rise apartment buildings.

## New low-rise batch

The replacement batch contains ten independent 5→4→3 families:

- `house-lowrise-courtyard-brick`;
- `house-lowrise-courtyard-plaster`;
- `house-lowrise-gallery`;
- `house-lowrise-terrace`;
- `house-lowrise-corner`;
- `house-lowrise-stepped`;
- `house-lowrise-green-roof`;
- `house-lowrise-loft`;
- `house-lowrise-arcade`;
- `house-lowrise-modular`.

Each family has immutable stage hashes, a `geometry.json`, a semantic
`projection-review.json`, full-size double-door geometry and a continuous
`STONE` platform. The accepted dominant roof planes are visible in the
frontally aligned top view; side faces remain within the narrow accent limit.

## Release gates

1. `npm run assets:build` produces exactly 167 building families and 835 stages.
2. `npm run assets:verify` reports no missing, orphaned, palette, alpha, anchor,
   footprint or projection failures.
3. Strict building-stage verifier reports for all ten new families have
   `acceptedByCode: true` and no errors.
4. The 100-task megacity starts from twenty compact base districts and adds
   continuation districts when a block is full. It contains every one of the 26
   low- and mid-rise HOUSE families plus all 32 ordinary residential high-rises. The two
   unique office towers remain separately verified landmarks. The city has no
   blocking facade/road overlaps or audit violations.
5. Production world regeneration replaces every stored removed building key
   while preserving task identity and history.

Generation constraints are defined in
`catalog/residential-generation-mask.json`; visual authoring rules remain in
`GENERATION-SPEC.md` and the Tasktopia building generator/verifier skills.
