# Reverse construction-stage prompts

Use one prompt per image-generation request. Replace every `<placeholder>` from the verifier geometry JSON. Always pass the approved finished building as Image 1.

## Shared invariant block

```text
Use case: precise-object-edit
Asset type: one Tasktopia Pixel City construction-stage source
Input images: Image 1 is the immutable finished-building identity, palette, scale and camera authority; Image 2, when supplied, is continuity guidance only
Scene/backdrop: perfectly flat solid #ff00ff chroma background, no ground plane, no pavement, no shadow
Style/medium: detailed crisp pixel art; strict frontal-top city-builder projection; facade parallel to screen; verticals vertical; floors horizontal; shallow visible top planes; dark blue-grey one-pixel outline; muted palette; light from upper-left
Geometry: 8 px cell; target canvas <widthCells>×<heightCells> cells (<widthPx>×<heightPx> px after normalization); physical footprint <widthCells>×<depthCells> cells; projected horizontal-plane depth <projectedRoofDepthCells> cells; bottom-centre anchor <anchorX>,<anchorY>; entrance south at offset <entranceOffset>
Source-canvas lock: preserve Image 1's exact source canvas aspect ratio and its subject margins; do not switch between square, portrait and landscape canvases because the whole canvas is normalized to the target grid
Identity lock: preserve the exact horizontal centre, roof outline, bay count, entrance centre, main materials and characteristic facade rhythm of Image 1
Structure-layer rule: isolate only the structure/construction contents; do not draw the external perimeter fence, pavement, road, grass, people, vehicles, text, labels, UI or watermark
Avoid: side view, three-quarter view, isometric diamond, receding facade, rotated base, diagonal floors, a different building, stretched proportions, soft blur, smooth vector art, gradients
```

## Stage 4 — nearly finished

Append:

```text
Primary request: derive only construction stage 4 from Image 1
Stage state: retain the complete final silhouette, setbacks, roof and entrance; leave selected facade panels/windows unfinished; add close scaffolding attached to the facade and small construction details inside the footprint
Coverage: target 90–100% of final occupied height and width; the verifier's 85–105% height and 85–110% width bands are rejection tolerances, not authoring targets; scaffold must not force the building to shrink or widen materially
Extrema lock: preserve every integral mast, spire, antenna, tower and crown that defines Image 1's highest or widest point; leave it structurally present but unfinished
Keep unchanged: foundation/roof screen plane, ground baseline, building centre and entrance
```

## Stage 3 — structural frame

Append:

```text
Primary request: derive only construction stage 3 from Image 1
Stage state: show the recognisable structural skeleton of the same building—columns, core and floor slabs following the final bay rhythm; target 55–65% of final occupied height
Coverage: retain the final foundation width and projected depth; do not invent a new podium, crane silhouette or side facade
Keep unchanged: foundation corners, horizontal centre, ground baseline and entrance bay
Low-rise rule: normally keep one structural storey plus short rebar; do not complete a second storey merely to make the frame look substantial
```

## Stages 1–2 — never prompt an image model

Compose them with `constructionStageLayout()` from the shared `8×8` tile kit.
Stage 1 and stage 2 use the same projected site rectangle, derived from the
physical footprint, and the same one-cell fence/gate contract. A generated
foundation image is a rejection, even when it looks attractive.

## Iteration rule

When a stage fails, issue one targeted edit request naming only the failed invariant. Repeat the shared invariant block. Never ask the model to “improve everything” and never combine stages in one generated image.
