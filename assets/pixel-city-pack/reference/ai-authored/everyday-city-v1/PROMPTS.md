# Повседневный транспорт и предметы города

Производственный brief для принятых источников built-in ImageGen. Это описание
ограничений и принятых изображений, а не дословная копия утраченных текстов
генерации. Источники и их SHA256 сохранены в `normalization.json`.

Общий стиль: спокойный cartoon pixel art существующего Tasktopia, верхняя
камера micro-ambient, вид сверху на крышу транспорта, компактные цветовые
кластеры, тёмный зелёный/сланцевый контур, охра/крем/приглушённый teal.
Прозрачный фон, без надписей, теневого ореола и декора вокруг субъекта.

| Источник | Принятое изображение |
| --- | --- |
| `sources/bus.png` | Городской автобус в четырёх независимо нарисованных направлениях. Крыша/окна читаются сверху. Первый боковой профиль отклонён и не опубликован. |
| `sources/school-bus.png` | Тот же масштаб; школьный автобус с охристой крышей, четырьмя authored направлениями. |
| `sources/tow.png` | Эвакуатор с пустой платформой и четырьмя направлениями. |
| `sources/tow-loaded.png` | Редактирование принятого эвакуатора: машина на платформе. Привязка к рамке пустого состояния сохранена. |
| `sources/child-v2.png` | Активная коррекция через встроенный ImageGen по эталону `people-v2.png`: большая плоскость головы сверху, короткий охристый корпус, teal-рюкзак; четыре независимых направления с одной native рамкой3×4 `[2,2,5,6]`. `child.png` — отклонённая при повторном аудите историческая версия. |
| `sources/market-stall.png` | Один небольшой прилавок с тканевым козырьком, опорами и продуктами; перспектива принятой городской мебели. |
| `sources/umbrella.png` | Один раскрытый зонт сверху без человека; спокойные ochre/teal сегменты. |

В четырёхнаправленных листах порядок клеток: сверху north/east, снизу
south/west. На этапе публикации разрешены только extraction, hard alpha192,
один равномерный NEAREST scale и сокращение палитры. Геометрия кодом не
перерисовывается, направления не зеркалятся и не вращаются.

Транспорт: холст8×8, силуэт до4×6 или6×4; ребёнок — ровно3×4 во всех направлениях, прилавок16×16
(видимый14×12), зонт8×8 (видимый6×6). Транспорт/ребёнок/зонт используют
Sprite anchor4,4; стандартный prop manifest сохраняет anchor4,8. Прилавок
использует нижний центр8,16. Физическая оболочка транспорта остаётся обычной
micro-car, ребёнка — консервативной оболочкой взрослого: новые изображения
полностью помещаются внутри них. Зонт — декоративный слой над человеком.

Проверка: `scripts/everyday_city_art.py --verify`; whole-pack audit дополнительно
восстанавливает PNG из источников, сравнивает runtime/public/atlas по пикселям,
проверяет четыре разных authored ориентации и нативные границы/alpha/палитру.
`preview-native.png` и `preview-8x.png` — только материалы ревью.

Коррекция ребёнка, 2026-10-08: использованы camera/style reference `people-v2.png`
и отдельный child draft. Принятый второй запрос требует квадратного листа2×2,
overhead hair plane на верхних двух native рядах, короткого корпуса и контакта
без длинных ног, без полноценного фронтального лица, крупных цветовых плоскостей,
чёткой охристой куртки и одинаковой регистрации. Первый draft остался слишком узким
и не опубликован. Геометрия кодом не дорисовывалась; применён прежний равномерный
NEAREST transform, hard alpha и palette reduction. Полный повторный аудит:
`docs/QA-SPRITE-PROJECTION-2026-10-08.md`.

Сохранённый prompt принятой коррекции (image1 — `people-v2.png`, image2 —
отклонённый первый child draft; метод — built-in ImageGen, transparent background):

```text
Correct image2 (four child headings) to MATCH the extremely overhead compressed game people in image1. OUTPUT SQUARE IMAGE, FOUR EQUAL SQUARE CELLS 2x2, north/east/south/west in reading order. The current child is STILL TOO TALL AND NARROW. IMPORTANT: replace its upright doll body with a WIDE SQUARE OVERHEAD HAIR PLANE and TINY COMPRESSED BODY BELOW. Each entire child must be 0.75 times as wide as it is tall, e.g. visible width240 and height320. HEAD/Hair visible plane is a broad nearly rectangular240x190px square plane occupying60% of total height. Compressed warm OCHRE jacket80px high. Only a40px dark contact at bottom; NO LONG LEGS. In south view a VERY THIN cream strip is squeezed beneath the head, not a full face. North a teal backpack is a broad small cluster on the compressed short coat; east and west are still overhead head surfaces, NOT upright side portraits. Four separately DRAWN orientations, no rotation or mirror. SAME EXACT occupied width/height and registration in all four cells, like image1 adults. Keep the simple brown-hair/ochre-jacket/teal-backpack child identity. Strong warm ochre color must occupy a broad clear jacket row in each view and remain visible after reduction. Extremely simple block pixels, not smooth contours: this will be sampled to EXACTLY3x4px inside 8x8px canvas, so build simple LARGE color planes (head two rows, short jacket one row, contact one row). Match reference1's large overhead head and single short lower band. Upper-left lighting, subdued urban colors, hard alpha actual transparent background. No frontal full face/portrait/full legs, no text, no background, no baked shadow, no decorative detail. Need much wider head and much shorter body than image2 while preserving whole-child width:height3:4 ratio.
```
