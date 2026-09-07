# Extended compact buildings — integration checkpoint 2026-09-07

## Current state and scope

The local asset build reported by the main agent completed with asset revision `750f26edc463160e`: **35 registered building families / 175 building stages, 106 props and 510 PNGs** across `public/game-assets/v5`, including atlases. This checkpoint covers the **12 newly integrated families below**, not the whole historical catalog. They have approved separate AI-authored sources for stages **5 → 4 → 3** and **five published PNG stages per family** in the runtime and public packs. Their geometry metadata now uses the existing `APPROVED_SEPARATE_STAGES` convention.

This current integration record supersedes earlier “not published”/“pending publication” statements in these families' authoring checkpoints and visual-review scope notes. Those statements describe the earlier source-approval moment; failed candidates, prompts, source references and review hashes remain intentionally historical and unchanged. They are not runtime fallbacks. No pixels, frame, palette, dimensions, tolerance or approved source/runtime hashes changed during this metadata finalization.

**Not a production release.** The main agent reports that final post-metadata source, published-pack and style verification passed for all35 families, and the final48-case R3 map gate is GREEN. These test-run results are attributed to the main/QA agents, not a new test run by this document's author. The independent visual sample and the subsequent settled overview recapture are distinguished below. This document does not claim physical-device installed-PWA acceptance, performance guarantees, a deployment, or completion of every transport/service feature.

## Real-map R3 evidence and visual-review scope

[R3 evidence](../../screenshots/courtyard-art-48-final-r3/evidence.json) and the
[stage matrix](../../screenshots/courtyard-art-48-final-r3/stage-matrix-evidence.json)
record48 cases in the isolated66-task fixture:39 building-stage cases and9
park cases, at asset revision `750f26edc463160e`. The reports contain no errors,
failed requests or writes. This is the completed local R3 gate, not a claim that
all175 building PNGs were individually exercised in the map.

All four sampled native-pixel probes match exactly100%: picnic table141/141,
cycle rack42/42, square planter54/54 and the vertical building's stage3 interior
ROI3696/3696. These are explicit sampled comparisons, not a blanket pixel audit
of every screenshot. The existing reports retain the Playwright-blocked Service
Worker warning and driver `ReadPixels` warnings; they are not hidden as zero
warnings or evidence of physical-device PWA/background-push behavior.

This document's independent reviewer personally inspected21 saved R3 PNGs:
CITY and district overview; all3/4/5 frames for the horizontal gallery, vertical
wing, U court and Plum; garden5, Rose3 and corner court5; large park3 and community
park4; night CITY and COUNTRY. No actionable clipping, black interior holes,
covered target buildings, or building/road/neighbor-lot overlap was found in
that sample. The new structures retain readable entrances and roofless/partial/
finished progression. This is a scoped visual result, not manual approval of
every frame or a physical frame-rate guarantee.

The original R3 `planet.png` was **rejected** because the transition overlay
still covered the view. It remains historical failed evidence, not an approved
visual. A separate ready-state recapture subsequently passed:
[overview evidence](../../screenshots/courtyard-art-48-final-r3-overviews/evidence.json)
records zero transition overlays, the retained CITY canvas, exactly one read
each for CITY/COUNTRY/PLANET, and no errors or failures. The same independent
reviewer additionally inspected its three new images:
[PLANET](../../screenshots/courtyard-art-48-final-r3-overviews/planet.png),
[COUNTRY](../../screenshots/courtyard-art-48-final-r3-overviews/country.png) and
[night CITY](../../screenshots/courtyard-art-48-final-r3-overviews/city-night-clock-controlled.png).
The PLANET transition overlay is gone; its aperture is coherent, the visible
country matches the COUNTRY geography, and no new actionable visual defect
was found. This adds three settled images to the earlier21-frame sample;
it does not retrospectively approve the rejected original PLANET capture.

## Families and immutable geometry

All cells are 8px. Anchors are bottom-centre; all entrances face south. Native canvas sizes and physical lots are distinct from opaque sprite bounds. The per-family geometry and visual review remain authoritative; the table records the approved roof/front/floor rhythm rather than imposing a new global measurement.

| Family | Physical cells / massing | Native canvas | Anchor / south offset | Roof / front / floor step (px) | Door leaf / frame (px) |
| --- | --- | --- | --- | --- | --- |
| [`compact-long-gallery-v1`](../../assets/pixel-city-pack/reference/ai-authored/compact-long-gallery-v1/geometry.json) | 12×6; long east–west | 96×48 | 48,48 / 6 | 38 / 9 / 5 | 3×3 / 5×5 |
| [`compact-ivory-library-v1`](../../assets/pixel-city-pack/reference/ai-authored/compact-ivory-library-v1/geometry.json) | 6×6; square envelope | 48×48 | 24,48 / 3 | 31 / 14 / 4 | 4×3 / 7×5 |
| [`compact-corner-court-v1`](../../assets/pixel-city-pack/reference/ai-authored/compact-corner-court-v1/geometry.json) | 8×8; L massing; rectangular lot | 64×64 | 32,64 / 4 | 53 / 11 / 5 | 3×3 / 5×5 |
| [`compact-u-courtyard-v1`](../../assets/pixel-city-pack/reference/ai-authored/compact-u-courtyard-v1/geometry.json) | 12×8; U massing; rectangular lot | 96×64 | 48,64 / 6 | 53 / 11 / 4 | 3×3 / 5×5 |
| [`compact-garden-house-v1`](../../assets/pixel-city-pack/reference/ai-authored/compact-garden-house-v1/geometry.json) | 6×6; square envelope | 48×48 | 24,48 / 3 | 29 / 16 / 5 | 4×3 / 7×5 |
| [`compact-rust-loft-v1`](../../assets/pixel-city-pack/reference/ai-authored/compact-rust-loft-v1/geometry.json) | 6×6; square envelope | 48×48 | 24,48 / 3 | 30 / 14 / 4 | 4×3 / 7×5 |
| [`compact-sand-balcony-v1`](../../assets/pixel-city-pack/reference/ai-authored/compact-sand-balcony-v1/geometry.json) | 6×6; square envelope | 48×48 | 24,48 / 3 | 28 / 16 / 5 | 4×3 / 7×5 |
| [`compact-olive-cafe-v1`](../../assets/pixel-city-pack/reference/ai-authored/compact-olive-cafe-v1/geometry.json) | 6×6; square envelope | 48×48 | 24,48 / 3 | 29 / 17 / 5 | 4×3 / 7×5 |
| [`compact-rose-clinic-annex-v1`](../../assets/pixel-city-pack/reference/ai-authored/compact-rose-clinic-annex-v1/geometry.json) | 6×6; square envelope | 48×48 | 24,48 / 3 | 29 / 15 / 5 | 4×3 / 7×5 |
| [`compact-teal-mansard-v1`](../../assets/pixel-city-pack/reference/ai-authored/compact-teal-mansard-v1/geometry.json) | 6×6; square envelope | 48×48 | 24,48 / 3 | 30 / 16 / 5 | 4×3 / 7×5 |
| [`compact-long-slate-wing-v1`](../../assets/pixel-city-pack/reference/ai-authored/compact-long-slate-wing-v1/geometry.json) | 6×12; long north–south | 48×96 | 24,96 / 3 | 85 / 11 / 6 | 3×3 / 5×5 |
| [`compact-plum-workshop-v1`](../../assets/pixel-city-pack/reference/ai-authored/compact-plum-workshop-v1/geometry.json) | 6×6; square envelope | 48×48 | 24,48 / 3 | 28 / 16 / 5 | 4×3 / 7×5 |

The eight 6×6 authored identities use the existing apartment-shaped physical envelope; they are not eight new grid shapes. The four added envelopes are 12×6, 8×8, 12×8 and 6×12. The L and U architectural courtyards remain **opaque parts of their full rectangular lots**, not free infill space. Construction clearance remains one cell. Registering a family does not itself replace persisted parcel layouts or expand a task's footprint.

High45 means the established roof-dominant frontal-top art convention: horizontal/vertical edges, not an isometric rotation or a receding side wall. Each approved family keeps its fixed doorway, source transform and foundation registration across stages; disclosed one-native-pixel masonry/opening/perimeter variation is recorded in its review, not called exact pixel identity. The vertical slate wing's reviewed unfinished roof is approximately44%, accepted as roughly half; coverage is semantic and family-reviewed, not silently rounded to50%.

## Runtime stages and catalog limits

- **Stage0:** reserved slot/outline; not an extra authored PNG.
- **Stages1/2:** published construction-kit thumbnails at the family's native canvas size; the live map composes the full site, fence/gate and stage2 equipment within the protected lot. These are not newly AI-authored finished buildings.
- **Stage5:** finished building, reviewed first.
- **Stage4:** same unfinished shell/entry, dark openings, approximately half the roof and no final rooftop equipment.
- **Stage3:** roofless opaque room floors/partitions and visibly partial upper structure. Physical floor depth is preserved; assembly is not a blanket sprite-height reduction.

All 12 entries are `HOUSE`, `STONE`, `STANDARD`, with `serviceRole: null`, `maxPerCity: null` and `maxPerDistrict: null`. Library/clinic/cafe/workshop words identify art, not an automatic medical/civic/service allocation. Null catalog caps do not bypass available slots, reserved envelopes or world bounds.

| Selection class | Families | Estimates |
| --- | --- | --- |
| COMMON | `compact-ivory-library-v1`, `compact-garden-house-v1`, `compact-sand-balcony-v1`, `compact-olive-cafe-v1`, `compact-rose-clinic-annex-v1`, `compact-plum-workshop-v1` | 1, 2, 3, 6 |
| RARE | `compact-long-gallery-v1`, `compact-corner-court-v1`, `compact-u-courtyard-v1`, `compact-rust-loft-v1`, `compact-teal-mansard-v1`, `compact-long-slate-wing-v1` | 3, 6 |

Sources3–5 are independently AI-authored edits with saved provenance. Their normalizer uses one stage5 frame for all stages, aspect-preserving nearest-neighbour sampling, hard alpha and the declared bounded palette/background recovery only. Palette budget is at most32 colors including transparency. Individual review records and exact aperture helpers remain necessary; a clean bounding-box report alone does not prove correct door/window or construction semantics. See [compact art contract](COMPACT-BUILDING-ART-CONTRACT.md).

## Hash-pinned publication evidence

Read-only cross-check for this checkpoint verified all36 source hashes against both catalog and accepted visual-review records, all36 normalized3–5 PNGs against runtime bytes, and all60 runtime stage PNGs against public bytes. Every listed family has five manifest stage paths. It did not rerun a build or heavy test suite.

Catalog SHA256: `d1b4da399a32d970566dd1befa133f2a5726fa10be87f3a27aab678923ccac95`.

Manifest SHA256: `62488a7571f4ab092da2220de8bd94c7498cd74f61e79408727c4fd3dfeb9525` (asset revision `750f26edc463160e`).

Paths use `assets/pixel-city-pack/reference/ai-authored/<family>/sources/stage-N.png` for authored sources and `assets/pixel-city-pack/runtime/buildings/house/<family>/stage-N.png` for the published pack; public bytes are at `public/game-assets/v5/buildings/house/<family>/stage-N.png`. The runtime hash for3–5 is also the normalized PNG hash.

### compact-long-gallery-v1

| Stage | Approved source SHA256 | Published runtime / public SHA256 |
| --- | --- | --- |
| 5 | `c3a8ca83de401e40ee0a2670757d86badb2036a8bec1e4b4e2b7d0e9d690ca4e` | `98f6233bee2f1cdc466d5123fb2fff82e220ce044ecae64a749ba045bfc33d72` |
| 4 | `ec7cb49787412048a4feb909b16c5c9ec037b625549e3c43fe41b1c06a1cd572` | `f51d320ae26a5964f5fe48b7255c471d59da1c5ab3bdca78dd585fcd047e1fc1` |
| 3 | `38ff5e1f8d1282e9f7cfcddb8f54ee044a897ca45c3694a1ade1ba99f859b9c2` | `6eb74e25e2fd8bb79430676ba49244188f6f688681ad0385c917d57267173b7e` |
| 2 | Construction kit; no separate AI source | `82150f204f5cc9808e0dc2c080463d5c1df26900327deb443cd7b52f5841609e` |
| 1 | Construction kit; no separate AI source | `f467e00bf5b395510c6b24ac579b8f404e250f6c9cf0777e6eb4b77d167d12a7` |

### compact-ivory-library-v1

| Stage | Approved source SHA256 | Published runtime / public SHA256 |
| --- | --- | --- |
| 5 | `9112c57e86a3687f8422fd5397e9698e5d2045a1e68b66fca98e96fb27110bdc` | `cdde6e7be4cbbeb04df21d3e92909f93612b899dc5c6f159af5a096f24f85ac9` |
| 4 | `9e3c332891314b475c89d2e88b72dc699b06178cdd32c8de99e77992608f8de9` | `213c00b6173741beb9a62794f96c154861f3b25ff21a7128af8e9fc77e4706a5` |
| 3 | `bed4b128ea8bec66183c87cd572a53c1661c53bff0377844159b0a8ec8b74500` | `9661833dded63afcdba3207157b557ee58c0044b9ff5506c9c75d0cfc71358b9` |
| 2 | Construction kit; no separate AI source | `bf0a9e04a1a881666b9901922b617399a679211f164bfd01085cd7069dbcee97` |
| 1 | Construction kit; no separate AI source | `dcd9198034a96c85bc9f4be1705c936c509cab31217fb926c025618d4f464cd4` |

### compact-corner-court-v1

| Stage | Approved source SHA256 | Published runtime / public SHA256 |
| --- | --- | --- |
| 5 | `e96727be1bdebaec1d089de9e06846ed2ba07ccb586c166d200f1a53443a4044` | `30d6588186da59da3afd31d4f36ca21d72347bbcb5197da633d993be5ba15ac0` |
| 4 | `e512a8713dea27b20f36d49342f8dec637736c8d53af21e36fc716a02610822b` | `839e5dc0f03d598dfcd75f5c1fae7a676d59176851698ecd75df8b99d08a22e0` |
| 3 | `0d21c151608212598bd955cd12c684abe6e593cf92b44e78d872e442ecae7c41` | `33315045ad4d827011496f732c91a7a8b7587bdfc21c3afbd7ffdf12e89d604b` |
| 2 | Construction kit; no separate AI source | `14e6b71745ad1aced26fe6bcd6c52727c6a8023342d156b6a1633aa1d7e6fd09` |
| 1 | Construction kit; no separate AI source | `f21196d05a7ac78a831105baad168836c0125d8c6298e01a5e82f9a436c9acdd` |

### compact-u-courtyard-v1

| Stage | Approved source SHA256 | Published runtime / public SHA256 |
| --- | --- | --- |
| 5 | `2aa115e5c9384e61efe57827f65c5499197dea1122f9d8456859ef000dedd1c6` | `394021ea3d037d63c586a819a205261d5f9936cffb4ff8ee07cba6ed099284b1` |
| 4 | `7919945cbef2b7ded72211b9ae3e71125da67b2590eba955aa503df3dc628d56` | `6550cf19d8709537333179f6436d0ee4e576d79260ae88fac36ba3d0b3e2fa27` |
| 3 | `2c81a30f2f2564dfb9be2173c6706896abdbef0efd1d848a7d0f102ac5002cc4` | `3f559853437954d3fc7903a0c2ab079402ac3c02bd569e12ed71428b1be9308b` |
| 2 | Construction kit; no separate AI source | `1d75376a12142ea6ad3a65ece51934cea28ca4d459ad8cf30d232d05c980ddd7` |
| 1 | Construction kit; no separate AI source | `59b1c8131d6df852b43586605f01339abe33cf14b9217eb691530a48c46a2134` |

### compact-garden-house-v1

| Stage | Approved source SHA256 | Published runtime / public SHA256 |
| --- | --- | --- |
| 5 | `963f90cdb5220a68b5c9a1813d6d5e57bc1898181733abc9f28214b41c65c484` | `6345738ba36ae28cd77a46363b3cad7a0172c24d04af2edff1fecf7bf5ebe98d` |
| 4 | `f5b2560aca459b02158f5b3418b8d96b6715fbb2cab4940bc9d79a006831d0ba` | `882763574b5a53e15a8ecffe3064c9161b3c6bcf0642d7f75b9f5c9ff12d57a9` |
| 3 | `6630e25bfda1b24b0bbecbda2605a52d5b6fdbcac199b8f755822c891c8ac40f` | `99569a89decbf9ca1d6589e96b92f732ec936aee107e29b9f8617ee388ed119c` |
| 2 | Construction kit; no separate AI source | `bf0a9e04a1a881666b9901922b617399a679211f164bfd01085cd7069dbcee97` |
| 1 | Construction kit; no separate AI source | `dcd9198034a96c85bc9f4be1705c936c509cab31217fb926c025618d4f464cd4` |

### compact-rust-loft-v1

| Stage | Approved source SHA256 | Published runtime / public SHA256 |
| --- | --- | --- |
| 5 | `4630de22ad6eee6c5bf273c327b6be936ddd4f6451b8760bc1439fb4e4333102` | `27b8eaa21d168277b8f9fdf6fe9d472ef1a9e8bd50255f2d583adeac15d04d19` |
| 4 | `ac6b136c1722c4ac0ab7eacfc4de4b60bed60b59ec107d81363dc49107bc8c2d` | `bfb7daf2c5ad196f60a300d682f1946dd1b9df75e9245da7c860ae907184d323` |
| 3 | `03324a2bf12c4a06a2faf1f48a76b15e1531f070ef01dc3adca99a83be3f019b` | `130d76793395dfcae09add458d54ad1c8e67458099a6a20f2c8ebe7df0561506` |
| 2 | Construction kit; no separate AI source | `bf0a9e04a1a881666b9901922b617399a679211f164bfd01085cd7069dbcee97` |
| 1 | Construction kit; no separate AI source | `dcd9198034a96c85bc9f4be1705c936c509cab31217fb926c025618d4f464cd4` |

### compact-sand-balcony-v1

| Stage | Approved source SHA256 | Published runtime / public SHA256 |
| --- | --- | --- |
| 5 | `f8564996afceaa76935ab815b24ca3c8285db613bf49ef49de1dd96fc07af805` | `84a7410435697185516442f344da3387ab2ac11cc0a767c81d3422b5f31218db` |
| 4 | `23e253f14895d80c806505644ae8545981609364bb278f8db51dcf7df9ee8a27` | `90d9a7281348afd50672943872b7ce5cdd90ebd6c67acafb401e243b6ad14902` |
| 3 | `1f7debe239526f949bd4bc1560657742ba092f0ad68c06d8a7ba4bd0a9316066` | `e1cc1a8bfb24ca20ef3982535768f8947ed1cd8f8f4fd88f06eea9aea3e538ad` |
| 2 | Construction kit; no separate AI source | `bf0a9e04a1a881666b9901922b617399a679211f164bfd01085cd7069dbcee97` |
| 1 | Construction kit; no separate AI source | `dcd9198034a96c85bc9f4be1705c936c509cab31217fb926c025618d4f464cd4` |

### compact-olive-cafe-v1

| Stage | Approved source SHA256 | Published runtime / public SHA256 |
| --- | --- | --- |
| 5 | `86750cbaf33815aca72fb126764cbdb7abcac452c8079f1c8e6d9cd6cc21b14a` | `b24696098cedc28a986983cdc2d2e92eb303cb7555cd36aa94c86aaa554120f2` |
| 4 | `6ab832636728dd855129bcb1dcd09e90bcf68a57babf5b69486c15af08d53308` | `593142a4ca832ca27c2950350c50dd1f828a5635eeac5a628432030a6e2ffba5` |
| 3 | `60438bf0459eda540547df0faffe3cda555955ff751e8118a6a032039064e141` | `da510adb36a55f93b61cdb3edc45bb8b90df8b9cf679893aa7ee5ab95b9e18e3` |
| 2 | Construction kit; no separate AI source | `bf0a9e04a1a881666b9901922b617399a679211f164bfd01085cd7069dbcee97` |
| 1 | Construction kit; no separate AI source | `dcd9198034a96c85bc9f4be1705c936c509cab31217fb926c025618d4f464cd4` |

### compact-rose-clinic-annex-v1

| Stage | Approved source SHA256 | Published runtime / public SHA256 |
| --- | --- | --- |
| 5 | `0e72c300f51c02f6a146aacacc453a5afade9e1fee4385d0645895a4ee5e2d83` | `b2f53e5a2cb000c06e56b3e6261a1dffdd4bfcfc79766bd3dfcb2352a4829c12` |
| 4 | `4f57f9f6d68ae698e267d762ca09551e63d66baafc6406e58767ad340e731106` | `4011055419f1f7043dbd994ac0ef7f55e643921dbad6e8efbadac3ab768d4307` |
| 3 | `8bd4b646e5031b12eb85fb06526586c5d672e9f39b3356816a4bf1a1400f48d5` | `88025dc3ce20b8b1856bdcfb3aaf097e9ad3282800d280dfc463224288e86111` |
| 2 | Construction kit; no separate AI source | `bf0a9e04a1a881666b9901922b617399a679211f164bfd01085cd7069dbcee97` |
| 1 | Construction kit; no separate AI source | `dcd9198034a96c85bc9f4be1705c936c509cab31217fb926c025618d4f464cd4` |

### compact-teal-mansard-v1

| Stage | Approved source SHA256 | Published runtime / public SHA256 |
| --- | --- | --- |
| 5 | `7bc85125a3c218bde1bccd68207371c77823858550faa8a5644aa72983803344` | `69e9d2f81448cc12cea5ea22deadc868d550ad15c5364b7eb31c24b45c6e0d26` |
| 4 | `b00ba75e082c89741accff56a2b6930015a168173e238c99b31f58a686cecf0c` | `a5c6b3ba771fc5f7bdcd962eeb02c109407f0e27d506e2d1c898e1fac17de74c` |
| 3 | `428ac32d8891c60e9d978a67ee510cf0fe46ac642fb3a53f6f7a14ad8bc6eb01` | `4e8ffff61c4e27adcc94fed63d527eb52c56db634f3adb541c3879e54d9b1b16` |
| 2 | Construction kit; no separate AI source | `bf0a9e04a1a881666b9901922b617399a679211f164bfd01085cd7069dbcee97` |
| 1 | Construction kit; no separate AI source | `dcd9198034a96c85bc9f4be1705c936c509cab31217fb926c025618d4f464cd4` |

### compact-long-slate-wing-v1

| Stage | Approved source SHA256 | Published runtime / public SHA256 |
| --- | --- | --- |
| 5 | `415a5d24cec09969854fe7b75148d1a7e3d3ff1722c70139d6b7f24e7141abb2` | `f4124e03302d063f0e37e718a7c1ceb936d49bdb487b5755f7c6d7fce76c7551` |
| 4 | `287bbb63b6154dcbd14498f3828d008bcb7d84e6b30446fd0b976dcaf4870795` | `236a100abc1b960c7cbf95410fcfb550bd9b9c186ca8d3abcde458294bb86b1a` |
| 3 | `99827c9855248f033ece14dd19a6f6566a71a6e28c1e5755f7e60665a54511e5` | `0c05fb4870dfd41a3ada9798a3dea157110353c963b5a99c6f108ff467cb9d3d` |
| 2 | Construction kit; no separate AI source | `f602953c768b4384962ef3eb55ed92a0ab21ff80f946577c8b648186b7a66abc` |
| 1 | Construction kit; no separate AI source | `ef156242b2302fa17b8e85d074900bfc0d81e534da39727f5e5606b543d7197d` |

### compact-plum-workshop-v1

| Stage | Approved source SHA256 | Published runtime / public SHA256 |
| --- | --- | --- |
| 5 | `9a22c025bbb4f83f05a067045ec6e47b7cda6793b8629d23d11131819fb42492` | `ed5dbcaee9240b1d09f9a372efb5490d6645f28e414e7e0a41521ea75859ac63` |
| 4 | `c3648c04e8a20fdfeeba7ba70bf711475fc7a64ab2a2ebe453ad97de95e8a884` | `50c0184cd9bd7ec0c3b278109a48f502e4ec04a68f10fe1d46912dee6f1f78bd` |
| 3 | `1d4387f1a8ad766410943a6733fd77c08c4d14358257189e63f2c6a6ff756ab1` | `21bc4fdc03668b36f0031582628a54d19e92682d4250b6ad52058f285423622f` |
| 2 | Construction kit; no separate AI source | `bf0a9e04a1a881666b9901922b617399a679211f164bfd01085cd7069dbcee97` |
| 1 | Construction kit; no separate AI source | `dcd9198034a96c85bc9f4be1705c936c509cab31217fb926c025618d4f464cd4` |

## Follow-up gates

The main/QA agents have reported final asset verification PASS, R3 GREEN for48 cases and the passing scoped overview recapture. The main agent owns the remaining integrated release gates and any later deployment decision. Physical-device installed-PWA/background-push acceptance and production release are not supplied by this local fixture. Historic failed or unpublished intermediate files remain provenance; no such file is approved by this document.
