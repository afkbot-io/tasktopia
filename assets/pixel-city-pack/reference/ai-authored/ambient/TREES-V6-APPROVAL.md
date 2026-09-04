# Tasktopia V6 tree approval

- Tool: built-in Codex `image_gen`
- Date: 2026-09-04
- Runtime profile: `TASKTOPIA_V6_TREE_HIGH_45_GRID`
- Runtime contract: `16×32`, footprint `1×1`, anchor `[8,32]`
- Camera: orthographic high view at `45°`; broad crown top, compressed striped
  front band and almost hidden trunk
- Shape: compact square/rectangle, `1–2 px` corner steps, `2–4 px` blocks and
  `2–3` horizontal depth bands parallel to roofs and terrain

## Accepted sheets

| Source | Order | SHA-256 |
| --- | --- | --- |
| `trees-deciduous-v6.png` | oak, maple, round, aspen, birch | `2179f319b65ccedfea6386f034379d27e68ab46d03db96ae99af2ec0ef9d3be2` |
| `trees-special-v6.png` | apple, cherry, magnolia, willow, deadwood | `a6fc43615843c98a1ced3d8a73a751da814d35b19f88037ace59f9625a52d3bf` |
| `trees-conifers-v6.png` | conifer, pine, cedar, cypress, redwood | `2813ebf281ae1a63b4548082d3c2447411bf0cb3287a88f250fdac6372f367fc` |
| `tree-palm-v6.png` | palm | `447bc07c640cb0abb554cd39bc33beb19693032365d68d417b956d08eac72b40` |

## Prompt contract

Generate equal-width horizontal sheets on uniform `#ff00ff`. Use a high
orthographic `45°` view matching building roofs. Every living crown is a
compact square or rectangle with a dominant flat top plane, `1–2 px` stepped
corners, `2–3` parallel horizontal depth bands, muted Terrain V4 colors and a
short lower-centre trunk. Species vary through dimensions, band spacing,
top-plane marks and palette without leaving the common square grammar.

Reject circular, oval, cloud, cone, triangle, Christmas-tree, radial palm,
stacked-tier and long-branch silhouettes. Also reject antialiasing, gradients,
blur, translucent edges, baked ground, cast shadows, realistic foliage, text,
UI and watermarks.

## Normalization boundary

Normalization may remove chroma, scale with preserved aspect ratio, quantize
without dithering, harden alpha, bottom-centre the subject and trim stray alpha
from rows `30..31` outside `x=4..11`. It may not repaint the crown, change band
direction, exchange species order or synthesize foliage.
