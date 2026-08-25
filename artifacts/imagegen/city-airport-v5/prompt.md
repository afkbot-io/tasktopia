# City airport V5 — ImageGen source reference

The generated sheet is a composition and proportion reference only. It was
not promoted directly to runtime because its background is opaque and its
pixel density is higher than the canonical 8×8 city assets. Runtime continues
to use the verified hard-alpha airport family, with the corrected layout,
scale, tile pad and construction-family fence implemented in code.

## Prompt

Use case: stylized-concept

Asset type: production game sprite-sheet reference for Tasktopia city airport buildings

Input images: Image 1 is the current airport composition and scale problem; Image 2 is the canonical city pixel-art style, construction-site fence language, building perspective, palette, and density reference.

Primary request: create a clean sprite sheet of five distinct airport structures: one medium terminal, one aircraft hangar with a visibly plane-sized door, one control tower, one airport fire station, and one compact service/fuel building.

Style/medium: authentic old-school 2D pixel art matching Image 2, hard pixel edges, limited muted palette, dark 1-2 pixel outlines, no antialiasing, no painterly or photorealistic rendering.

Composition/framing: each structure separated with generous transparent padding; consistent front-facing slight 3/4 city perspective and common ground baseline; buildings sized proportionally to one another, hangar door wider than a small plane, terminal substantial but not dominant.
Constraints: genuinely transparent background; no ground plane, no runway, no fence, no people, no vehicles, no planes, no text, no labels, no logos, no watermark; no object overlap; preserve one coherent camera angle and pixel density across all five sprites.
