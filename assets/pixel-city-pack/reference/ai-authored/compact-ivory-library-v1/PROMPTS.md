# Ivory library: bounded source completion

The original AI-authored stage-5 architecture is the ivory high roof with a
long olive-framed glazed skylight and paired terracotta reading terraces. It
must not be replaced by a copy or color swap of another family.

The original source SHA256 is
`9b3896eaa42ce9999389cc18cbb6d19a95567d72cb6690ad7719a809f6c0a4d7`;
original native SHA256 is
`6951e38bedd551ff1aa672e74bb5edf71712e103c1b6c8a5485b80457599ed39`.
No source or native image is replaced until a corrective source passes review.

Initial measurements on the original native48×48 image:

- 6×6 lot; bottom anchor24,48; tight source frame130,179,1124,1117;
  uniform target48×45, offset0,3; occupied48×45.
- Door leaf x22–25,y45–47 is4×3; outer decorative portal spans x20–27,
  y43–47 (8×5), whereas the existing contract requires7×5.
- Facade glass bands x4–13,19–28,34–43 are10×2; no clear native divisions
  establish individual2–3×2 panes. Proposed correction: two cream mullions
  yielding3/2/3 panes inside each unchanged10px horizontal envelope.
- Window rows36–37,40–41,43–44 have4 then3px spacing. This is measured,
  not accepted as exact4px floor rhythm. A source or legal frame correction
  must preserve two-pixel pane height while correcting this spacing.

## Accepted finished correction D

Parent independently reviewed and accepted source D, recorded in
`visual-review.json`. The original source and rejected A/B/C are retained next
to the accepted `sources/stage-5.png`. Full facade panes are now24 independent
2–3×2 apertures on rows36–37,40–41,44–45; the partial entry sidelights were
removed through ImageGen. The4×3 leaf and7×5 frame retain their immutable grid.

The declared common frame `[125,168,1125,1115]` adds only background to source D:
4sourcepixels left and6below narrow-key visible bounds. Every reverse stage
uses exactly the same frame; no independent crop/registration is permitted.

Stage4A's source contains exterior dark-magenta specks that defeat the narrow
key. The already-supported reserved-magenta-family recovery was checked for
both source5 and4: their native PNGs remain **byte-identical**, respectively
`cdde6e7be4cbbeb04df21d3e92909f93612b899dc5c6f159af5a096f24f85ac9`
and`555cafa145ba295967a29d3d1003b562afb1dedfcac61ffa2323e0a0de33e0e6`.
The family now declares that broader recovery key. This removes only exterior
source artifacts, not authored geometry; the common frame and accepted PNG
bytes do not change. Source5 visible bounds become130,169,1124,1108 and source4
130,169,1125,1108. All per-side background margins remain below2%.

Generation uses built-in ImageGen with one separate image per stage and
reverse5→4→3 derivation only after individual native visual approval. Scripts
may normalize chroma, alpha, palette and a common uniform frame; they do not
repaint portals, windows or architecture.
