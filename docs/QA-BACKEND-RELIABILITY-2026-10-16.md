# Backend/MCP: надёжность, совместимость и локальная QA

Проверен изменённый server/shared/MCP diff относительно
`053e061d84dbcafdeaf1841010f9bd2286c9c5f8` и новые миграции 0043/0044.
Это локальная квалификация рабочей версии 1.25.0; итоговый SHA, SCM/CI,
публичный backup и managed release фиксируются отдельно. Область общей цели:
[план и критерии](PLAN-WORLD-RELIABILITY-EVOLUTION-2026-10-16.md).

## Проверки и точный подсчёт

| Прогон | Результат | Область |
| --- | --- | --- |
| Финальная backend-регрессия | 170 PASS, 24 файла, 55.70 s | AppService, jobs/relay/recovery, session/Redis, runtime metrics/shutdown, номера, read models, news/album/audit, MCP HTTP/country/jobs/transfer, документы и caches |
| После исправления числового поиска | 11 PASS, 1 файл, 5.23 s | Вся `task-read-projections`: reader + HTTP + MCP; 10 повторных проверок и 1 новая |
| Дополнительная существующая регрессия | 10 PASS, 3 файла, 4.33 s | `compact-cutover-idempotency`, `permanent-task-sites`, `task-history-index` |

Всего охвачены **181 уникальный тест в 27 файлах**: 170 + 1 новый + 10
дополнительных. Это не единый повторный прогон 181 теста. После единственной
локальной правки поиска повторена вся затронутая граница, остальные результаты
переиспользованы. Scoped strict TypeScript, ESLint и `git diff --check` прошли.

Подтверждённый RED: `q=2147483648` доходил до PostgreSQL integer и давал
22003/HTTP500. Номер больше 2147483647 теперь возвращает пустую страницу.
GREEN проверяет 2147483647, 2147483648 и 9999999999, также с префиксом `#`.
SHA256 `src/server/task-list-read.ts` после исправления:
`8db6462210c44e6c60eed1955e9fdbc34c84d2a850fd97e885537abcbf9ef1c9`.

Логи и исходные manifests сохранены локально в
`.builder/world-reliability-evolution-20261016/backend/`:
`ledger-final-backend-security.json`, `final-backend-review-manifest.json`,
`final-backend-regression.log`, `p05-q-overflow-{red,green}.log`,
`final-backend-history-regression.log`. URI и дампы хранятся отдельно с mode0600;
секреты в отчёты не включаются.

## Контракты и безопасность

Дополнительная сверка P05 закрыла отдельные точки 0/100/1000 комментариев.
После добавления трёх public cases весь `task-read-projections.test.ts`
прошёл **14/14**, 6,32 секунды. Только три новые точки повторены с отключённым
перехватом console для сохранения чисел: 3 PASS, остальные 11 отфильтрованы;
это не ещё три уникальных теста. Изменён только тест, production-код прежний.

| Существующие комментарии | HTTP Card, байт | HTTP full, байт | SDK compact read, байт | SDK compact command, байт | Receipt, байт |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 3063 | 3133 | 8779 | 1018 | 149 |
| 100 | 3065 | 219232 | 8783 | 1018 | 149 |
| 1000 | 3066 | 2164132 | 8785 | 1018 | 149 |

Для каждой точки настоящий SDK выполняет одну команду комментария и повтор с
тем же ключом при смене compact→full. Совпадают request hash и receipt;
в БД остаются N+1 комментарий и ровно один `COMMENT_ADDED`. Существующие N
комментариев созданы SQL-фикстурой с телом 2000 ASCII-байт, это не нагрузка из
1000 пользовательских MCP-команд. MCP bytes — UTF-8 JSON сериализации SDK
result через InMemoryTransport, без HTTP/SSE framing и сжатия. HTTP bytes —
настоящие тела Fastify inject. [Сводка с хешами и ограничениями](evidence/task-read-sizing-2026-10-16/summary.json).
Scoped ESLint и независимое ревью дополнения прошли. Эти три новые проверки
дополняют прежние 181; старая цифра выше описывает первоначальные прогоны.

[`mcp-http-contract.test.ts`](../tests/mcp-http-contract.test.ts) использует
настоящие SDK и HTTP, сверяет advertised set и фактически вызывает **все 50
инструментов**: country — 3, generation — 1, archive — 5, city — 6,
district — 7, task — 28. Для каждой записи проверяются успешный вызов,
повтор с прежним результатом без нового world event, обязательный
`idempotencyKey` и корректные annotations. Это часть набора 170, а не ещё 50
самостоятельных тестов.

Проверены modern/legacy initialize, tools/resources/capabilities, все шесть
scopes, VIEWER, чужая страна/задача, отзыв membership/токена, истечение токена,
неверные Origin/credentials/envelopes, подмена actor, ошибочные переходы и
подтверждения удаления. Attachments: лимит декодированных байтов, строгий
base64, конфликт разных байтов одинаковой длины, очистка файлов; ошибки и
логи не раскрывают внутренние секреты. Все scoped tools требуют явный
`countryId`; `country.list` остаётся единственным исключением. UI selection
не меняет MCP country. Исполнитель и actor определяются владельцем токена.

Card/collections/document/list-page проверяют страну и доступ, bounded
limit/cursor и микросекундные timestamp ties; документ читается отдельно.
`TaskCardDto` не выдаётся за полный `TaskDto`. Compact response и receipt
имеют явную версию; `resultMode` не меняет command hash. Старые full receipts
и их hash не переписываются: spatial retry сохраняет прежнюю CURRENT
hydration, nonspatial — прежний исторический ответ. Compact comment/status/
progress не загружают полные дочерние коллекции и не сохраняют полный TaskDto.

Очередь сохраняет FIFO страны и fair выбор между странами; последний expired
RUNNING attempt сначала проверяет committed receipt. Relay хранит отдельные
country cursors, переживает поздний commit меньшего global ID, использует
bounded batches/backoff. Session revalidation fail closed; Redis lease release
имеет общий deadline. Shutdown имеет настоящий terminal deadline: Promise race
не объявляется отменой SQL. Метрики default off, защищены отдельным token,
`no-store`, ограничены агрегатами без country IDs/payload/SQL/secrets.

Новости получаются из durable actual events, сохраняют own-token изменения,
проверяют текущую audience/membership, группируют серии до пагинации и требуют
явного ACK реальных event IDs с монотонным watermark. Альбом не создаёт work
событий; legacy before/after остаются null. История хранит только разрешённые
короткие scalar changes, без копий Markdown и секретных полей.

## Миграции и восстановление

0043 добавляет lifetime counter и DB allocator trigger: старый runtime с
`MAX(active)+1` также не переиспользует удалённые номера после rollback.
Backfill учитывает live tasks, permanent sites, старые receipts и events.
Явное сохранение migration/fixture номеров возможно только доверенным SQL
`SET LOCAL tasktopia.preserve_task_numbers`, не MCP-параметром. Проверены
конкуренция, независимые страны, исторические максимумы и сохранность receipts.
0044 расширяет CHECK четырёх старых notification kinds тремя новыми и добавляет
partial index альбома только для milestone events; прежние ключи/read markers
сохраняются. Это additive upgrade, без destructive down migration при rollback
образа.

Фактический compatibility runner загрузил **исходный AppService/Db/news reader
из git archive 053e** с его 42 миграциями в отдельную пустую native PostgreSQL 16
базу. Старый runtime создал номера 1/2 и full receipt, затем удалил 2. Текущий
runtime применил 0043/0044. Старый runtime снова загрузился, прочитал full task
и старую news query, повторил старый full и новый compact receipt без изменения
hash и без дубликатов событий; его следующий insert получил 3. После удаления
3 текущий runtime получил 4.

Реальный `pg_dump --format=custom` в файл с mode0600 восстановлен через `pg_restore`
в другую пустую базу. Проверены 44 migration rows, lifetime counter, allocator
trigger и album index. Старый 053e runtime загрузился на восстановленной базе,
сохранил исходную задачу и получил следующий номер 5 после удалённого 4.
Артефакты: `compatibility-old053e-restore.{json,log}` и private fixture dump.
Это проверка старого исходного runtime с установленными локальными
зависимостями и полного fixture restore; не старого Docker image, не
публичного backup и не всех вариантов data-only восстановления.

## Actual built MCP smoke

Заморожена отдельная копия текущего `dist/server.mjs`, package 1.25.0,
lockfile и всех 44 миграций; seed и SDK smoke собраны в том же pack. SHA256
server bundle:
`dae136ca64c93bbc7d0dfac2a675c38ed5edc800d895a5a78af7f4ed48c61937`.
Manifest содержит hashes входов и файлов снимка. Запущен именно этот bundle
на Node 24.15.0, `NODE_ENV=production`, role `combined`,
`http://127.0.0.1:5330`, отдельная свежая
`reliability_final_mcp_20261016` на native PostgreSQL 16:55436.

Frozen `seed:test` создал один город, три района и 40 задач с номерами 1–40;
lifetime counter — 40. `/health` вернул ok/1.25.0.
[`scripts/mcp-smoke.ts`](../scripts/mcp-smoke.ts) прошёл modern и legacy 2025
SDK initialize/listTools (50), country/catalog resources, 11 защищённых
NOT_FOUND mutation handlers, Bearer challenge, Origin GET/POST/DELETE,
отказ bare-token/x-api-key, отзыв токена и read/task/country-only scope checks.
**Built smoke перечисляет 50 инструментов, но не повторяет все 50 успешных
CRUD-сценариев**: их покрывает отдельный HTTP contract suite выше.

До и после smoke: tasks 40, cities 1, districts 3, events 127, receipts 127,
jobs 0, counter 40 — без изменений. Все четыре тестовых токена отозваны,
active 0. Smoke exit 0; SIGTERM завершил собственный сервер с exit 0 за 18.88 ms;
warn/error log пуст. Это длительность конкретного локального завершения,
не обещание production latency. Порт освобождён.
Артефакты: `backend/built-mcp-5330/{manifest,result}.json`,
`mcp-smoke.log`, `seed.log`, `server.log` в указанном `.builder` каталоге.

## Репетиция существующей серверной копии

16 октября выполнен только read-only preflight официального `dev-server`:
SSH alias `tasktopia-production`, `/srv/tasktopia/app`. Checkout оставался
`053e061d84dbcafdeaf1841010f9bd2286c9c5f8`; три runtime использовали один image
`sha256:ad2089ca725ea5291f13d445dbdd5094da11f5ea4baac9a54a003523fd48b43a`.
Все три healthcheck вернули HTTP200; static current —
`/srv/tasktopia/static/releases/20261013220640-053e061d`.
Блокировка updater не была занята, свободное место — около 15.2 GB.
Повторное чтение после репетиции подтвердило прежние revision/images/static/
backup/lock и успешные healthcheck. У image нет revision label: Git SHA
подтверждает checkout, а image ID зафиксирован отдельно.

Последний **существующий** dump `pre-update-2026-10-13-215717.dump`
(99 166 633 bytes, remote/local mode0600) скачан через SCP в private0700 каталог.
SHA256 исходного файла и копии совпал:
`dc37a84c05fd54af8570e012c8e95102c55c0b6edc540dc120ea11cdf0aaca7c`.
Свежая отдельная native PostgreSQL16 база приняла `pg_restore` с exit0, без
stderr. Замороженный текущий кандидат применил только 0043/0044: 42→44.

Сравнение SQL SHA256 до/после подтвердило сохранность всех прежних строк
46 таблиц и последовательностей. Разрешённые различия: два новых поля страны
и две строки `schema_migrations`; прежние checksums не изменились. Проверены
allocator trigger, расширенный notification CHECK, album index и counters
не ниже максимума durable history. Сохранились 10 стран, 12 городов,
16 районов, 410 задач, 2726 комментариев, 1878 документов и по 6955 events/
receipts. Read-only world audit до/после: 72 блока, 15 447 дорожных клеток,
**0 нарушений**, без перегенерации и repair.

Артефакты: `backend/release-recovery-preflight/` в указанном `.builder`:
`candidate-manifest.json`, `remote-{before,after}.json`, `download.json`,
`restore.json`, `before.json`, `after.json`, `result.json`. Сохраняются только
агрегатные counts/hashes; рабочие тексты, имена, IDs и credentials не логируются.
Ни backup-команды, ни DDL, ни restore, ни deploy на сервере не запускались.
Копия датирована 13 октября: это проверка восстановления существующего dump,
**не свежая release backup и не разрешение на выкладку**. Штатный updater
после managed merge и Builder validation по-прежнему обязан создать свежую копию.

## Границы доказательств и выпуск

Эти прогоны не измеряют production throughput, не проверяют физические
устройства, TLS/reverse proxy или Redis под нагрузкой. В built MCP pack нет
static assets; браузерный UI и остальные runtime roles квалифицируются отдельно.
Дорогие generation horizons и общая browser matrix здесь не запускались.
Один начальный local createdb вызов без private credentials завершился
ошибкой; данных не менял. После authenticated `--no-password` создания DB
проверен SELECT1, все описанные suite/restore/smoke прошли изолированно.

Локальная QA не заменяет обязательные CI `dependencies`, `build-assets`,
полный `npm test -- --no-file-parallelism`, built MCP, compact recovery Python
integration и браузерные shards. Не заявлены CI green, SCM approval или выкладка.
Итоговый immutable candidate, npm audit, свежий публичный backup и применимость репетиции
и fail-closed managed release принадлежат общему финальному этапу.
