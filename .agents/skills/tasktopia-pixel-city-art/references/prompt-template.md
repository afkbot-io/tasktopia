# Reference-art prompt template

Use an approved generated sheet as the visual authority for deterministic runtime normalization.

```text
Use case: stylized-concept
Asset type: Tasktopia Pixel City V4 five-stage building reference sheet
Input images: Image 1 is the authoritative style and projection reference
Primary request: design <asset key and Russian label> as one coherent building shown in exactly five construction stages
Scene/backdrop: perfectly flat solid #ff00ff chroma-key background, no ground plane
Subject: left-to-right stages: site, full foundation, structural frame, nearly finished with scaffolding, finished building
Style/medium: crisp hand-authored pixel art matching Image 1; strict straight-on frontal-top city-builder projection; facade parallel to screen, verticals vertical, floors horizontal; only a shallow roof/top plane is visible; one-pixel dark blue-grey outline; upper-left light; muted palette
Composition/framing: five equal cells in one horizontal row; identical canvas, bottom baseline, footprint, entrance, camera and building identity in every cell; generous separation
Target proportions: runtime canvas <W>x<H> px, footprint <FW>x<FH> cells, bottom-centre anchor <AX>,<AY>, entrance <SIDE>:<OFFSET>
Occupied bounds: stage 5 must fill <MIN_W>–<MAX_W> px width and <MIN_H>–<MAX_H> px height after aspect-preserving normalization
Identity cue: <one defining silhouette/function cue>
Constraints: each stage visibly advances the same structure; stage 4 has scaffolding; stage 5 has no construction elements; hard pixel clusters; no antialiasing; no blur; no gradients; no soft alpha; no text; no logo; no UI; no watermark
Avoid: three-quarter/side view, receding side facade, isometric projection, photorealism, smooth vector edges, palette-only variants, changing entrances, floating buildings, excessive micro-detail
```

After approval, preserve the AI-authored geometry as the visual authority. Deterministically remove chroma, split stages, resize with area sampling, harden alpha and quantize the palette. Do not repaint or replace its geometry with procedural primitives. Keep the source sheet and provenance next to the runtime contract, then run the pack audit.
