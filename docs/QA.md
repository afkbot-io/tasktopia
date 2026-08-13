# Проверка релиза

## Жители и глубина мира

1. Открыть малый тестовый мир (`npm run seed:test`) и приблизить карту до DETAIL.
2. Убедиться, что у идущего жителя различаются две опорные фазы ног во всех
   четырёх направлениях; при остановке кадр не меняется, а pan/zoom не начинает
   цикл заново.
3. Проследить проход жителя возле фасада, дерева и светофора. Перекрытие должно
   зависеть от точки ног: объект ниже по экрану рисуется впереди.
4. Дождаться разговора двух жителей. Белая реплика находится над головой,
   не вращается вместе с телом и остаётся выше зданий и светофоров.

## Транспорт

1. Наблюдать регулируемый перекрёсток с плотным потоком не менее двух минут.
2. При занятой полосе после перекрёстка следующая машина должна остаться перед
   стоп-линией, даже если её сигнал зелёный.
3. Проверить telemetry на `.world-canvas`: `data-traffic-unsafe-pairs="0"`,
   `data-wrong-way-cars="0"`, `data-wrong-way-buses="0"`.

## Release gate

```bash
npm run test:db:start
npm run assets:verify
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
