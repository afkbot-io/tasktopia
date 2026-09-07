# Rose house: complete source family frozen

Current status: **APPROVED_SOURCE_FAMILY_NOT_PUBLISHED**. Parent independently accepted G/4A/3D2 and the entire sequence at native1×/8×. Canonical sources/native PNGs, geometry, reports and reviews are frozen; global catalog/publisher and actual-map integration remain the parent's scope. Original source/native and all failed candidates are preserved, not deleted or painted over.

Frozen frame `[128,153,1121,1094]`, MAXCOVERAGE, native48×48, target48×45 allocated at0,3 but **actual occupied48×44** at0,4 in all3 stages. Eight exact2×2 windows at x8/23/38,y34/39/44 in5/4 (no lower center), five survivors in3 after the actual upper row is dismantled. Exact4×3 leaf `[22,45,26,48)`,7×5 frame `[20,43,27,48)`, floorpitch5/5, roof including rim≈29px/front15px. Physical6×6 cells, anchor24,48, south3. Existing broad reserved-magenta mode was independently approved after a single exterior fringe was found in4;5 native remained byte-identical. No new threshold or geometry tolerance.

| Stage | Source SHA256 | Native SHA256 |
| --- | --- | --- |
| 3D2 | `8bd4b646e5031b12eb85fb06526586c5d672e9f39b3356816a4bf1a1400f48d5` | `88025dc3ce20b8b1856bdcfb3aaf097e9ad3282800d280dfc463224288e86111` |
| 4A | `4f57f9f6d68ae698e267d762ca09551e63d66baafc6406e58767ad340e731106` | `4011055419f1f7043dbd994ac0ef7f55e643921dbad6e8efbadac3ab768d4307` |
| 5G | `0e72c300f51c02f6a146aacacc453a5afade9e1fee4385d0645895a4ee5e2d83` | `b2f53e5a2cb000c06e56b3e6261a1dffdd4bfcfc79766bd3dfcb2352a4829c12` |

Roof coverage100→≈50→0, opaque room floors and actual missing upperfront columns in3. All3 palettes31colors, hardalpha,0holes and0centre/baseline/foundation-mask difference. 3D2 source bounds match5 exactly; no independent source registration. D1 is an intentionally overbuilt roof-off intermediate, not accepted3.

`measure-stage5-openings.py` checks8 exact2×2 teal panes and the door. `measure-reverse-registration.py` checks8/5 exact dark apertures, doorway and foundation; it rejects a complete4 reused as3 and rejects B/C's actual narrow/short openings. Brown floor/column shadows are not falsely counted as windows. The existing normalizer's source/native drift contract remains authoritative; raw source overhang alone was not made a new hard gate.

Family-only verification commands:

```sh
.venv-assets/bin/python scripts/verify-compact-building-art.py --family assets/pixel-city-pack/reference/ai-authored/compact-rose-clinic-annex-v1 --require-complete --require-review
.venv-assets/bin/python assets/pixel-city-pack/reference/ai-authored/compact-rose-clinic-annex-v1/measure-stage5-openings.py
.venv-assets/bin/python assets/pixel-city-pack/reference/ai-authored/compact-rose-clinic-annex-v1/measure-reverse-registration.py
```

The sections below are preserved historical failed checkpoints; their statements that original was untouched or all stages were unapproved refer to those earlier moments, not current G acceptance.

## Historical checkpoint before geometry-first reconstruction G

2026-09-07, before G. **Not accepted, not registered or published at that checkpoint.** This is a bounded
source repair checkpoint, not a completed family. No stage 4/3 was generated.
The existing 48×48 canvas, 6×6 lot, 24,48 anchor, 4×3 door leaf and 7×5 frame
contract remain unchanged. No new `commonSourceFrame` was installed here.

The existing architecture remains the two roof gardens, central roof volume,
rose facade and three floor bands. The original source was not replaced:

- Source SHA256: `c09d7b4c6cee6c75bdf9356fd127d2364924f1bce26d6938374db68bc934e9e9`.
- Native SHA256: `20f4734442b09822661249258cf0b0fb6d278e05cef7b768187b567fc8f89a8f`.
- Original tight source frame: `[133,168,1121,1067]`; target 48×44, offset 0,4;
  occupied `[0,4,48,48]` inside native 48×48. Hard alpha, no interior holes.
- Original leaf: x22–25, y45–47 (4×3). Visible cream portal x21–26,
  y44–47 (6×4), not the contracted 7×5. The whole-facade belt above it is not
  relabelled as a doorway frame to manufacture a passing measurement.

## Rejected built-in ImageGen sources

| Candidate | Actual observation | Source SHA256 |
| --- | --- | --- |
| A, `rejected-stage-5-portal-a.png` | Same high camera and 4×3 leaf. Cream portal x20–27,y44–47 is 8×4, not 7×5. | `ecab383e936260c004fb2a3b96af3460367e711a1a94299f3f236e7d929cc721` |
| B, `rejected-stage-5-portal-b.png` | Same 4×3 leaf; cream portal x21–26,y44–47 remains 6×4. Header did not move up. | `3db8bd510c924f6225564a7c72a139717b2b36e53f55e41eefc92cee98cfb46f` |
| C, `rejected-stage-5-native-layout-c.png` | Editing a nearest-neighbour enlargement returned an opaque RGB checkerboard and edge-filling composition; not a valid transparent/chroma-key source. No normalization acceptance attempted. | `d799a6ba7e5affc8cb4e12a69b83b965c6bad9b709adb504cbfb92e2189e1578` |
| D, `rejected-stage-5-structural-portal-d.png` | Structural instruction raises the entrance header, but door extends below the main foundation and lower windows sample only one dark row. Fails fixed aperture and baseline composition requirements. | `9b9ed7df8874fd15f62d7781296022b37c9b46935df486df6e32c7f44b419f7d` |

All four candidates are AI-authored edits of this existing unique draft, not
procedurally painted geometry. Original generated outputs remain in the Codex
generated-images directory; copies above and saved prompts preserve provenance.

## Rejected normalization-only diagnostics

Experiments live only in `tmp/long-building-art/diagnostics/`; they are not
accepted source frames and do not replace this family's normalized files.

- Original frame `[133,168,1124,1076]`: adding only exterior background could
  improve portal sampling but removed lower-window/base rows. Rejected.
- A frame `[129,168,1121,1073]`: valid ≤2% outward margins, identical uniform
  scale plus nearest-neighbour mechanics; produces a taller portal but loses
  the lower-window second dark row and full-width last foundation row. Rejected.
- D frame `[110,147,1126,1073]`: valid ≤2% outward margins around visible
  `[128,164,1126,1073]`; runtime occupied 47×43 fails minimum height 44.
  Verifier correctly exits 1. Rejected without relaxing the contract.

Source D confirms the sampling failure directly: lower-left window source
pixel x290 is dark at y1016–1019, becomes an edge color at y1020 and cream at
y1021; the tight 48×44 transform samples the lower window's second row beyond
the dark body. Palette threshold changes cannot restore its missing geometry.

## Verification scope and next gate

Each viable chroma source was normalized and individually inspected at native
and enlarged grid scale. Raster checks alone passing is not visual approval;
the measurements above deliberately reject all candidates. No global build,
catalog registration, runtime publication, contract relaxation or production
write was performed. The original family remains `DRAFT_NOT_APPROVED`.

Parent decision is required for the next bounded authoring direction rather
than repeating nearly identical door-coordinate edits. Any new finished
source must independently satisfy the unchanged contract and receive native
visual approval before deriving stage 4 and then stage 3.

## Resumed source-only corrections E/F — still unapproved

Fresh original native inspection also found combined central/right window bodies4×2, outside the unchanged2–3×2 range. E replaced all8 paired strips with single small panes, while using the mechanically enlarged accepted Garden portal as a scale reference. With MAXCOVERAGE normalization, all8 panes now occupy2×2 at x8/23/38 and y36/40/44 (no bottom center), maintaining the4px floor pitch. Its leaf stays4×3, but its frame stays6×4; therefore E is rejected. MEDIANCUT's alternative quantization collapsed the small teal panes to gray and is not selected or accepted.

F used E as the primary image and the complete accepted Garden source as an entrance-only reference. It explicitly requested a taller/wider flat portal, but the result makes the frame6×3 and the dark leaf about3×2 instead. F is rejected too. Source/window/foundation dimensions were not repaired by code, and no common-frame scan or new tolerance was used. Both have the default frame `[133,167,1122,1067]`, native48×48/occupied48×44, hard alpha and0 enclosed transparent pixels. A clean raster report alone does not clear their failed door semantics.

| Draft | Source SHA256 | MAXCOVERAGE native SHA256 |
| --- | --- | --- |
| E | `3de5907ad95362e205815c243eaae682054242b1726ab34f9f61456ce5e85701` | `5b32327429ef2ba9855728de9d477159feb0afe9850f28f733ab5c76e9c56691` |
| F | `df1b67144de7de8f13451898c9b4e6ee8b0e2072cc512088682f2907757561ba` | `b5eb7631a4af1602054b6ca481658a1952cec633fb6fa8c42827e2c94e2bcdce` |

Sources `candidate-stage-5-e.png`/`candidate-stage-5-f.png` and prompts are preserved. Normalized diagnostics/previews remain in `tmp/long-building-art/diagnostics/rose-portal-e/` and `rose-portal-f/`; canonical original source/native/geometry are untouched. No reverse stages or publication. A genuinely different geometry-reference direction was proposed to the parent, rather than another nearly identical local door edit; not approved or executed at this checkpoint.
