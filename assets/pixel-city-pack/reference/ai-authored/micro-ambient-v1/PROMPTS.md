# Micro ambient art — approved source family

Profile: `TASKTOPIA_MICRO_TOPDOWN_CARTOON_V1`. All four raw raster sheets were authored with the image-generation tool, independently of retired large sprites. Hash-pinned source approval is recorded in `visual-review.json`; extraction cells, normalized dimensions and hashes are in `micro-ambient-manifest.json`.

## Common prompt constraints

True overhead game-map sprites, simple square cartoon pixel clusters, muted olive/ochre/cream/teal palette matching the procedural terrain and road atlas. No perspective vanishing point, no realistic shading, no smooth gradient, no blur, no thick black baseline. Consistent light from upper left. Isolated subjects with generous gutters on a clean solid magenta chroma background. No labels, letters, borders, contact shadows or decorative scenery. Readability at the declared native pixel envelope is more important than fine detail.

## Authored sheets

- Cars: four columns, blue compact car / red compact car / ochre taxi / cream van. Four rows face north / east / south / west. Each view is separately authored, not a rotation or mirror of an upright car. Roof, windshield and body color bands are the identifying features. Native opaque envelope is 4×6 pixels north/south and 6×4 east/west, on an 8×8 centered canvas.
- People: two columns, ochre and teal clothing. Four rows north / east / south / west. Head, shoulders and a small directional color cue, seen directly from above; no tall frontal character. Revision 2 has an exact 3×4-pixel occupied box `[2,2,5,6]` on an 8×8 canvas anchored at `[4,4]` for every heading. No gait frames or costume swaps. `sources/people.png` is archived evidence; `sources/people-v2.png` is active.
- Animals: four columns by two rows, fox / deer / rabbit / boar, duck / sheep / dog / cat. One static top-down pose per species. Broad body, head, ears, four-leg/tail cues where appropriate; fox tail, deer antlers, rabbit ears, duck beak and cat/dog ears must remain readable in 4–6×6 native pixels. The first narrow silhouette sheet was rejected and edited through the image-generation tool to these wider body/head silhouettes. Native canvas 8×8, no walking animation.
- Aircraft: two columns by two rows, north / east / south / west. One small cream regional aircraft with teal square stripes, clear cross-wing overhead silhouette, no realistic panel work. Opaque envelope up to 12×12 pixels on a centered 16×16 canvas.

## Permitted normalization and runtime rules

`scripts/build-micro-ambient.py --build` extracts each declared grid cell, removes chroma, tightly bounds the authored subject, preserves its aspect ratio with nearest-neighbor scaling into the native envelope, limits it to eight opaque colors and writes hard alpha only. It does not paint or reconstruct silhouettes. CITY rendering uses native integer scale, centered anchors and the authored compass view without rotation/mirroring. Aircraft takeoff/landing scale is the explicit exception: 0.05 at the endpoint to 1 in flight. Animals change position, never pose. Vehicles, including the red micro incident responder, occupy the actual 6×4-pixel physical body. CITY aircraft follow the shared smooth curve, select a compass image from the tangent and appear only on routes between completed same-country airport tasks, not random viewport-edge flights. COUNTRY/PLANET may use their own smooth map-level aircraft rotation.

## People revision 2 — registration correction

The old north/east/south/west views occupied 3×3 / 3×4 / 3×2 / 3×3 pixels.
The south view lost half its intended height, and turning changed the visible
center. The strict verifier now rejects both undersized and shifted people.

AI correction constraints: keep exactly two clothing colors and four authored
headings, overhead head/shoulder planes, clearly bright ochre on the east view,
the same 3:4 silhouette aspect in every heading, at most eight flat colors,
large square clusters, generous clear gutters on magenta. No new face detail,
outline, texture, gait, tall legs, rotate/mirror replacement or code repainting.
The first revised sheet remained too wide north/south and was rejected.
The next AI pass narrowed those shoulders; its north/south cells normalize
correctly. A targeted further AI edit widened east/west shoulders while keeping
their authored side cues; those east/west cells normalize correctly. Its south
view regressed, so that cell is not used.

`people-v2-provenance.json` pins both raw correction sheets, exact source crops,
unscaled paste locations, and the packed output hash. The eight unchanged
author cells are packed into 256×288 cells, two columns by four rows. The
verifier reconstructs the packed sheet and compares pixels. The final native
series and 16× nearest-neighbor preview were inspected and approved with all
eight opaque boxes exactly `[2,2,5,6]`. At 3px width, simple lower-color and
side-color cues are accepted; do not add faces that disappear during sampling.

Use `--draft-people-source <png> --draft-directory <dir>` for a non-publishing
preview. After approval, `--build --family people` leaves the other 28 entries
and PNGs unchanged. The selected series is validated before any PNG is written;
run the whole publisher and asset audit afterwards to refresh the revision.
