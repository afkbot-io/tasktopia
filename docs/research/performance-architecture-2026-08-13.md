# Tasktopia: исследование архитектуры производительности

**Дата среза:** 2026-08-13
**Статус:** исследовательская рекомендация, а не результат нагрузочного теста.

Ниже официальная документация отделена от проектных выводов для Tasktopia. Выводы о выборе технологий — наши инженерные гипотезы; их следует подтвердить профилированием и репрезентативными бенчмарками.

## Решения

### Каноническое состояние: PostgreSQL

Оставить PostgreSQL источником истины для связного и транзакционного состояния мира, пользователей и задач. Он предоставляет ACID-транзакции; `jsonb` подходит для ограниченных по размеру полуструктурированных полей, а TOAST прозрачно выносит крупные значения из основной строки ([transactions](https://www.postgresql.org/docs/current/tutorial-transactions.html), [`jsonb`](https://www.postgresql.org/docs/current/datatype-json.html), [TOAST](https://www.postgresql.org/docs/current/storage-toast.html)). Это не отменяет необходимости измерять размер строк, индексов и write amplification.

MongoDB не является автоматическим «ускорителем». Встраивание полезно, когда ограниченный агрегат обычно читается целиком, но неограниченные массивы считаются анти-паттерном; распределённые транзакции дороже одиночных операций, а часть геопространственных операций ограничена внутри транзакций ([embedding](https://www.mongodb.com/docs/manual/data-modeling/concepts/embedding-vs-references/), [unbounded arrays](https://www.mongodb.com/docs/manual/data-modeling/design-antipatterns/unbounded-arrays/), [transactions](https://www.mongodb.com/docs/manual/core/transactions-production-consideration/), [restricted operations](https://www.mongodb.com/docs/manual/core/transactions-operations/#restricted-operations)). Проектный вывод: рассматривать MongoDB только при доказанной потребности в шардированном чтении самостоятельных bounded-документов целого чанка, а не как общий способ ускорить текущую модель.

### Артефакты чанков и HTTP-кеширование

Генератор должен выпускать неизменяемый компактный бинарный артефакт чанка с content hash в идентификаторе. На первом этапе хранить payload в PostgreSQL `bytea` ([binary data types](https://www.postgresql.org/docs/current/datatype-binary.html)); после подтверждённого роста объёма/трафика перенести байты в object storage и CDN, оставив в БД метаданные и ссылку.

Для hash-адресованных URL безопасна длительная свежесть с `Cache-Control: public, max-age=..., immutable`: общие правила HTTP-кешей заданы [RFC 9111](https://www.rfc-editor.org/rfc/rfc9111.html), директива `immutable` — [RFC 8246](https://www.rfc-editor.org/rfc/rfc8246.html). Публикация новой версии должна создавать новый hash/URL, а не мутировать старый объект.

### Redis

Использовать Redis только как удаляемый общий hot cache, broker и средство короткоживущей координации. Cache-aside означает, что приложение читает БД при промахе и затем заполняет кеш; политики eviction могут удалить ключи при достижении лимита памяти ([cache-aside](https://redis.io/docs/latest/develop/use/patterns/cache-aside/), [eviction](https://redis.io/docs/latest/develop/reference/eviction/)). Поэтому потеря Redis не должна уничтожать каноническое состояние, а TTL, stampede protection и восстановление после промаха должны быть частью дизайна.

### Генератор: TypeScript workers прежде Rust

CPU-тяжёлую генерацию нельзя выполнять на основном event loop Node.js. `worker_threads` предназначены для параллельной CPU-работы, и официальная документация рекомендует пул воркеров вместо создания потока на каждую задачу ([Node.js v24 `worker_threads`](https://nodejs.org/docs/latest-v24.x/api/worker_threads.html), [не блокировать event loop](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop)).

Проектный порядок: сначала ограниченный пул `worker_threads`, очередь с backpressure, переносимые/разделяемые буферы и метрики p50/p95/p99, CPU, RSS и GC. Rust имеет смысл только после профиля, показывающего устойчивое CPU-узкое место, которое не устраняется алгоритмом, структурами данных или пулом.

### API и формат передачи

Fastify компилирует response schemas в быстрые сериализаторы; компрессию следует включать осознанно, учитывая порог размера и CPU ([validation and serialization](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/), [`@fastify/compress`](https://github.com/fastify/fastify-compress)). Сохранить Socket.IO/WebSocket: Socket.IO уже использует WebSocket при возможности и имеет fallback/reconnect, а custom parser позволяет заменить кодирование пакетов ([how it works](https://socket.io/docs/v4/how-it-works/), [custom parser](https://socket.io/docs/v4/custom-parser/)).

До смены протокола провести одинаковый end-to-end бенчмарк для: (1) JSON + Brotli/gzip, (2) структуры на `TypedArray`, (3) MessagePack/custom parser. Сравнить размер «на проводе», время encode/decode на сервере и клиенте, аллокации/GC, latency p95/p99 и стоимость компрессии. Бинарный формат не считать победителем без этих данных.

### Рендер PixiJS v8

Сохранить PixiJS v8. Разделить редко меняющийся статический мир и динамические сущности; для подходящих стабильных поддеревьев измерить `cacheAsTexture`, для независимых крупных сценовых групп — render groups; объединять текстуры в spritesheets и отсекать невидимое. Pixi отдельно предупреждает о цене render groups и обновления кешированной текстуры, поэтому применять их по профилю, а не глобально ([renderers](https://pixijs.com/8.x/guides/components/renderers), [performance tips](https://pixijs.com/8.x/guides/concepts/performance-tips), [`cacheAsTexture`](https://pixijs.com/8.x/guides/components/scene-objects/container/cache-as-texture), [render groups](https://pixijs.com/8.x/guides/components/scene-objects/container/render-groups), [spritesheets](https://pixijs.com/8.x/guides/components/assets/spritesheet)).

На дату среза WebGL оставить production-рекомендацией с более зрелой совместимостью; WebGPU держать экспериментальным opt-in и проверять на целевых браузерах/устройствах. Критерии решения: frame time p95, draw calls, texture uploads, GPU memory, startup time и частота пропущенных кадров.

## Минимальная программа проверки

1. Зафиксировать репрезентативные размеры и плотность чанков, сценарии чтения/изменения и целевые бюджеты latency/FPS.
2. Профилировать генератор на одном потоке и в ограниченном worker pool; Rust не начинать до локализации CPU hotspot.
3. Сравнить три wire-формата на одинаковых данных и настройках транспорта.
4. Замерить Pixi-сцену до и после разделения слоёв, culling, spritesheets, `cacheAsTexture` и render groups — каждую оптимизацию отдельно.
5. Проверить cold start без Redis, cache stampede и восстановление кеша из PostgreSQL/артефактного хранилища.

## Реализованный первый этап

Chunk Streaming V2 оставил PostgreSQL и PixiJS. Вместо прежнего полного DTO сервер публикует компактную JSONB-проекцию с content hash; terrain и ambient decorations восстанавливаются в браузерном Worker, а статический ground запекается в одну RenderTexture на чанк. JSONB выбран как промежуточный проверяемый формат; переход к бинарному object-storage/CDN артефакту остаётся следующим шагом только после измерения production bandwidth и encode/decode профиля. MongoDB, полная перепись на Rust и смена движка на этом этапе не требуются.

Локальный профиль 18 seeded chunks: DETAIL JSON в среднем 38.7 KB, максимум 136.9 KB; gzip в среднем 4.8 KB, Brotli 1.8 KB; cold server build p95 29.7 ms, browser-equivalent materialization p95 9.3 ms. OVERVIEW materialization p95 0.2 ms. Поэтому production p50/p95/p99 telemetry уже добавлена в клиент, а TypedArray/MessagePack/custom codec откладывается до подтверждения сетевого или parse/GC bottleneck на реальном трафике.
