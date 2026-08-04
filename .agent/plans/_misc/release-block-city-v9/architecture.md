# Architecture

## Why the old generator fails

The old district generator draws a full-width main road plus one or two full-height branches before it knows which buildings will arrive. A generic rectangle packer then fills the remaining fragments. Roads therefore dominate the map, building fronts are unrelated, and every expansion adds another spine.

## New planning unit: BlockGroup

`BlockGroup` is an immutable planned arrangement inside a district:

```ts
type BlockPattern =
  | "DENSE_SUPERBLOCK_3X3"
  | "DENSE_ROW"
  | "PRIVATE_STREET_ROW"
  | "PRIVATE_TWO_SIDED"
  | "PRIVATE_MEWS"
  | "COMMERCIAL_STRIP"
  | "CIVIC_CLUSTER";

type LotRole = "PRIMARY" | "SUPPORT";
```

Each stored planned lot receives optional additive metadata:

- `groupId`, `pattern`, `slotIndex`, `slotCount`;
- `role`, `frontageSide`, `facadeFamily`;
- `alignmentX`, `alignmentY`;
- `sharedAccess` and `layoutVersion: "block-v2"`.

No new relational table is needed in V9: districts already store lots as JSON and old rows deserialize without the optional fields.

## Pure block planner

`src/server/world/block-planner.ts` is a deterministic, database-free module. Input:

- district rectangle/cells;
- archetype and capacity;
- seed;
- the catalog footprint families.

Output:

- frontage street centerline(s);
- reserved block slots with metadata;
- pedestrian shared-access corridors;
- layout metrics.

The service validates terrain, existing roads/districts, and publishes the accepted plan atomically.

## Dense superblock

- One local frontage street along a long block edge.
- Three residential rows of three compatible slots.
- Slots in a row touch or leave at most one cell only when the sprite footprint requires it.
- Rows are separated by a one-cell pedestrian corridor/shared courtyard, not asphalt.
- Entrances prefer the shared corridor/frontage direction; placement aligns to the slot baseline instead of centering.
- A separate support strip next to the collector is available for a shop or city service.

## Private housing

- One short street can serve two coherent rows.
- Mews use a brown pedestrian spine with service access at the perimeter.
- House slots share setbacks and facade family; gaps come from a deterministic template, not per-house randomness.

## Automatic filling

1. Select the task's zoning role and building family.
2. Find compatible free slots in existing groups.
3. Prefer a group that already contains the same primary category and the next sequential slot.
4. Prefer exact footprint fit, then baseline continuity, then shortest access.
5. Replan only uncommitted slots inside the same group if the selected catalog footprint needs a compatible reserved size.
6. If no group has capacity, append one complete group.
7. Add a street only if that new group has no serviceable frontage.

Task creation stays deterministic and idempotent.

## Growth

Growth reserves an entire group-sized patch in the district's outward direction. It validates the complete proposed block, access, terrain, and collision constraints before writing any road or district cells. Completed districts remain sealed.

## Release UI and auth

Auth states are explicit:

`INITIALIZING → ANONYMOUS → AUTHENTICATING → LOADING_COUNTRY → AUTHENTICATED`

Failures enter a recoverable error state with a retry action. Registration and login do not report raw HTTP statuses. The visual direction is a restrained night municipal atlas: pixel-grid details, dark ink, warm civic gold, and cyan map accents. Public copy describes the released product, not its development phase.

