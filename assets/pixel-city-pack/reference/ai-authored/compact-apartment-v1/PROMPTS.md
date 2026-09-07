# Compact apartment authoring prompts

Generated with the built-in image-generation tool. Sources are independently
authored in order `5 → 4 → 3`. The initial user reference is the coarse
red/cream/teal apartment supplied on 2026-09-04; its tall facade and dark outer
outline were explicitly replaced by the new compact-camera contract.

The shared effective prompt is: one isolated square-grid cartoon apartment,
coarse `48×48` game pixel art enlarged with nearest-neighbour pixels, muted
terracotta/cream/teal/slate palette, high `45°` frontal-top camera. Roof and
floor lines remain horizontal, vertical boundaries stay vertical, and there
is no receding side facade. No external black outline, cast ground shadow,
pavement, fence, people, text or scenery. Source canvas remains `1254×1254`.
Use a solid saturated `#ff00ff` recovery backdrop outside the silhouette only;
every interior floor, roof and window is opaque.

## Stage 5

Recreate the reference as one compact, approximately square apartment with
three short floors. The whole roof region occupies the upper two thirds,
and the red/cream facade the lower third. Keep three structural/window bays
and a centered south entrance. Small windows have two coarse teal panes;
the roof has a small cream access housing, one teal skylight and two vents.
Use flat pixel blocks and no heavy lower outline. Correct geometry in the
image model, never with non-uniform raster scaling.

## Stage 4

Edit the accepted stage-5 source only. Preserve its `1254×1254` canvas,
occupied frame `x=136..1119`, `y=170..1091`, baseline, entrance and floor/bay
centers. Make every window an unfinished dark opening without glazing
highlights. Keep bare slate covering the left half of the roof; remove the
right half to expose opaque room floors, matching cream/brick wall partitions,
a few material piles and a plank. Remove all finished rooftop objects.
The perimeter and front shell stay at the same position. No external fence
or machinery is added to the structure layer.

## Stage 3

Use stage 5 as the immutable identity/placement authority and stage 4 for
continuity. Remove the entire roof and all roof equipment. Retain the same
physical width and projected room-plane depth. Only about one and a half
storeys of the three-storey facade are assembled. Its ground line remains
at `y=1091`, and the center entrance and three bays remain fixed. The open
room floor is not scaled down. Back and partition walls expose the same
one-storey brick height, with strictly vertical/horizontal boundaries.
Add a small brick stack, sand pile and worktable inside the lot.

The first stage-3 draft was rejected because its baseline rose by `3 px`
and its room plane shrank. The correction explicitly requested a source
back wall near `y=324`, front-wall top near `y=930`, and unchanged ground
line `y=1091`: about `48×38 px` of occupied structure after normalization.

## Recovery and acceptance

Initial transparency generation created roof holes; a subsequent correction
painted a checkerboard. Both were rejected. Only the explicitly requested
magenta recovery background is removed by code. Accepted sources retain
their original geometry and are normalized by one shared stage-5 transform.
The final `report.json` contains source and normalized SHA-256 values, hard
alpha, occupied bounds and registration measurements. `visual-review.json`
pins the separately inspected native-scale outputs.
