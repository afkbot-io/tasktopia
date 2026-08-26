# Flat planet V2 AI-authored sources

Generated for Tasktopia task #2 on 2026-08-25 with the built-in OpenAI ImageGen workflow, using accepted Tasktopia V5 terrain, vehicle and atlas assets as style references.

- `planet-terrain-hexes-v2.png`: eight orthographic terrain hexes in the order grass, meadow, forest, hill, mountain, coast, river, stone.
- `aircraft-topdown-v2-frame-1.png`: eight orthographic aircraft, all pointing east for SVG `rotate=auto` motion.
- `aircraft-topdown-v2-frame-2-reference.png`: authored propeller/light animation variation.
- `clouds-topdown-v2.png`: eight lower-contrast orthographic cloud silhouettes.

Runtime derivatives live in `public/game-assets/v5/atlas/{terrain-v2,aircraft-v2,clouds-v2}`. They are nearest-neighbour normalized to fixed canvases with binary alpha. Validate them with `python3 scripts/verify-atlas-assets.py`.
