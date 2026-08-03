# Residential block and courtyard patterns

## System rule

Every residential district receives an immutable `primaryHousingArchetype` plus one selected `BlockGroup.pattern`. Residential tasks must match the primary type. Shops and civic services are a separate support layer with explicit quotas; they never make a PRIVATE district dense or a NEW_BUILD district private.

`MIXED_URBAN` is not permission for randomness. It selects a primary residential subtype and then applies a larger support quota.

## Private patterns

### `PRIVATE_TERRACE`

- 3–8 attached houses with party-wall contact and one street baseline.
- Individual entrances open to one continuous pedestrian frontage.
- Small controlled material/color variation inside one facade family.

### `PRIVATE_STREET_ROW`

- 4–10 detached or paired houses on one side of a local street.
- Deterministic 1–3-cell gaps and mostly consistent setbacks.
- Sidewalk is continuous; short private paths connect entrances.

### `PRIVATE_TWO_SIDED`

- Two coherent rows along a short local street.
- Same architecture family on both sides with a non-identical color sequence.
- Crosswalk/connection at the mouth where it meets a collector.

### `PRIVATE_MEWS`

- 3–8 compact houses along a brown pedestrian/shared-surface path without a normal road in front.
- Cars do not circulate through the pedestrian spine; service access lies at the edge or on a short controlled shared entry.
- Benches, lamps, trees, planters, bins, and textured paving reinforce pedestrian priority.

### `PRIVATE_CULDESAC`

- 5–12 houses around a short dead-end local road.
- The end receives a turn head/turning square; no narrow line that traps service vehicles.
- A pedestrian shortcut connects the end to another path or park where terrain allows.

### `PRIVATE_GREEN_CLUSTER`

- 4–8 houses around a shared lawn, playground, grove, or pocket park.
- Entrances face the common space; vehicle and emergency access remain at the outer edge.
- Lamps, benches and play equipment decorate the center without blocking paths.

### `PRIVATE_VILLAGE_CLUSTER`

- 4–9 houses form a deliberately irregular group around a path junction or tiny square.
- Irregularity is selected from tested templates, not random per-house coordinates.
- Every entrance joins the common pedestrian graph.

### `PRIVATE_EDGE_ROW`

- Houses face a park, forest edge, lake, or river promenade.
- Public fronts face the landscape; service access uses a side/rear path within the configured distance.

## New-build patterns

### `DENSE_LINEAR`

- 3–5 sections form one continuous street wall with 0–1-cell gaps.
- Sections share baseline, front sidewalk, platform material, and facade family.
- The result reads as one residential complex, not five unrelated towers.

### `DENSE_PERIMETER`

- 3–4 wings occupy block edges, face surrounding streets, and enclose a private/shared interior.
- Entrances are outside; courtyard contains paths, trees, benches, play area, and controlled gates.

### `DENSE_COURTYARD_U`

- Three wings enclose a U-shaped courtyard.
- The open side faces a street, park, or water; all wings share one construction family.

### `DENSE_PODIUM_CLUSTER`

- 2–4 high-rise volumes stand on one common platform/podium.
- Shared plaza/courtyard and a service entrance from a secondary street.
- Touching volumes are modeled as sections; independent towers retain real open space.

### `DENSE_TOWER_AND_LINEAR`

- One tower plus one or two lower linear wings that form the street edge.
- A tower is never placed alone in leftover grass.

### `DENSE_MIXED_USE_FRONT`

- Residential block/tower with shop modules on the first floor.
- Shopfronts face the public street; the residential courtyard remains behind/inside.
- Uses `highrise-mixed-use-market` after sprite normalization.

### `DENSE_GREEN_CAMPUS`

- 3–6 separate blocks around a large shared landscape space.
- More spacing is allowed, but pedestrian/road hierarchy and aligned entrances remain explicit.

## Support layer and type purity

- PRIVATE: zero `DENSE_RESIDENTIAL` tasks.
- NEW_BUILD: zero `PRIVATE_RESIDENTIAL` tasks.
- Default residential share: at least 80% of non-unique slots; support quota is configured separately.
- Basic shop quota is based on block count/frontage, not a random category roll.
- Police/fire/clinic coverage is calculated per city and placed on collector-accessible support lots.
- `house-modern-lowrise` receives an explicit zoning tag; it may not be classified through a missing tag side effect.

## Service and topology invariants

- Every entrance reaches the public pedestrian graph.
- Every block group has a `serviceAccessCell` within a configured cell distance.
- Long dead ends include a turn head.
- Large districts have two independent connections or one normal plus one emergency/service connection.
- Path-only mews are valid only when service access runs along the edge within range.
- Grid cells are not presented as real-world metres; these are topology and readability rules.

## Generator metrics

- isolated residential buildings;
- average and maximum frontage-group length;
- groups containing only one building;
- primary/support role ratio;
- private/dense zoning violations;
- dead ends without turn heads;
- maximum entrance-to-pedestrian distance;
- maximum footprint-to-service-access distance;
- path-only mews without edge service access.
