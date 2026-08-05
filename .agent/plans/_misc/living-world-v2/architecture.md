# Architecture

## Current boundary

Pixi-компонент одновременно владеет чанками, views и эфемерной симуляцией. Любой structural reconcile очищает `agentLayer`. Сервер хранит семантику и геометрию в одних строках, а surfaces/decorations вычисляет при чтении.

## Target boundary

- `agent-routing.ts`: чистые ограниченные алгоритмы маршрута и session RNG.
- `WorldCanvas`: один ticker, persistent agent registry, обновление graph reference и точечное удаление только агентов вне графа.
- Самолёт — screen-space overlay, один таймер состояния внутри того же ticker.
- HTTP mutations вызывают существующий AppService и его idempotency/realtime boundary.
- Regeneration меняет seed и всю пространственную проекцию в одной `mutate`-транзакции; IDs и history rows не удаляются.

## Alternatives considered

- Хранить координаты агентов на сервере: отклонено как лишняя запись и websocket-трафик для декоративной симуляции.
- Пересоздавать агентов из детерминированного времени: не решает заметный reset при reconcile.
- Удалить и заново вставить задачи при regeneration: отклонено из-за риска потери комментариев/истории.

## Rollout and rollback

Версия выпускается одним релизом после DB/in-browser proof. Rollback приложения безопасен: новые PNG/HTTP routes не меняют схему; regeneration не запускается автоматически.
