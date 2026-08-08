# Reference-art prompt template

Use generated images only as concept/reference input for deterministic runtime drawing.

```text
Use case: stylized-concept
Asset type: Tasktopia Pixel City V4 five-stage building reference sheet
Input images: Image 1 is the authoritative style and projection reference
Primary request: design <asset key and Russian label> as one coherent building shown in exactly five construction stages
Scene/backdrop: perfectly flat solid #ff00ff chroma-key background, no ground plane
Subject: left-to-right stages: site, full foundation, structural frame, nearly finished with scaffolding, finished building
Style/medium: crisp hand-authored pixel art matching Image 1; frontal-top city-builder projection; one-pixel dark blue-grey outline; upper-left light; muted palette
Composition/framing: five equal cells in one horizontal row; identical canvas, bottom baseline, footprint, entrance, camera and building identity in every cell; generous separation
Target proportions: runtime canvas <W>x<H> px, footprint <FW>x<FH> cells, bottom-centre anchor <AX>,<AY>, entrance <SIDE>:<OFFSET>
Identity cue: <one defining silhouette/function cue>
Constraints: each stage visibly advances the same structure; stage 4 has scaffolding; stage 5 has no construction elements; hard pixel clusters; no antialiasing; no blur; no gradients; no soft alpha; no text; no logo; no UI; no watermark
Avoid: isometric projection, photorealism, smooth vector edges, palette-only variants, changing entrances, floating buildings, excessive micro-detail
```

After receiving the reference, do not crop/downscale it into the game. Recreate its approved proportions in Pillow/source art at exact runtime resolution, then run the pack audit.
