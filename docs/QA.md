# Проверка релиза

## Закрытая регистрация

1. Запустить production-конфигурацию с `REGISTRATION_ENABLED=false`: на анонимном
   экране должна остаться только форма входа, а `POST /api/auth/register` должен
   вернуть `403 REGISTRATION_DISABLED`.
2. Создать пользователя через `docker compose exec app npm run user:create --
   --email ... --name ... --country ... --city ...`; пароль должен дважды
   вводиться без отображения и не появляться в выводе или process arguments.
3. Войти созданным пользователем и проверить названия первой страны и города.
4. При `REGISTRATION_ENABLED=true` открыть форму регистрации: два password-поля
   обязательны, несовпадение не отправляет HTTP-запрос, совпадающие значения
   проходят повторную серверную проверку.

## Жители и глубина мира

1. Открыть малый тестовый мир (`npm run seed:test`) и приблизить карту до DETAIL.
2. Убедиться, что у идущего жителя различаются три authored-фазы ног во всех
   четырёх направлениях и цикл возвращается через среднюю позу; при остановке кадр не меняется, а pan/zoom не начинает
   цикл заново.
3. Проследить проход жителя возле фасада, дерева и светофора. Перекрытие должно
   зависеть от точки ног: объект ниже по экрану рисуется впереди.
4. Дождаться разговора двух жителей. Белая реплика находится над головой,
   не вращается вместе с телом и остаётся выше зданий и светофоров.
5. Запустить `python scripts/verify-agent-animations.py --gif-dir tmp/agent-gifs`:
   отчёт должен содержать `42` семейства, `126` кадров и `valid: true`.
6. Просмотреть GIF для `walker-east`, `cyclist-horizontal` и
   `animal-sheep-east`: фон полностью прозрачный, центр тела не прыгает,
   велосипед/овца не теряют массу в кадре B, запад является точным зеркалом.

## Транспорт

1. Наблюдать регулируемый перекрёсток с плотным потоком не менее двух минут.
2. При занятой полосе после перекрёстка следующая машина должна остаться перед
   стоп-линией, даже если её сигнал зелёный.
3. Проверить telemetry на `.world-canvas`: `data-traffic-unsafe-pairs="0"`,
   `data-wrong-way-cars="0"`, `data-wrong-way-buses="0"`,
   `data-vehicle-animation-frames="4"`.
4. Автобус должен появляться только на семиклеточном collector/arterial/highway и занимать внешнюю travel-полосу, не shoulder и не трёхклеточную median; local `3` клетки автобусов не принимает.
5. Остановить машину или автобус красным сигналом: кузов должен перейти в стабильную нулевую фазу без bob, rotation и изменения масштаба; после старта четыре фазы повторяются по пройденной дистанции.
6. Открыть горящее высокое здание: пожарная имеет canvas `40×16`, не выглядит
   тоньше легковой машины, стоит целиком справа от фасада; струя начинается
   толстой у сопла, сужается у огня, её блики и брызги меняются между кадрами.

## Атлас и городская композиция

1. Открыть атлас страны: terrain закрывает экран квадратными блоками без зубчатого нижнего края; полноразмерные PNG зданий в Network не запрашиваются. Ответ `/api/countries/:id/atlas` имеет `schemaVersion: 4`, содержит `terrainSeed` и не содержит `macroTerrain`/`cutoutTerrain`.
2. Убедиться, что дороги тоньше фасадов, а дома остаются читаемыми footprint-aware миниатюрами при любом размере исходного sprite. В плотном городе должны присутствовать скатный, плоский, ступенчатый и квартальный профили; высотки не образуют перекрывающую дороги колонну, палитра домов спокойнее границы активного района и подписи города.
3. Открыть большой город: камера показывает квартальное окно, а не всю пустую территорию. В глубоком новом районе есть несколько связанных рядов улиц, явный парк и не только одна линия высоток.
   Проверить, что локальная улица не выходит за клетки района и мостовой участок имеет сухопутный выход с обеих сторон.
4. У задачи стадии 1–2 плитка стройплощадки занимает только 3–5 клеток по глубине; после появления фасада платформа совпадает с физическим footprint.
5. Проверить лису/кошку и оленя/кабана во всех направлениях: размеры видов различаются, кадры ног меняются, дополнительного сжатия, bob и rotation нет.
6. На контрольной стране из 10 городов и 88 зданий gzip-ответ атласа должен оставаться около `50 KB` и не превышать `60 KB`; увеличение проверять как регрессию payload, а не маскировать изменением browser cache.

## Chunk Streaming V2

1. В DevTools задержать `/api/world/viewport` и `/api/chunks/*` на 3 секунды: terrain должен появиться синхронно до первого ответа, а `.world-canvas` получить `data-seed-first-frame="true"` и `data-seed-first-frame-mode="synchronous"`; дорог и зданий до authoritative overlay быть не должно.
2. Перезагрузить тот же viewport: ответ хранится в приватном HTTP-кэше и перепроверяется content-hash ETag; комментарий к задаче не должен менять ETag.
3. Изменить status обычного здания: после загрузки stage asset растёт `data-entity-rebuilds`, но chunk HTTP-запрос отсутствует и `data-ground-rebuilds` не меняется.
4. Задержать один building PNG: ground должен появиться до ответа; после ответа растут `data-entity-ready-publishes` и `data-entity-rebuilds`, то есть ранний reconcile соседа не оставил здание пустым.
5. Один раз оборвать building PNG после realtime status: клиент должен повторить только entity-assets, сохранить готовый ground и опубликовать новую стадию.
6. Проверить `.world-canvas`: `data-static-ground-views` равно числу GPU ground entries, `data-chunk-data-cache <= 48`, `data-chunk-payload-cache <= 160`, `data-ground-cache <= max(96, data-resident-chunks)`, все resident/видимые ground сохранены после завершения загрузки, `data-ground-bakes-per-frame-max = 1`; `data-ground-texture-resolution` равно `1` в detail и `0.5` в overview.
7. Зафиксировать `data-chunk-payload-p50-bytes`, `data-chunk-payload-p95-bytes`, `data-chunk-payload-p99-bytes`; аналогичные `p50/p95/p99` атрибуты для `chunk-request`, `chunk-parse`, `chunk-materialize` и `ground-bake` заканчиваются на `-ms`. Сравнить cold/warm viewport; worker/CSP/Pixi errors недопустимы.
8. На районе больше одного чанка проверить, что `world_chunk_district_cells_v1` содержит не более 4096 клеток в строке, а chunk response не возвращает клетки за пределами requested bounds.
9. Первый экран должен вызвать один `/api/world/viewport`, а не отдельный HTTP на каждый видимый чанк. В payload должен быть `payloadVersion: 2`, `generatorVersion: square-v8`, `roadRuns`, `surfaceRuns` и районные `cellRuns`; после materialization клетки обязаны совпадать с v1 без потерь.

## Геометрия обновлённых зданий

1. Прогнать `verify_building_stages.py` отдельно для `civic-hospital-v5`, общего `commercial-gas-station-family-v6`, `commercial-parking-lot-v6` и `state-archive-core-v5`: `acceptedByCode` должен быть `true`, а `errors` и `warnings` — пустыми. Затем `npm run assets:verify` обязан проверить 1 224 PNG без нарушений.
2. В DETAIL проверить: больница имеет четыре этажа и двойную дверь человеческого масштаба; АЗС — четыре заправочных места, дверь `8×16`, фронтовую платформу без переданного с backend покрытия; архив — единую проекцию крыши и не выходит за охраняемый участок.
3. После принудительной перегенерации убедиться, что fuel-service находится ближе к центру своего дорожного блока, все четыре корпуса архива лежат внутри `42×28`, а старые `18×12` архивы отсутствуют.
4. У АЗС тёмный forecourt занимает только компактную центральную полосу глубиной три клетки, задняя
   площадка магазина вымощена, боковые/задние края остаются травой. У
   `commercial-parking-lot` стадии 3–5 сохраняют одинаковую ширину, вход и
   верхнюю плоскость; stage 5 не выглядит плоским фронтальным вырезом.
5. Проверить все семь fuel-service вариантов: canvas не меньше `96×72`, footprint не меньше `12×7`, дверь того же модуля, что у соседнего здания, спрайт один и находится по центру footprint. В rural-чанках поля/кусты/камни повторяются после reload, совпадают через границу чанка и отсутствуют в `world_features_v6`; `PARK_DECOR`-строк в БД быть не должно.

## Изоляция runtime

1. Проверить health `3000`, `3002`, `3003`; nginx `/mcp` должен идти на 3002, а HTTP regenerate — приниматься web на 3000 и ставить durable job для worker на 3003.
2. Запустить долгий MCP mutation и одновременно открыть `/health`, `/api/bootstrap` и существующий viewport: web должен отвечать независимо от загрузки MCP event loop.
3. После MCP mutation убедиться, что web получает realtime event через PostgreSQL relay и обновляет только затронутую страну.
4. Остановить контейнер `mcp`: web-карта и Socket.IO должны продолжить работу. Остановить `world`: чтение карты, обычный API и MCP read-команды должны продолжить работу; generation jobs остаются в очереди и возобновляются после возврата worker.
5. На копии production-БД запустить batch reconcile с `REGENERATION_MAX_ATTEMPTS=3`: исходный audit-clean мир должен дать `world-regeneration.preserved` без смены seed, failed layout — `retrying`, успешная перестройка — `completed` с числом `attempts`, а audit после commit — 0 нарушений.

Автоматические браузерные проверки находятся в `tests/e2e/chunk-pipeline.spec.ts` и `tests/e2e/map-streaming.spec.ts`.

## Походка, трафик и восстановление карты — 1.19.4

1. На native detail scale просмотреть `A→B→C→B` для north/east/south/west:
   canvas остаётся `16×24`, стопы имеют общий baseline, промежуточная поза может
   быть уже контактных поз, но голова, торс и длина конечностей не меняют масштаб.
2. Сравнить восемь моделей в `tmp/vehicle-proportion-proof.png` и
   `screenshots/transport-native-views-review.png`:
   horizontal/north/south используют одну frontal-top камеру, одинаковую линию
   колёс и контакт с дорогой; canvas равен `24×16`/`16×24`, а occupied bounds —
   `22×13`/`13×22`. North/south — один связный кузов без отдельной тени.
   Проверить, что catalog/manifest SHA-256 совпадает с исходным листом. Во время
   движения `data-vehicle-rendered-frame-mask` достигает `1111`:
   меняется пиксельный блик ступицы, но runtime не добавляет bob кузову.
3. На T-перекрёстке убедиться, что все travel-роли лежат на asphalt. За полный
   63-секундный цикл транспорт должен иметь не менее 65% времени движения;
   непрерывный all-red не превышает 10,5 секунды и за это время минимально
   быстрый автобус полностью выводит хвост из семиклеточного box.
4. Принудительно вернуть `503` для viewport после готового кадра: seed/готовый
   ground остаётся видимым, ошибка показывается компактно. Отдельно оборвать
   инициализацию renderer: кнопка «Повторить» должна пересоздать карту и получить
   `data-seed-first-frame="true"`.
5. Автоматические результаты релиза 2026-08-23: `472 passed / 7 skipped` unit,
   `27 passed / 6 skipped` E2E, `42` animation families / `126` frames, `1 224`
   PNG без нарушений и `8` vehicle models / `24` views. Все `10/10`
   world-validation городов имеют clean audit. Scale-smoke: generation
   `11 866 ms`, cold chunk `233 ms`, cached chunk `47 ms`, compact wire `−82%`,
   RSS `417 MB`.

## Release gate

```bash
npm run test:db:start
npm run assets:verify
.venv-assets/bin/python scripts/verify-vehicle-proportions.py \
  --proof tmp/vehicle-proportion-proof.png
npm run typecheck
npm run lint
TEST_DATABASE_URL=postgres://tasktopia:tasktopia@127.0.0.1:55432/tasktopia_test \
DATABASE_URL=postgres://tasktopia:tasktopia@127.0.0.1:55432/tasktopia_test npm test
npm run build
npx playwright test tests/e2e/map-streaming.spec.ts --project=chromium --workers=1
npm run test:db:stop
```

Тяжёлые генерационные и scale-сценарии запускаются отдельно и не конкурируют
с browser gate за PostgreSQL и CPU.

## Полная проверка мира новостроек

Отдельный сценарий создаёт 10 городов, 22 района и 88 задач, выполняет серверный
world audit после каждого города, затем открывает каждый город настоящим
PixiJS-клиентом и сохраняет скриншоты:

```bash
npm run test:db:start
npm run test:world-validation
npm run test:db:stop
```

Подробный контракт, телеметрия и принятые показатели описаны в
[`docs/qa/WORLD-VALIDATION.md`](qa/WORLD-VALIDATION.md).

## Визуальная проверка мегаполиса

Сценарий мегаполиса создаёт один плотный город из 100 задач в двадцати базовых компактных кварталах
и автоматически добавляет районы-продолжения, когда базовый квартал заполнен,
обязательно размещает все 26 типов низко- и среднеэтажных жилых корпусов и все
32 обычные жилые высотки, а затем сохраняет машинный отчёт и четыре
браузерных скриншота (overview, detail, жилой ряд и высотный кластер) в
`screenshots/megacity-validation/`:

```bash
npm run test:db:start
npm run seed:megacity-validation
MEGACITY_VALIDATION_SCREENSHOT_DIR=screenshots/megacity-validation \
E2E_BASE_URL=http://127.0.0.1:5197 E2E_SEED_COMMAND=true \
npx playwright test tests/e2e/megacity-validation.spec.ts --project=chromium --workers=1
npm run test:db:stop
```

Серверный отчёт должен содержать `tasks: 100`,
`allHouseTypesCovered: true`, `allResidentialTypesCovered: true`, пустые `blockingVisualBuildingOverlaps` и
`violations`. На скриншотах отдельно проверить, что высокие и общественные
фасады не накрывают соседний ряд зданий или дорогу, а стадии 3–5 сохраняют одну
фронтально-верхнюю проекцию.
## Реагирование на пожар

1. Откройте задачу в готовом высоком здании и создайте шесть активных дефектов.
2. На detail LOD убедитесь, что очаги находятся внутри фасада, занимают разные этажи и не образуют одну горизонтальную линию. На компактном здании должен остаться один небольшой очаг.
3. Проверьте пожарную машину у бордюра при native `1x`: читаются кабина, два колеса и назначение модели — цистерна, спасательные шкафы или лестница.
4. Струя должна начинаться на крыше машины, заканчиваться на одном из очагов, сохранять обе точки контакта и анимировать движение бликов и ударных брызг без масштабирования всей линии.
5. Переведите один дефект через `IN_PROGRESS → VERIFYING → FIXED`, затем закройте остальные. Огонь должен исчезнуть при пяти активных дефектах, дым — после последнего, без повторной загрузки ground или потери камеры.

Автоматизированный прогон:

```bash
INCIDENT_SCREENSHOT_PATH=tmp/qa/fire-response.png \
E2E_BASE_URL=http://127.0.0.1:5199 \
npx playwright test tests/e2e/map-streaming.spec.ts --grep "realtime task status"
```
