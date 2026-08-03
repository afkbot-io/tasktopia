# Problems found and disposition

## Resolved

1. A `NEW_BUILD` district could reach 40% support/service buildings: three optional services plus one required city service. The optional support quota is now two, leaving at least 70% dense residential buildings in a ten-task district.
2. The first zoning audit threshold incorrectly applied to civic districts and transient one-task districts. The gate now targets mature residential districts only: `NEW_BUILD ≥ 70%`, `PRIVATE ≥ 60%`; hard incompatibility is still immediate.
3. Zoning validation looked up shares by district name, so duplicate names in different cities could collide. Internal validation now uses the immutable district ID.
4. Asset verification did not detect empty/duplicate stages, bad anchors, palette drift, vehicle-mask drift or manifest/runtime file drift. `assets:verify` now checks the complete runtime pack and runs in CI.
5. Scale generation had measurements but no failure budgets. The smoke test now enforces generation, chunk and RSS ceilings.

## Accepted, non-blocking

- The 10-city batch takes 42.815 seconds. It passes the 60-second offline/fixture budget, but large country seeding should remain asynchronous if exposed to users.
- Vite reports a 531 kB minified client chunk. This task did not change client loading architecture; code splitting remains separate work.
