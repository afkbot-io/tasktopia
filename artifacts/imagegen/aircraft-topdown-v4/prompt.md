# Aircraft top-down V4 — final built-in ImageGen prompt

Use case: style-transfer
Asset type: production 8-bit aircraft sprite sheet edit
Primary request: convert the eight existing top-down aircraft into very small, deliberately chunky Tasktopia pixel sprites suitable for final display at 24×16 pixels.
Input image: generated eight-model top-down draft; preserve exactly eight models, their direct top-down orientation, right-facing direction and 4×2 arrangement.
Style/medium: true low-resolution old-game pixel art; large square pixels; hard single-pixel dark teal outline; at most 8 flat colors per aircraft.
Composition/framing: exactly four equal cells across and two equal cells down; one centered aircraft per cell; wide empty padding around every sprite.
Constraints: keep all aircraft horizontally aligned and perfectly symmetric top-to-bottom; use genuine transparent alpha outside aircraft.
Avoid: checkerboard or visible background, gradients, anti-aliasing, realistic detail, shadows, motion blur, text, watermark, diagonal or perspective views.

Runtime normalization: each reviewed cell is cropped from the generated source, nearest-neighbour scaled into a 22×14 content box, and transparently padded to the canonical 24×16 runtime canvas.
