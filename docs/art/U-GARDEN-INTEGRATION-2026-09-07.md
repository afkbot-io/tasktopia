# U-courtyard and roof-garden homes — local integration

Both families have independently approved AI sources for stages5→4→3, fixed
source registration, geometry contracts, measured openings and exact source /
runtime hashes in their respective authoring directories. They are now in the
normal catalog and runtime atlas, not a parallel preview-only renderer.

- `compact-u-courtyard-v1`:96×64 native /12×8 cells, two compressed floors,
  south entrance6. The U-shaped mass encloses an opaque attached court; the
  entire rectangular96-cell parcel stays occupied throughout construction.
- `compact-garden-house-v1`:48×48 native /6×6 cells, three compressed floors,
  south entrance3. It aliases the immutable apartment envelope. Roof planting
  and terrace furniture belong to the finished stage only.
- The old V2 three-shape vocabulary is unchanged. V3 can choose the new12×8
  physical envelope; existing persisted placements are not rescaled/repacked.
- Common source framing, palette and full reverse-stage checks are enforced
  by the existing publisher. Stage3 U lower windows have a disclosed1px shift;
  exact pixel identity is not claimed. Door/foundation registration is stable.

## Fresh evidence

Six new tests in `tests/compact-u-garden.test.ts` failed before registration.
After publishing,76tests across U/garden, corner-court, home-variety and
art-catalog suites pass. Four-corner/all-fitting-template packing tests check
non-overlapping construction reservations and connected protected entrances.
Stage3→4→5 preserves the block/placement; stage1 empty site and stage2 full
96-cell site/crane/hut/bricks retain the same fence and gate cells5–6.

Asset build and all asset/style/surface/ambient audits pass. Current batch:
28families /140stage PNGs, asset revision `b447c524028d99be`.
Logs: `tmp/u-garden-{red,focused,assets-build,assets-verify}-20260907.log`.
The first failed build attempt had not registered the new families and was
caught by the tests; it is not reported as passing evidence.

Actual developed-stage city screenshots and final all-feature verification are
still required after the remaining art/decor batch. No production changes.
