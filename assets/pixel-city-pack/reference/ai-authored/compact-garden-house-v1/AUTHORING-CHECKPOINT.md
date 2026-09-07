# Garden house — source family frozen 2026-09-07

Parent independently accepted native and8× stages5D,4,3D and their full sequence.
This is one HOUSE family, not completion of the entire outstanding catalog.
No global catalog, shape list, runtime/public pack, deployment or map integration
was changed here. Parent owns serial publication and actual-world review.

The unique planted roof rectangle and upper-right access hut remain the finished
identity. Stage4 removes every garden/hut element and retains about50% of the
whole roof. Stage3 removes all roof and most upperfront masonry across three bays,
with opaque interior floors, raised orthogonal room partitions and internal
materials. This is semantic structural progress, not arbitrary colored-pixel area.

## Immutable geometry and measured native features

- Native48×48, physical6×6cells of8px, anchor24,48, south entrance offset3.
- One frame `[141,201,1111,1113]` for all stages. Finished visible source bounds
  `[141,201,1111,1109]`; only4background pixels added below (0.44%<2%). All opaque
  pixels contained. Uniform scale48/970, NN target48×45, offset0,3; no per-stage
  crop, recenter, independent-axis scale or code geometry repair.
- Existing `magenta-chroma-family` recovery and `MAXCOVERAGE` quantization.
 32/32/31colors for3/4/5 including transparent; alpha only0/255; no interiorholes.
- Finished roof29px at y3..31; facade16px y32..47. Floor pitch5/5.
- Eight finished/4 apertures2×2: x8/23/38 at y33/38, x8/38 at y43. Stage3 has
  only the five lower apertures at unchanged coordinates; top three are removed.
- Door leaf4×3 `[22,45,26,48)`; cream portal7×5 `[20,43,27,48)`, same inall3.
- Occupied5/4:48×45, top3. Occupied3:48×44, top4 after north coping removal.
  Baseline48, horizontal center unchanged; foundation rows46/47 have zero alpha
  differences and zero drift across all stages. No heavy black baseline.
- Stage3 interior central/right partition axes vary up to1px versus4, disclosed
  and accepted within existing authoring tolerance. Not exact masonry identity.

## Frozen provenance

|Stage|Source SHA256|Native SHA256|
|---|---|---|
|3D|6630e25bfda1b24b0bbecbda2605a52d5b6fdbcac199b8f755822c891c8ac40f|99569a89decbf9ca1d6589e96b92f732ec936aee107e29b9f8617ee388ed119c|
|4|f5b2560aca459b02158f5b3418b8d96b6715fbb2cab4940bc9d79a006831d0ba|882763574b5a53e15a8ecffe3064c9161b3c6bcf0642d7f75b9f5c9ff12d57a9|
|5D|963f90cdb5220a68b5c9a1813d6d5e57bc1898181733abc9f28214b41c65c484|6345738ba36ae28cd77a46363b3cad7a0172c24d04af2edff1fecf7bf5ebe98d|

`PROMPTS.md` and individual exact prompt files record all built-in ImageGen
requests. Original5 and rejected5A/B/C,3A/B/C remain recoverable in `sources/`.
No rejected candidate was marked reviewed or published.

## Narrow verification

Run from repository root with `.venv-assets/bin/python`:

```
scripts/verify-compact-building-art.py --family assets/pixel-city-pack/reference/ai-authored/compact-garden-house-v1 --require-complete --require-review
assets/pixel-city-pack/reference/ai-authored/compact-garden-house-v1/measure-openings.py
```

The fixed source-derived ROI helper checks actual aperture/body/frame/foundation
pixels. It excludes chromatic olive lintel shadows from charcoal aperture counts.
A negative fixture with stage4 bytes posing as3 rejects all three surviving upper
windows; the actual3D/4/5D pass. No architecture is painted by this helper.

Previews: individual native/grid files and `previews/stage-sequence-8x.png`.
Proposed catalog entry is local only: `catalog-entry.proposed.json`.
