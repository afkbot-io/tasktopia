# Ivory library — source-family checkpoint

2026-09-07. **Frozen source family:** finished5 and corrected4B/3B are independently
accepted, including the complete native/8× sequence.
No catalog registration, runtime publication or global build is claimed here.

## Fixed geometry and source authority

- Native48×48; physical6×6cells at8px; bottom-centre anchor24,48; south offset3.
- The approved5 has occupied48×45 at `[0,3,48,48]`, roof31px/front14px,
  three facade rows spaced4px apart. Row starts36,40,44; pane heights2px.
- All complete panes are2–3×2. Left bands have widths3/3/2; center/right3/2/3.
- Leaf4×3 at `[22,45,26,48)`; frame7×5 at `[21,43,28,48)`.
  Frame material/edge and the small stage5 internal highlight were visually
  inspected separately from ROI opacity checks.
- Shared sourcecanvas1254×1254; immutable frame `[125,168,1125,1115]`;
  uniform scale0.048; rounded NN target48×45 at offset0,3. This is one common
  transform for every stage, not independent resizing or cropping.
- The frame fully contains finished-source visible bounds. Under final broad
  chroma recovery those are `[130,169,1124,1108]`: only5left,1top,1right,
  7bottom source pixels of added background, all below the2%per-side limit.
- Declared reserved-magenta-family recovery removes exterior noise. Accepted5
  runtime bytes remain identical to the original narrow-key approved hash.

## Progression and measured consistency

| Stage | Occupied native rectangle | Complete surviving facade panes | Retained roof/slab area |
| --- | --- | --- | --- |
| 3B, accepted | `[0,6,48,48]`,48×42 | 15; upper front row dismantled across all bays, lower two rows retained | 0% |
| 4B, accepted | `[0,3,48,48]`,48×45 | 24 | approximately53%, including LEFT orange structural slab |
| 5, accepted | `[0,3,48,48]`,48×45 | 24 | 100% |

Stage3B is roofless with an opaque room floor and raised straight partitions;
upper front masonry is visibly incomplete, not a literal50%window count. Right-side
room axes continue from4B; walls/caps are unfinished and lower than the finished
roof silhouette. Both orange roof/terrace slabs are removed/opened. Material
piles and a worktable are inside. Parent independently accepted this semantic
assembly state; raster height is not used as a percent-built metric.3A still
had21panes and appeared nearly complete, so parent rejected it. The preserved
3A source was corrected by removing most upper-front masonry and six remaining
upper apertures, not by altering the physical lot, doors or lower rows.

All3 stages have the same leaf/frame grid, baseline48, zero horizontal centre
drift and no transparent interior holes. Foundation alpha is EXACTLY identical:
row46 has48opaque pixels, row47 has19 (corner feet and portal, not a continuous
black baseline). Per-stage foundation difference0pixels, maximum drift0px.
No claim is made that every wall-shading or masonry pixel is identical.

The generator's first4A retained both orange terrace slabs. Counting only its
cream main plane would misleadingly suggest50%; inclusive coverage was63%.
Parent rejected that progression.4B opens the RIGHT slab and is independently
accepted at approximately53%inclusive coverage.3 was generated only from4B,
with approved5 as the coordinate reference. `stage-3-a.prompt.txt` was prepared
before the4A coverage rejection and was NEVER executed; the actual prompt is
`stage-3-from-4b.prompt.txt`.

## Source and normalized SHA256

| Stage | Source SHA256 | Native SHA256 |
| --- | --- | --- |
| 3B | `bed4b128ea8bec66183c87cd572a53c1661c53bff0377844159b0a8ec8b74500` | `9661833dded63afcdba3207157b557ee58c0044b9ff5506c9c75d0cfc71358b9` |
| 4B | `9e3c332891314b475c89d2e88b72dc699b06178cdd32c8de99e77992608f8de9` | `213c00b6173741beb9a62794f96c154861f3b25ff21a7128af8e9fc77e4706a5` |
| 5D | `9112c57e86a3687f8422fd5397e9698e5d2045a1e68b66fca98e96fb27110bdc` | `cdde6e7be4cbbeb04df21d3e92909f93612b899dc5c6f159af5a096f24f85ac9` |

All artwork is created/edited with built-in ImageGen, one requested stage per
call. Raw originals remain in Codex's generated-images directory. This folder
preserves original5, rejected5A/B/C, rejected4A and rejected3A plus exact prompts. No
procedural architecture, pixel repainting, axis warp or per-stage crop repair.

## Verification scope

- Fresh `verify-compact-building-art.py --family <this directory>
  --require-complete --require-review`: exit0, `errors: []` after3B approval.
  Source/native review hashes match all3 files and the shared-frame contract.
- `measure-openings.py`:5=24,4=24,3=15 surviving panes; all2–3×2 with full
  opaque bodies, fixed4×3leaf and7×5opaque warm frame; exit0.
- Normalizer reports hardalpha{0,255},31colors and0holes on all3 stages.
- Read-only opening helper regression: a copy of4 masquerading as3 used to
  pass with24panes; after requiring0upper panes and15lower panes, it correctly
  exits1. Actual5/4B/3B still exits0. This isolated negative fixture is not art.
- Individual native PNGs and8×grid previews plus `previews/stage-sequence.png`
  and its8×version are available for independent inspection.

All3 visual/source approvals are now recorded in `visual-review.json`.
Parent owns catalog registration, serial publication and actual map review;
the proposed catalog record is a handoff, not a claim of runtime availability.
