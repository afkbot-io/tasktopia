# Исходники атласа V2

Изображения созданы для задачи Tasktopia № 2 25 августа 2026 года с помощью
OpenAI ImageGen. Образцами стиля служили принятые ресурсы ландшафта, транспорта
и атласа Tasktopia V5.

- `planet-terrain-hexes-v2.png` — восемь ортографических шестиугольников: трава, луг, лес, холм, гора, побережье, река, камень.
- `aircraft-topdown-v2-frame-1.png` — восемь самолётов, направленных на восток для движения SVG с `rotate=auto`.
- `aircraft-topdown-v2-frame-2-reference.png` — вариант анимации пропеллеров и огней.
- `clouds-topdown-v2.png` — восемь силуэтов облаков с пониженным контрастом.

Исторические ресурсы находятся в каталогах `terrain-v2`, `terrain-v3`,
`aircraft-v2` и `clouds-v2` внутри `public/game-assets/v5/atlas/`.
Текущий ландшафт создаёт `scripts/build-atlas-terrain-v4.py`: наборы для уровней
`CITY` (`8×8`), `COUNTRY` (`16×16`) и `PLANET` (`8×8`).

После изменения выполните `python3 scripts/verify-atlas-assets.py` из корня проекта.
