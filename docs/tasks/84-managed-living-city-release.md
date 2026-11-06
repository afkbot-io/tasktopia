# Управляемый выпуск живого города 1.28.0

Задача84 `71d16296-488f-4950-b3cc-e41380094c48`, страна
`4201d605-751a-469b-8d5f-a7e322a7ece1`. Это завершение общей цели живого
города, включая масштабные проверки и managed dev release на tasktopia.online.
Релиз ещё не выполнен. Runtime candidate перед этим срезом — `3ca66602`.

## Подготовка данных

`prepare --preserve-world --prepare-living-city` расширяет существующий
locked cutover. Флаг фиксируется в binding/targetId, recover/accept читают
сохранённый режим. Без нового флага поведение прежнее. Сначала проходят
свежий совместный backup/restore и прежняя строгая проверка каждой старой
строки после additive DDL. Только затем, при закрытом трафике и остановленных
writers, выполняются три фиксированных compiled CLI: transport → roads →
scenes. Каждый получает авторитетный country UUID и проходит preview,
write и физически неизменный repeat. Клиент принимает уже готовые сцены.

Docker adapter сохраняет точный digest кандидата, readonly rootfs, cap-drop,
no-new-privileges, CPU/memory/pids limits, private env/output и общий deadline.
Новые CLI не получают REGENERATION_FORCE; произвольные команды/параметры
не принимаются. Перед каждым вызовом повторяется assert_frozen. Ошибка
останавливает journal до активации и требует существующего joint recovery.

Независимая проверка сохраняет задачи, историю, страну/города/районы,
layouts/blocks/placements/local roads и любые неизвестные исходные таблицы
целиком. У страны может измениться только world_version. Закрытый перечень
derived cache tables разрешено перестроить. Существующие airport/railway/stop
rows и каждый принятый road object должны остаться неизменными; новые планы
могут добавляться. Preview и повторный write сравниваются с физическими
hashes БД, включая версии, cache bodies и updated_at. Blob/content задач в
отчёт не попадают. Receipt проверяет точный набор городов, event/mode/scope,
SHA и конечные размерные лимиты.

## Найденная ошибка receipt дорог

Новый маршрут давал разные SHA до и после JSONB round-trip: PostgreSQL
переставляет object keys. Публичный CLI regression сначала воспроизводит
разницу, затем проходит после детерминированной сортировки ключей при
расчёте receipt. Порядок массивов и вся сохранённая геометрия не меняются.

## Устранение пауз движения

Диагностический Chromium trace и CPU profile выделили линейный поиск
`network.zones.find` при освобождении и переназначении занятого перехода.
Public controller regression без изменения результатов поиска насчитал
108744 посещения элементов за200fixed steps. Reservation теперь хранит
ссылку на собственную immutable zone; её не нужно снова искать во всём
городе. Это одна ссылка на активную reservation, без индекса всех зон и
без изменения правил движения. При замене топологии reservations очищаются.
Тот же regression даёт0посещений; прежний real-city signal SHA и safety
сохраняются. 28mobility/retarget tests проходят. Итоговые timing gates
проверяются на обновлённой сборке отдельно.

## Проверки и текущие ограничения

Driver public RED→GREEN подтверждает порядок conservation→preparation→audit.
15driver и8helper Python cases проверяют opt-in, legacy path, запрет
активации при ошибке, фиксированные argv/image/env/limits, неверный scope,
mode/count/байты, источники/геометрию, unknown tables, frozen-plan multiplicity,
изменившийся preview/repeat и deadline. Они включены в обычный Vitest/CI.
Отдельный regression roadsCLI проходит preview/write/repeat настоящего
нового JSONB-маршрута; прежний rollback trigger и upgrade также проходят.

Локальная integration с PostgreSQL16 и тремя собранными CLI: одна страна,
три города (включая пустой), две задачи, один старый принятый маршрут,
отсутствующие stop plans и прежняя версия road planner. Подготовка сохраняет
98исходных строк в44таблицах, один маршрут, проходит11freeze checks и все
preview/write/repeat, включая повтор всей подготовки. Это принадлежащая
задаче disposable БД, не удалённый сервер и не доказательство выкладки.

Связанный набор mobility/transit:184PASS и один fixture failure. Последний
напрямую удалял stop plan, сохраняя world_version, поэтому корректно получал
прежнюю persisted scene. Fixture теперь публикует source change как обычная
topology-команда. Оба stop-store теста после исправления проходят; runtime
cache guard не ослаблен. В совокупности проверены185уникальных cases в31файле.
Build/typecheck и lint проходят. Исходные отказы сохранены в gate ledger.

Финальные масштабные прогоны, integration/recovery CI, итоговое AI/security
review и deployed smoke записываются после завершения. Нельзя считать
этот документ подтверждением выпуска или SCM approval.

Предварительный native10000 desktop проходит full journey, cold3543мс.
Повторный mobile при меньшей фоновой нагрузке проходит функциональный
journey без ошибок, cold23469мс / warm71–85мс, но две steady long tasks
54/57мс оставляют строгий gate непройденным. Эти результаты сохранены;
паузы профилируются отдельно. Первый отказ movement timeout тоже сохранён.
Ориентир client heap256МиБ не достигнут и не объявляется пройденным.

До открытия трафика действует только согласованное восстановление БД,
файлов и образов по runbook; после новых рабочих записей — forward fix.
