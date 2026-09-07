# Task-owned public spaces

Updated2026-09-06 for directional block infill; not a production release.

`src/shared/task-park-catalog.ts` is the canonical15-variant enum and label map.
Seven additions are pocket/large park, fountain plaza, monument plaza, memorial
garden, orchard and promenade. The six older park themes and lake/parking remain
valid task types. These are `visualKind: PARK` tasks, not automatically generated
work or free finished world decorations.

## Occupancy and identity

Small variants prefer existing residual PARK parcels (typically6×3..6×5). If
none remain, an unoccupied6×3/4/6 BUILDING parcel without a service reservation
can become PARK by a persisted `slotKinds` override. Geometry, entrance and other
parcels do not change. A large park requires at least17×17 cells; `park-grand`
adds one such parcel in a24×24-cell block. New template-v3 blocks persist the
complete `sitePlan`, including infill parcels; `infill`/`packingCorner` are
creation hints, not instructions to repack a stored plan. Existing version2
records retain their column geometry. Residual ground strips can be1cell wide/high and are
assigned `urban-park`, with no oversized centerpiece or external clearance.
No slot can overwrite a task, MOVE, ruins or a mandatory service.

Automatic variants are chosen once from seed, task number and compatible size,
then stored in `tasks_v3.visual_asset_key`. Stage updates, reloads and catalogue
expansion do not reroll them. Explicit variants survive sprint transfer.
Migration27 extends the registered-key database check; it does not reset
geometry and reuses the existing visual-kind index. Do not run old code against
new slot/template keys; coordinated deployment and a verified backup are needed.

## Rendering and construction

Ground/path materials stay the accepted procedural atlas. A finished plan is
derived once per layout evaluation, with at most36 props. Task parks now use
THREE visual phases, selected by `publicSpaceRenderStage` without changing
the five workflow/status stages or ordinary building art:

1. Workflow1–2: earth/preparation, work boundary INSIDE the parcel.
2. Workflow3–4: planting and unfinished fixed-footprint centerpieces (art3).
3. Workflow5: finished fountain/monument and garden (art5), no work border.

Stage0 remains an unassigned reservation, not completed landscaping. Task parks
no longer load or draw the house crane/fence kit. Narrow1/2-cell strips transition
from earth through partial planting to meadow and keep an entrance where possible;
props and badges that cannot fit are omitted, with the task still clickable.
Pedestrian construction exclusion matches the parcel, not an extra one-cell ring.

The two authored centerpieces have16×16 native canvases,2×2-cell footprints,
bottom-center anchors8,16 and≤20RGBA colors. Each uses three separate AI sources
in5→4→3 order and one fixed stage5 normalization frame. The fountain is dry at3/4;
the monument starts with its partly assembled pedestal. Source art4 remains in
the authored set; task workflow4 now deliberately renders the middle visual phase
(art3). Building-specific roofs,
rooms, windows and doors do not apply to these open public-space objects.

Sources, prompts, geometry, hashes and visual reviews live in
`assets/pixel-city-pack/reference/ai-authored/compact-park-{fountain,monument}-v1`.
`scripts/compact_park_contract.py` verifies the sources then publishes the exact
normalized bytes; it never paints architecture. `assets:build` and
`assets:verify` remain serial gates. The world uses one prop atlas and the normal
city scene request, not a request for every park.

## Placement and review

Plan centerpieces and furniture before planting; reserve their final positions
at all stages. Do not shift trees to make room for a late fountain. Use exact
footprint membership, reject overlapping props and leave the south entrance and
promenades free.6×3..6×6 pockets use a south walk and axial entrance path; a full
perimeter-plus-cross would consume the usable planting space. Larger parks use
perimeters, promenades or loops and distinct combinations, not palette swaps.
Lake furniture stays on the shore and away from the entrance.

Lighting reserves positions before vegetation: up to2fixtures at24+cells,
4at60+ and8at160+, with3-cell minimum Manhattan separation. Exact parcel
membership, furniture occupancy and paths remain authoritative, so constrained
sites can omit fixtures. Lamps reveal from art stage4; task workflow3–4 uses
art3 as above, therefore task-park lamps appear in its finished visual phase.

Review actual CITY stages, roof/park task clicks and COUNTRY/PLANET ownership.
Numeric alpha/hash/mask tests do not prove artistic cohesion. Trees now use
the16×16V7family and conservative projected crown clearance, including task
parks: reserve centerpieces and paths before any tree cover. See
`COMPACT-TREE-ART-CONTRACT.md` and actual2026-09-06park screenshots in
`screenshots/compact-rc-trees/`. Narrow pockets may omit trees when crowns
cannot fit without covering the path or a neighboring building.
