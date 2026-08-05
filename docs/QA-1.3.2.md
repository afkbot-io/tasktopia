# QA 1.3.2 — плавная карта и ресурсные бюджеты

## Автоматические проверки

```bash
npm run typecheck
npm run lint
npm test
npm run build
DATABASE_URL=postgres://tasktopia:tasktopia@127.0.0.1:55432/tasktopia_test npm run test:e2e
npm audit --omit=dev
docker compose config
```

Основной E2E использует только тестовую страну с одним городом и 10 районами. Тяжёлый `npm run test:scale` запускается отдельно и не входит в обычный релизный прогон.

## Карта

1. На искусственно задержанных chunk-ответах canvas появляется сразу, но loader «Готовим карту…» исчезает только после первого ground.
2. При перетаскивании старая область остаётся видимой до готовности новых чанков; чёрных прямоугольников и следов нет.
3. Один URL чанка запрашивается не более одного раза за цикл перемещения; возврат в недавно просмотренную область использует локальный LRU.
4. `data-chunk-data-cache <= 160`, `data-ground-cache <= 96`; число resident chunks соответствует текущему viewport.
5. В консоли нет CSP-сообщения для встроенной ImageBitmap-проверки, Pixi Cache warning и unhandled promise rejection.
6. Несколько колебаний zoom вокруг границы LOD не должны постоянно переключать overview/detail.
7. Скрытая вкладка или карта вне viewport останавливает ticker; возврат возобновляет его без второго canvas.

## Интерфейс

1. «План» и «Границы» показывают `cursor: pointer`, заметное включённое состояние и корректный `aria-pressed`.
2. Панель управления страной видна сразу при первом открытии, закрывается по Escape и клику снаружи.
3. На 375, 768 и 1440 px нет горизонтального overflow или перекрытия верхней панели.

## Production и соседний проект

1. До и после обновления сохранить `docker stats --no-stream`, host load/RAM/swap и restart counts.
2. Через `docker inspect` подтвердить Tasktopia app `1.5 CPU / 1 GiB / 160 PIDs`, PostgreSQL `0.75 CPU / 768 MiB / 100 PIDs`.
3. `https://tasktopia.online/health` и health endpoint соседнего проекта отвечают `200` во время ограниченного smoke.
4. У обоих проектов `OOMKilled=false`, restart count не растёт, свободная RAM и swap остаются стабильными.
5. Проверить production CSP, `/ai.md`, MCP smoke и публичную загрузку статических ассетов.
