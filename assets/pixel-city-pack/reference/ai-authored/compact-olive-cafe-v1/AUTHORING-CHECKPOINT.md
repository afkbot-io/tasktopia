# Olive café — source correction in progress

The original finished draft is retained as`rejected-stage-5-original.png`.
It is not approved or published: upper panes become one pixel high and the
central leaf is6×4 instead of the4×3 target. The three-floor café identity,
roof terrace and fixed48×48/6×6 envelope remain the design authority.

Stage5A source-only correction requests readable2–3×2 panes, a4×3 leaf within
a7×5 frame and5-pixel floor rhythm. No reverse stages may be generated until
the corrected finished source is normalized, measured and independently accepted.
Only existing common-frame/nearest-neighbour/palette normalization is allowed.

## Further rejected source corrections, 2026-09-07

Attempts A–F are retained as rejected source files. A–E did not resolve the
roof/front ratio, window bodies and tiny-door scale simultaneously. F used
the garden-house as geometry reference but retained a19px facade and a tall
4×6 leaf; numeric size/alpha alone was not acceptance.

Attempt G (source `d2aa4390d2b8b37db163587de86ef2f17d60e9f4711004f064ce12b306cac4a4`,
native `6d7318ea1841c07d51b278264590a72fab21fb78f2c9350e2448e08adcd417a0`)
corrected the camera too far:48×44 occupied, but only approximately11px of
facade and3px floor spacing. It remains rejected despite the numeric report's
empty errors list. The report explicitly requires separate semantic review.

G used a technical nearest-neighbour reference crop from the accepted
garden-house doorway: native rectangle[18,41,29,48], resized24× uniformly.
This reference was not stitched into or used as the output source. The original
garden-house native/source hashes remain unchanged. G/H prompts are retained.
H requests a28px roof/16px three-floor front with5px floor spacing. Geometry
and doorway/window targets have not been relaxed; no reverse stages yet.

## Accepted5I and4A supersede the rejected attempts above

5I uses the approved garden-house only as a primary geometry reference and
the cafe draft as a roof-identity reference. New roof architecture contains
an orange/cream canopy, teal table/chairs, four pots and two hedge planters.
Main and an independent reviewer accepted native48×48 and8×: occupied48×46,
roof29/facade17, floor pitch5, eight2×2panes and4×3leaf/7×5portal. Fixed frame
[142,169,1109,1092], existing MAXCOVERAGE, no repaint/stretch. Exact source
and native hashes are frozen in visual-review.json.

4A is derived only from accepted5I. Approximately44–46%leftroof remains,
right rooms have opaque floors/partitions/materials, all finished roof gear
is removed. Original entrance, lower foundation and all eight windows match.
The family-local measurement now recognizes source-derived warm charcoal
87,77,63 and74,67,56 (a copied neutral Garden classifier wrongly excluded
these true aperture pixels). Fixed ROI equality, portal dimensions and
source-frame/camera tolerances are unchanged; negative fixtures reject
missing body pixels, masonry inside openings and enlarged window edges.
Main and independent reviewer accepted4A. Stage3/runtime integration pending.
# Completed source family — 2026-09-07

This supersedes earlier unfinished-source checkpoints below. Stages5I/4A/3D3
are independently accepted at native1× and8×; no catalog/runtime publication
is claimed here. The frozen frame remains[142,169,1109,1092], footprint6×6,
native48×48, anchor24,48 and south entrance3. Roof29/front17, floorpitch5.
Stage3 occupies48×44; stages4/5 occupy48×46. All have hardalpha, at most32colors,
zero internal transparent holes and exact alpha foundation rows46/47.

Stage3 was derived in localized AI edits: approved4A→D1 removes only the left
roof; D1→D2 removes only the upper front storey; D2→D3 removes the top north
wall course. It retains14 opaque rooms(5+5+4), raised straight partitions,
material piles, partial front columns and two lower front storeys. Five2×2
warm-charcoal windows and4×3leaf/7×5portal retain the exact approved ROIs.
Source3 SHA60438bf0459eda540547df0faffe3cda555955ff751e8118a6a032039064e141;
native3 SHAda510adb36a55f93b61cdb3edc45bb8b90df8b9cf679893aa7ee5ab95b9e18e3.

The existing reserved-magenta broad key removes two source-background fringe
samples(196,19,177) at native(11,4)/(32,4), without touching architectural
materials. Independent byte comparison proves5/4 native PNGs unchanged.
Stage3 shadow colors(38,33,24),(57,44,32),(84,67,32) are independently measured
opening surfaces, not missing pixels; their exact-set classifier retains
strict rectangular ROI equality. Eight positive/negative aperture tests pass,
including damaged/enlarged openings, a missing door pixel and a returned top
window. No axis stretch, independent crop, recentering or pixel painting.

Earlier A/B/C1 and D1/D2 intermediates remain for provenance and are not final
stage3. The complete-source/review gate and fixed opening helper pass. Proposed
catalog metadata lives in catalog-entry.proposed.json; actual-map integration
is still required before a release claim.
