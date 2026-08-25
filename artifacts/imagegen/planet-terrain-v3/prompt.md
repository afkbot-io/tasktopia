# Planet terrain V3 — ImageGen source

Built-in ImageGen was used to create the source sheet.

## Final prompt

Use case: stylized-concept
Asset type: production pixel-art game terrain sprite sheet
Primary request: create one clean 4 columns by 2 rows sprite sheet containing exactly eight distinct seamless square terrain tiles for Tasktopia: grass, meadow, forest, hill, mountain, sandy coast, narrow river, stone.
Style/medium: crisp orthographic top-down 16-bit pixel art matching the muted Tasktopia city terrain, deliberate 1-pixel texture clusters, hard edges.
Composition/framing: perfectly regular 4×2 grid; every tile fills its entire equal square cell edge-to-edge; no gaps, margins, borders, rounded corners, hexagons, labels or text.
Color palette: muted olive greens, ochre sand, slate gray, deep teal-blue water; restrained contrast.
Constraints: all eight cells exactly square and tileable; no transparency inside cells; nearest-neighbor pixel aesthetic; top-down only; no lighting gradients, blur, antialiasing, isometric angle, objects extending across cell boundaries, text, watermark.
Avoid: hexagonal silhouettes, circles, empty corners, UI frames, labels, shadows outside tiles.

Runtime tiles are mechanically cropped from `source-sheet.png`, downscaled with nearest-neighbour sampling to 16×16, and normalized to fully opaque RGB PNGs.
