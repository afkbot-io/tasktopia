# Long slate wing — unapproved source draft

Role: HOUSE / RARE / STANDARD, no service role, estimates 3/6, STONE platform.
One long north–south residential wing: 6×12 physical cells / 48×96 native.
The short south frontage has two floors and the same 3×3 leaf / 5×5 frame
as the approved wide family. This is a new footprint, not a rotated/stretched
bitmap. The roof dominates the long depth; side walls do not recede.

Distinct identity: cool dusty slate barrel-free flat roof, three small raised
rectangular skylights along the longitudinal axis, pale sandstone parapet,
muted olive front wall and paired teal windows. No courtyard/platform is baked
outside the building. Generate and verify stage 5 first, then derive 4→3.
Do not register this family until every independent source, geometry check,
native-scale review and actual-map placement gate has passed.

Initial stage-5 source was rejected: the requested alpha became an opaque
white background, the roof side edges tapered and the facade was too high.
The next source uses explicitly recorded solid-magenta recovery; no white
pixels or room-floor holes are repaired in code. The geometry contract is
unchanged. Initial unapproved source remains outside the runtime/catalog at
`/Users/kikasnikita/.codex/generated_images/01a03ebf-c3be-75f3-a92d-519d24d29f90/exec-c329a880-8520-40d0-823b-c8bdf44bd9f5.png`.

Attempt B used the recorded magenta-recovery path and kept straight axes,
but is rejected: its 565×1587 occupied source frame uniformly normalizes to
34×96 rather than the required 46–48 occupied width. The facade and entrance
remain too tall. Source SHA256:
`0f936a2efd68effb391c1f701aaa8b7671ced1759a85c873c6d09122935bbbbf`.
The next request widens the body and reduces the facade in the AI source;
the geometry and the uniform, non-stretching normalizer stay unchanged.

Attempt C improved to 45×96 but remained too narrow; source
`99aa8b71dc4c7a9fcef170ae10eb3512ccc7659b8f846ba62d4024c98d958b96`.
Attempt D passes the general mask gate at 47×96, 32 colors, hard alpha,
no holes and no drift. Source SHA256:
`d0c0c863b57c7e2e62b99e83fd48a1221cf0a8ceee2832c68cadb453c7f66362`.
Its 11px facade, 6px floor pitch, 3×3 leaf and 5×5 frame fit, but the upper
window openings occupy three rows (85–87) instead of two. It remains
unapproved; E requests only shortening those upper openings from below.
The lower windows, entry, roof and silhouette must not change.

E's source changed the background to a darker reserved magenta. It therefore
uses the explicit existing `magenta-chroma-family` recovery, not a pixel repair.
Source `dba6c8dbea2d7d428edc5b39e67950650605b6953879cc350e0c0f706c097a77`,
native `65729c175ea1a6f4a3701ae1c134bf68b23fe5d5210c0b7de3a19e30c9006b7c`.
Independent read-only review confirms the full geometry, 2px upper opening
envelope, 6px floor pitch and 3×3/5×5 entrance now pass. The finished stage
remains visually rejected: all upper windows normalize to dark brown/black
rather than visible teal glass. F changes only these aperture colors in the
AI source. It does not enlarge openings or relax the contract.
