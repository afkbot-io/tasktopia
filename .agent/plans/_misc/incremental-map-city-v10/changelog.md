# Changelog

## Completed

- Added persistent per-chunk Pixi rendering, overview/detail LOD, six-request concurrency and hidden/offscreen ticker pause.
- Lazy-loaded the Pixi map, reducing the production entry chunk from about 536 kB to 298 kB.
- Added bounded realtime chunk invalidation through `affectedBounds`; task status/comment events avoid a full bootstrap request.
- Split the practical one-city default generator gate from opt-in representative, ten-city and ten-seed profiles.
- Added asphalt-density and block-city verification; fixed spare-slot use before district growth.
- Verified browser behavior: one canvas persisted, same-range drag skipped reconciliation, and a comment rebuilt one of 24 resident detail chunks.
