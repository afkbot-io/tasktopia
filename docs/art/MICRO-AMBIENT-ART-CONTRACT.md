# Native top-down micro ambient

The accepted profile is `TASKTOPIA_MICRO_TOPDOWN_CARTOON_V1`. It replaces the
large frontal passenger vehicles, walkers, activity people and animal gait
families. Do not restore their old minimum sizes, mirrors or animation cycles.
Buildings, trees and fire/smoke effects retain their separate contracts.

| Subject | Native canvas | Visible envelope | Authored views |
| --- | --- | --- | --- |
| Car | 8×8 | 6×4 east/west; 4×6 north/south | Four compass views for blue, red, taxi, van |
| Person | 8×8 | Exactly 3×4 at `[2,2,5,6]` | Four compass views for ochre and teal; source revision 2 |
| Animal | 8×8 | 4–6×6, distinctive head/body/ears/tail | One static pose per eight species |
| Aircraft | 16×16 | At most 12×12 | Four compass views of one regional aircraft |

Use muted square cartoon clusters, a roof/head-dominant overhead camera,
upper-left light, hard alpha and at most eight opaque colors. Native CITY
anchors are canvas centers, not upright foot anchors. No black floor line,
smooth shading, gait frames, wheel overlays, wobble, whole-sprite rotation or
mirrored direction substitution. Static animals may move on the graph but
never animate a walk cycle. CITY traffic uses the actual 6×4-pixel body centered
on its assigned road lane. Old bus and rider spawning is retired.
Incident response also uses the red micro car, facing west on an 8×8 canvas
with its native 6×4 body. Its one-pixel beacon and hose attachment stay on that
body; the retired large fire-engine props must not return as fallback art.

People keep the same visible registration in all directions. The fixed native
canvas anchor is `[4,4]`; the odd-width opaque box has center `[3.5,4]` in every
view, rather than shifting independently on turns. A 3×2 south silhouette or
an equally sized body shifted by one pixel is rejected, even with valid hashes.
North/south differ by their lower color cluster; east/west retain authored side
cues. Do not add facial detail that cannot survive native sampling. Bright
ochre clothing must remain recognizable in every heading.

The AI-authored source sheets, reviewed source hashes and normalization
provenance live in `assets/pixel-city-pack/reference/ai-authored/micro-ambient-v1`.
Read its `PROMPTS.md` for exact source cell order and generation constraints.
Normalize only by chroma removal, declared cell extraction, aspect-preserving
nearest-neighbor resizing and palette reduction. Do not redraw a source with
code or shrink a retired large sprite to impersonate this family.

People revision 2 uses `sources/people-v2.png`; the original `people.png` is
retained as historical evidence, not an active fallback. North/south and
east/west came from separate AI correction passes. Their unchanged cells are
packed into one sheet with exact crops, input hashes and output hash recorded
in `people-v2-provenance.json`. The verifier reconstructs that packing and
compares its pixels; code does not repaint, mirror or stretch the subjects.
`scripts/build-micro-ambient.py --draft-people-source <png> --draft-directory <dir>`
produces an isolated native preview. After approval, `--build --family people`
normalizes only that family, preserving the other 28 sprites and catalog
entries. The selected set is validated before any PNG is replaced. Run
`npm run assets:build` and `npm run assets:verify` to publish and audit the pack.

`src/shared/micro-ambient.ts` is the runtime lookup and preload API;
`micro-ambient-manifest.json` is the native authoring fragment merged into the
published pack. `scripts/verify-micro-ambient.py` blocks stale hashes, wrong
canvases, alpha/palette/envelope drift, invented gait frames and old fallback
catalogs. Both whole-pack audits also invoke this contract. Review the native
and integer enlarged contact sheet at `screenshots/micro-ambient-v1.png`.

CITY receives `CitySceneDto.airportConnections`: at most eight directed routes
between completed, actively placed airport tasks in the same country, with at
least one endpoint in the selected city. One airport in each of two cities is
enough. Every map level derives the endpoint from the physical airport-slot
center, never the center of its whole block. CITY follows the shared smooth
flight curve and selects an authored compass image from its tangent, without
rotating the sprite. Takeoff/landing scale is the explicit exception to native
integer display scale: it grows from 0.05 to 1 and shrinks at the destination.
COUNTRY/PLANET may abstract aircraft size and smoothly orient their map-level
representation, but their endpoints must also remain completed airports.
Random viewport-edge flybys are not a substitute for transport infrastructure.
General flower/stone/reed scatter is terrain detail, not thousands of sprites.
Explicit flowers inside a staged park task remain intentional park content.

## Грузовой вертолёт кинематической сцены

Отдельный профиль `TASKTOPIA_CARGO_HELICOPTER_TOPDOWN_V1`: холст32×32,
видимый силуэт до24×24, четыре самостоятельно нарисованных направления,
8 общих непрозрачных цветов и hard alpha. Это тяжёлый транспорт переноса
задачи, поэтому он крупнее обычных пассажирских micro-aircraft16×16.
Источник и проверка: `reference/ai-authored/cargo-helicopter-v1`,
`scripts/cargo_helicopter_art.py --verify`. Прозрачные пиксели канонизированы
в RGBA0,0,0,0; prop atlas совпадает с каждым отдельным PNG побайтно по пикселям.

Manifest сохраняет стандартный prop anchor16,32. В воздухе Sprite использует
центр холста, а тросы привязаны к реальной верхней границе старого здания.
Все направления выбираются по имени, без runtime rotation/mirroring;
самолёт и существующие люди/машины не заменены и не масштабированы под груз.

## Повседневная жизнь города

Профиль `TASKTOPIA_EVERYDAY_MICRO_V1` добавляет22 authored кадра: автобус,
школьный автобус, пустой/загруженный эвакуатор и ребёнок в четырёх направлениях,
прилавок и зонт. У транспорта остаётся штатная физическая оболочка4×6/6×4.
Ребёнок визуально меньше взрослого, но использует его консервативную
физическую оболочку. Ориентация выбирается по имени без runtime rotation.

Все micro-акторы используют центр холста4,4 и целый экранный pixel scale.
В prop manifest сохранён стандартный нижний anchor4,8, как у грузового
вертолёта; actor renderer явно задаёт центр. Прилавок16×16 имеет anchor8,16,
полностью свободную площадку2×2; зонт8×8 привязан к существующему жителю.
Новое население для сцен не создаётся. За посадку/высадку отвечает общий
mobility controller, а atlas предоставляет только изображения.

Источники, brief, hashes, нормализация и review:
`assets/pixel-city-pack/reference/ai-authored/everyday-city-v1`.
`scripts/everyday_city_art.py --verify` проверяет восстановление кадров;
whole-pack audit сравнивает runtime/public/atlas по пикселям. Звуки по
умолчанию выключены; reduced-motion отключает сценки и погоду.
