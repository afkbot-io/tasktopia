# Building sprite audit and generation specification

## Canonical visual grammar

The reference family is:

- `highrise-glass`
- `highrise-brick`
- `highrise-stepped`
- `highrise-corporate`
- `highrise-landmark`

Rules derived from that family:

- Logical grid: 8×8 px; every footprint and canvas dimension is divisible by 8.
- Camera: fixed south-facing orthographic elevation; all verticals remain vertical; no perspective convergence.
- Roof/top plane: shallow 1–3 px indication, not a large 3/4 roof plane.
- Side walls: absent or at most a narrow consistent 1–2 px edge; no independent vanishing direction.
- Anchor: bottom center on the south edge of the declared footprint.
- Lighting: upper-left, one shared highlight ramp and one shared shadow ramp.
- Outline: one-pixel dark contour using the shared blue-charcoal family, never pure black.
- Palette: shared global material ramps plus at most two building accents; no antialiasing or semitransparent edge pixels.
- Detail frequency: windows/doors use repeated pixel modules; no subpixel texture noise.
- Export: RGBA, exact native size, nearest-neighbor only, integer coordinates, transparent background, alpha bounds validated.

## Keep as primary references

The five high-rises above define the result. Other categories are not automatically accepted merely because they predate V4.

## Commercial/store audit

The stores currently read as a second pack: several are only 16 px high facade strips, roof depth is inconsistent with residential buildings, signage/awnings use a brighter independent palette, and generic construction stages do not grow into the final massing. Every store still requires exactly five authored stages.

### Rebuild — priority A

| Key | Current problem | Target |
| --- | --- | --- |
| `shop-supermarket` | 40×16 facade strip, too flat beside housing | 40×24 or 48×24 frontal market, shallow roof cap, loading/service hint at rear |
| `shop-bakery-long` | 48×16 awning strip with another detail scale | 48×24 repeated bays, restrained awning palette, south-facing doors/windows |
| `shop-mall` | 56×24 massing/signage do not match high-rise grammar | 56×32 coherent mall block with one entrance hierarchy and shallow top plane |
| `shop-warehouse` | reads as a separate industrial icon family | 48×24/32 warehouse with canonical outline, modular doors, service frontage |
| `commercial-shopping-plaza` | modules lack a shared baseline | 56×32 continuous plaza frontage or two deliberate wings on one platform |
| `commercial-corner-cafe` | perspective corner conflicts with the fixed camera | 32×24 orthographic cafe; corner expressed through signage, not vanishing walls |
| `commercial-pharmacy` | palette/signage dominate the building | 32×24 canonical storefront with one limited medical accent |
| `commercial-auto-repair` | garage proportions differ from civic/service buildings | 40×24 aligned repair bays, canonical roof and outline |

### Rebuild as one service family — priority B

- `commercial-gas-station`: consistent canopy, kiosk and pumps on one 6×3 asphalt platform.
- `commercial-gas-station-compact`: smaller member of the same family, not a separately styled icon.
- `commercial-highway-service-plaza`: visibly larger composition using the same canopy, kiosk, lighting and parking vocabulary.
- `commercial-parking-lot`: keep top-down lot semantics, but author site preparation → grading → bays → lighting/entrance → completed occupied lot. It must not reuse a generic building-frame stage.

### Civic silhouettes retained only after the same gate

- `civic-clinic`, `civic-fire-station`, `civic-police`, `civic-bank`, `civic-school`, `civic-city-hall`, `civic-post-office`

## Redraw completely — priority A

These have the strongest pitched-roof/angle/scale mismatch or read like a different asset pack:

- `house-cottage`
- `house-gabled`
- `house-bungalow`
- `house-suburban-narrow`
- `house-garden-villa`
- `house-rustic-cottage`
- `house-woodland-home`
- `house-modern-compact`

The new versions should be frontal modules: porch/door/window rhythm on the south facade, only a shallow roof cap, and consistent pixel density with the high-rises.

## Rebuild/normalize — priority B

These have useful massing but need baseline, top-plane, outline, palette, or stage consistency work:

- `house-townhouse`
- `house-duplex`
- `house-small-apartments`
- `house-rowhomes`
- `house-brick-duplex`
- `house-courtyard-apartments`
- `house-modern-lowrise`
- `house-corner-apartments`
- `highrise-mixed-use-market`

## Normalize after the housing set — priority C

These additions are structurally useful but must be checked against the same palette/stage gate:

- `civic-theatre`
- `civic-library`
- `civic-fire-station-compact`
- `civic-police-neighborhood`
- `civic-clinic-neighborhood`
- `commercial-gas-station-compact`
- `commercial-highway-service-plaza`

## Five construction stages

1. **Planning/site:** platform boundary and survey marks matching the exact final footprint.
2. **Foundation:** slab/footings following the final massing, with no unrelated generic rectangle.
3. **Frame:** columns/floors reach roughly 45% of the final height and match window bay rhythm.
4. **Shell:** 75–85% final silhouette, unfinished facade/scaffold, same anchor and canvas.
5. **Complete:** final building.

Each stage must have byte-identical canvas dimensions, a constant bottom-center anchor, alpha entirely inside bounds, and a monotonically increasing visual completion score.

Stores use the same five semantic stages, but stages 3 and 4 must reproduce the exact final bay count, canopy footprint, entrance position, and roof massing. Parking follows its site-specific five-stage sequence above.

## Automated asset gates

- Sprite/canvas/footprint dimensions are multiples of 8.
- All five stages exist, are RGBA, nonempty, and have identical dimensions.
- No nontransparent pixel touches an unintended canvas edge.
- No fractional alpha except an explicitly whitelisted shadow palette.
- Unique-color count remains within the configured palette budget.
- Stage anchors differ by zero pixels.
- Final silhouette occupancy stays within the declared footprint projection.
- A generated contact sheet places every stage on actual grass/platform and next to one canonical high-rise at 4× nearest scaling.
- Runtime screenshot verifies dense rows, private rows, roads, people, and vehicles at actual camera zoom.
