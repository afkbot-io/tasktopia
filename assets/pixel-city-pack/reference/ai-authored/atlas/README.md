# Atlas AI-authored sources

These source sheets were generated for Tasktopia task #2 on 2026-08-25 with OpenAI ImageGen and normalized into the strict V5 runtime contract.

- `aircraft-topdown-models-v1.png`: 8 top-down aircraft, two authored motion frames each.
- `clouds-planet-v1.png`: 8 top-down planet cloud variants.
- `clouds-country-v1.png`: 8 frontal-top country cloud variants.
- `airport-terminals-v1.png`: 5 structurally different terminals.
- `airport-support-v1.png`: 8 support structures.

Runtime derivatives live under `public/game-assets/v5/atlas/`. They use fixed logical canvases, a reduced palette, nearest-neighbour runtime rendering and binary alpha. Run `python3 scripts/verify-atlas-assets.py` after changing them.
