# Reference-art prompt template

Use approved single-stage images as visual authority for deterministic runtime normalization.

This template is for creating a new stage 5 from scratch. If stage 5 already exists, do not replace it. Use `$tasktopia-building-stage-generator`, its `references/reverse-stage-prompts.md`, and one separate generation request per stage. Verify each result independently with `$tasktopia-building-stage-verifier` before continuing.

```text
Use case: stylized-concept
Asset type: Tasktopia Pixel City V5 single finished building stage
Input images: Image 1 is the authoritative style and projection reference
Primary request: design <asset key and Russian label> as exactly one isolated finished building, stage 5
Scene/backdrop: perfectly flat solid #ff00ff chroma-key background, no ground plane
Subject: one finished building with no construction remnants
Style/medium: crisp hand-authored pixel art matching Image 1; strict straight-on frontal-top city-builder projection; facade parallel to screen, verticals vertical, floors horizontal; only a shallow roof/top plane is visible; one-pixel dark blue-grey outline; upper-left light; muted palette
Composition/framing: one centered subject; exact canvas, bottom baseline, footprint and entrance contract; generous transparent/chroma clearance only where required
Target proportions: runtime canvas <W>x<H> px, footprint <FW>x<FH> cells, bottom-centre anchor <AX>,<AY>, entrance <SIDE>:<OFFSET>
Occupied bounds: stage 5 must fill <MIN_W>–<MAX_W> px width and <MIN_H>–<MAX_H> px height after aspect-preserving normalization
Identity cue: <one defining silhouette/function cue>
Constraints: stage 5 has no construction elements; hard pixel clusters; no antialiasing; no blur; no gradients; no soft alpha; no text; no logo; no UI; no watermark; no sheet or comparison panel
Avoid: three-quarter/side view, receding side facade, isometric projection, photorealism, smooth vector edges, palette-only variants, changing entrances, floating buildings, excessive micro-detail
```

After approval, preserve the AI-authored geometry as the visual authority. Deterministically remove chroma, resize the single stage without stretching, harden alpha and quantize the palette. Do not repaint or replace its geometry with procedural primitives. Keep accepted source art and provenance next to the runtime contract, then run the pack audit.
