# Long gallery runtime integration

Local working-tree integration, not a production deployment or final map
acceptance. The independently approved source family is
`reference/ai-authored/compact-long-gallery-v1` under the pixel-city pack.
Its geometry and visual-review records remain owned by the art pass.

## Registered contract

- `HOUSE` / `RARE` / `STANDARD`, no service role or quota, estimates3/6,
  explicit `STONE` platform.
- Physical12×6 cells, native96×48, bottom-centre48,48, south entrance offset6,
  two low facade floors. No X/Y stretch, rotated alias or old large sprite.
- Approved authored3/4/5 PNGs are copied unchanged. Stages1/2 are native-size
  catalog thumbnails of the existing kit; the real map composes the full72-cell
  foundation and separate one-cell fence/gate/envelope.

The shape was appended to `COMPACT_BUILDING_SHAPES`. The existing generic V3
rectangle planner already fits it into 24/32-cell-wide blocks; 16-cell-wide
blocks cannot fit its footprint plus clearance and access. Every fitting
template and all four packing corners have a connected south access path and
disjoint site envelopes. The first default shape remains6×6; later new parcels
can include the gallery. `RARE` is catalog metadata, not a new probabilistic
weighting or infrastructure policy.

`STRUCTURAL_BUILDING_FAMILIES_V2` was not changed. Old V2 slot/entrance
coordinates and persisted V3 `sitePlan` parcels remain authoritative; adding
the family never repacks an existing block. An explicit gallery request creates
a fitting new block if its district has no compatible free parcel. Stages3→4→5
preserve that parcel, footprint, anchor and entrance.

## Fresh verification

- Dedicated public regression: initial9RED/1PASS; final10/10PASS. Checks actual
  catalog/manifest mapping, all fitting templates and corners, non-rotated
  footprints, deterministic default planning, exact old V2 coordinates,
  preserved stored V3 plan during growth and stage transitions.
- Eight focused suites:118/118PASS, including catalog provenance, rectangular
  packing, construction, authored aliases, home diversity and reservations.
  Existing tests were corrected only where a particular seed assumed the old
  three-shape vocabulary. Mandatory reservation identity/role and true
  residential balance remain asserted; generic service fallback is not a home.
- `npm run assets:build` then `npm run assets:verify`: both exit0, serially.
  Local asset revision `df589d2d3400132e`,24 building families,103 props; no
  retired asset paths were removed. All69 normalized3–5 PNGs in the23 previous
  families retained their pre-build SHA256 values.
- Whole TypeScript check and scoped ESLint pass under Node24. No app build,
  database mutation or browser workload was performed by this slice.

The accepted native gallery hashes are:

| Stage | SHA256 |
| --- | --- |
| 3 | `6eb74e25e2fd8bb79430676ba49244188f6f688681ad0385c917d57267173b7e` |
| 4 | `f51d320ae26a5964f5fe48b7255c471d59da1c5ab3bdca78dd585fcd047e1fc1` |
| 5 | `98f6233bee2f1cdc466d5123fb2fff82e220ce044ecae64a749ba045bfc33d72` |

Real-city neighbor/road/tree clearance, click targets and complete visual
progression remain in the parent-controlled browser/map acceptance gate. The
native and8× individual images were inspected here; passing their provenance
or geometry tests is not a substitute for the final world view.
