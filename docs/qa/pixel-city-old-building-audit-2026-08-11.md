# Аудит старых зданий и окружения — 2026-08-11

## Результат

- В каталоге остаётся 193 семейства зданий: 158 используют принятый AI-authored пятистадийный источник.
- Четыре здания Государственного архива — отдельные импортированные спрайты; их площадки, ограждение и подъезд проверяются отдельным архивным контрактом.
- `landmark-monument` переведён с плоского legacy-фасада на существовавший качественный пятистадийный AI-authored лист. Старый дублирующий файл удалён.
- 31 семейство ниже остаётся визуально слабее новой графики. Они не помечены `reviewed` и не считаются завершёнными до индивидуальной AI-перерисовки и native/8× проверки.
- Принудительная асфальтовая площадка постоянных зданий удалена: рендер использует `platform` из каталога (`YARD`, `STONE`, `ASPHALT`, `SERVICE`, `PARK`).
- Парки, остановки, деревья, транспорт и новые жители просмотрены отдельными contact sheet; блокирующих несовпадений ракурса у принятого набора не обнаружено.

## Очередь AI-перерисовки

### Civic

- `civic-library`
- `civic-fire-station-compact`
- `civic-police-neighborhood`
- `civic-museum`
- `civic-university`
- `civic-embassy`
- `civic-transport-hub`
- `civic-waste-station`
- `civic-power-substation`
- `civic-memorial-hall`
- `civic-youth-center`
- `civic-kindergarten`
- `civic-secondary-school`
- `civic-vocational-college`
- `civic-research-lab`
- `civic-public-library-modern`
- `civic-health-center`
- `civic-emergency-center`
- `civic-fire-station-large`
- `civic-police-headquarters`
- `civic-train-station`
- `civic-metro-entrance`
- `civic-waterworks`
- `civic-recycling-center`
- `civic-sports-center`

### Landmark

- `landmark-concert-hall`
- `landmark-botanical-dome`
- `landmark-space-center`
- `landmark-grand-station`
- `landmark-civic-arch`
- `landmark-lighthouse`

## Gate для каждого семейства

1. Один исходный PNG-лист с пятью честными стадиями строительства.
2. Строго фронтально-верхняя камера без видимой боковой стены и перспективного схождения.
3. Одинаковые основание, масштаб и камера во всех пяти стадиях.
4. Проверка после нарезки в native и nearest-neighbour 8×.
5. Сверка `spriteSize`, footprint, anchor и catalog platform на реальной карте.
6. Только после прохождения gate — `reviewed: true`; прежний источник удаляется после регистрации нового.
