# Метрики runtime

Operator endpoint `/internal/runtime-metrics` регистрируется только при явно
настроенном `OBSERVABILITY_TOKEN`. Обычные account/country/MCP credentials не
дают доступ. Default — off; UI диагностическая панель не включается автоматически.
Маршрут и native Node/Db сборщик находятся в `runtime-observability.ts`, `index.ts`
и `db.ts`; конечный guarded endpoint проверяется отдельно от producer snapshots.

Синхронные `runtimeStats()` не выполняют SQL и не перебирают содержимое payloads:

- `AppService`: cache hits/misses/build invocations/bypasses, entries и maxEntries
  (layouts 32, chunks 512, country overviews 128, city scenes 8), число pending
  chunk builds и известных country versions. Entries — лимит записей, не оценка bytes.
- Generation dispatcher: request/notification/poll/timeout counters, active
  observers/waiters и время последней успешной/ошибочной проверки. Completed/failed
  counts относятся к запросам; retry может снова прочитать один уже завершённый job.
- Generation worker: iterations, processed attempts, errors, running/closed и
  время последней успешной/ошибочной итерации. Processed не означает successful job.
- Event relay: число country cursors, notifications, delivered и poll health.
- Background poll: attempts/successes/errors, running/closed/requested,
  consecutive failures, last success/failure, remaining backoff.

`readWorldGenerationQueueStats(db)` отдельно читает агрегаты только PENDING/RUNNING:
counts, expired leases, oldest pending age. Результат имеет sampledAt, TTL 5 секунд
и coalescing конкурирующих запросов. Read snapshot не запускает work mutation.
Ни один producer snapshot не содержит country/job/task/user IDs, command bodies,
SQL text, database URIs, credentials или тексты ошибок.

Native event-loop/heap/RSS и QueryMetrics имеют фиксированную память. SQL latency
включает ожидание pool и исполнение; отдельный measured DB wait не заявляется.
Endpoint имеет отдельный rate/deadline guard и не выдаёт старые либо выдуманные
нулевые показатели при ошибке сбора. Producer QA и guarded route QA не заменяют
наблюдение опубликованного неизменяемого SHA.

Локально проверен фактический собранный HTTP runtime в режимах combined, web,
mcp и world: `/health`200, закрытый endpoint404 без ключа,200 с ключом,
`Cache-Control:no-store`, конечные native event-loop/memory показатели. Все четыре
дочерних процесса завершились по SIGTERM с exit0 за6–9мс. Отдельный child-process
fault test подтверждает terminal exit1 при зависшем Promise; общий deadline30s,
Compose grace35s. Эти результаты не являются измерением остановки под production
нагрузкой или доказательством отмены уже выполняемого SQL.
