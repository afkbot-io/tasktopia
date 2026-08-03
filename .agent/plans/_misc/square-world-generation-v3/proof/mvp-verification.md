# MVP verification — 2026-08-02

## Функциональный gate

- `npm run typecheck` — pass.
- `npm run lint` — pass.
- `npm test -- --run` — 19 tests pass, включая camera bounds/chunk prefetch, terrain distribution и road/task occupancy.
- `npm run assets:build` — 44 building families, 12 terrain families, 34 props, hard-alpha и grid validation pass.
- `npm run test:e2e` на отдельной чистой SQLite базе — login/map/task modal/token flow, city navigation, zoom-out без пустого фона и empty-country registration pass в Chromium.
- `npm run smoke:mcp` — 20 tools доступны, revoked token отклоняется.
- `npm run build` — production client/server bundle собран; остаётся неблокирующее предупреждение о клиентском PixiJS chunk размером 508 KB.
- `docker build -t tasktopia:mvp .` и `/health` из контейнера — pass, версия `0.4.0`.
- `npm audit --audit-level=high` — 0 vulnerabilities.
- `docker compose config` — production graph валиден.

## Масштабный smoke

Команда: `npm run test:scale`. Seed `424242`:

```json
{
  "cities": 10,
  "districts": 80,
  "tasks": 250,
  "roads": 21018,
  "chunks": 90,
  "terrainCells": 368640,
  "generationMs": 6821,
  "chunkMs": 523,
  "rssMb": 383,
  "heapUsedMb": 53
}
```

Проверено: одна компонента национальных дорог, непересекающиеся city envelopes, отсутствие пересечений районов, связность каждого района, footprint каждой задачи внутри района, отсутствие дорожных клеток внутри task footprint и отсутствие двойной occupancy. Среднее вычисление готового чанка в этом последовательном прогоне — около 5.8 ms без HTTP/рендера.

После профиля полный пересчёт road masks заменён локальным, дорожная сеть получила транзакционно-безопасный in-memory индекс, а неудачные пробные улицы больше не коммитятся. Полный сценарий выполняется примерно за 6.8 s на машине разработки; это smoke, не production SLO.

## Визуальная и camera-проверка 0.4

- Город использует компактную схему `национальная трасса → gateway → hub → улица района`; межгородская трасса не проходит через bounds существующего города.
- На минимальном масштабе загружается viewport плюс 0.75 viewport с каждой стороны; Playwright наблюдал не менее 30 и менее 200 resident chunks.
- Камера clamp-ится внутри country bounds с запасом 192 клетки вокруг опубликованных городов.
- Скриншоты: `screenshots/mvp-city-desktop.png`, `screenshots/mvp-city-zoomed-out.png`, `screenshots/mvp-harborview.png`.

## Осознанные ограничения MVP

- SQLite и synchronous generation рассчитаны на один app instance.
- Scale smoke использует один фиксированный seed; 100/1000-seed soak остаётся production-hardening задачей.
- Клиент создаёт отдельные Pixi sprites для клеток видимого prefetch-ring; atlas/tilemap pooling нужен перед очень дальним zoom-out.
- Макрограф рек использует глобальные меандрирующие функции, а не полноценный Priority-Flood feature store.
- Legacy hex tables сохранены только для безопасного чтения/экспорта старых локальных данных и не участвуют в square-v4 runtime.
