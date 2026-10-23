# Общая квалификация 1.25.0

## 23 октября 2026 — сохранение порядка транспортных очередей

На `fb40b51481d68b7cc711abe405736551a6fc0bca` три исходных WebKit-сценария
прошли: шесть повседневных событий с настоящими прибытиями, школьный автобус
с входом в школу и комментарий DELIVER → DISCUSS. Полная локальная матрица
200/1000 × четыре профиля × три samples дала24/24 STRICT PASS: ошибки,
нарушения бюджетов, исключения и retry0. Это результаты именно V21.

[CI39993943701](https://github.com/afkbot-io/tasktopia/actions/runs/39993943701)
обнаружил регрессию в unit-наборе:2060 PASS / 2 FAIL. При12 жителях первый
поезд к18с не получал пассажиров в обоих исходных offsets0/2500мс. Локально
эти два отказа воспроизведены без изменения существующего теста.

Парный18с public-prefix на одинаковой естественной популяции seed37 показал
RAIL.boarded1 на V20 и0 на V21. Прежний пассажир уже прибыл и сел при7200мс.
Новый выбранный житель остановился перед платформой с BODY: при16200мс
его progress оставался0,8361, wait15550мс, arrivedfalse. Снимки не усечены;
они сохраняют семантические переходы, а не непрерывную траекторию. Замена
порядка выбора доказана; детали конкретного встречного конфликта этими
данными полностью не устанавливаются. Оценка свободного движения не
учитывает очередь и потому не должна менять все обычные назначения.

Выбор по ETA теперь применяется только к конечному сроку подхода — например,
комментарию или школе. Без срока, включая явный Infinity, сохраняется прежний
одноразовый порядок соседей по всем целям и непрерывный курсор кандидатов.
Неподходящий кандидат не рассматривается повторно для следующего места.
Общий код настоящего маршрута, проходов и столкновений сохранён.

Два новых public-теста для отсутствующего срока и Infinity сначала дали RED,
а после исправления прошли. Узкий набор12 файлов дал78 PASS, FAIL/SKIP/TODO0,
включая все исходные случаи посадки/высадки, finite-budget, комментарии,
образование, входы и пересадки. Scoped ESLint завершён с кодом0.
Новая сборка, затронутые browser-сценарии, замеры и exact CI ожидаются;
результаты V21 не выдаются за квалификацию новых байтов. Выпуска ещё нет.

## 23 октября 2026 — выбор посетителей по времени настоящего подхода

На `0dacfb29a14c6dd0f492332023cb9c6ae66f04fb` исходный школьный WebKit
прошёл локально и в CI; полная локальная матрица200/1000 также дала24/24 PASS.
[CI39972258679, попытка2](https://github.com/afkbot-io/tasktopia/actions/runs/39972258679)
всё же завершился8 SUCCESS / 2 FAILURE: браузеры513 PASS / 2 FAIL /176 SKIP,
все691 сценарий учтены, NOT RUN0. Отказали KINDERGARTEN arrivals0 и COMMENT
без DISCUSS. Предыдущая попытка была отменена после долгой установки зависимостей;
один `rerun --failed` повторил только незавершённые browser4 и aggregate.

Наблюдатель детского сада увидел ARRIVE, ACTIVITY и LEAVE, но не прибытие.
Общий поток продолжал двигаться. Для комментария история показывает
DELIVER2 → пусто, delivered0: за31973мс прошло352 физических шага, то есть17,6с.
Снимок занял1354мс, после него DELIVER ещё наблюдался. Это не пропуск DISCUSS
опросом; конкретные выбранные маршруты в артефакте отсутствуют. Полная
причинность этих двух CI-отказов остаётся недоказанной.

Два независимых публичных контроля выявили недостатки допуска и выбора.
На прямой ребёнку назначался подход47 клеток: контроль действительно входил
через37500мс, а сценка снимала посещение при LEAVE34000мс без прибытия.
Теперь школа/садик проверяют остаток времени до LEAVE с запасом8с;
слишком долгий маршрут не назначается. Отдельный контроль36 клеток проверяет
именно новый запас: раньше он действительно успевал войти через28750мс.
Близкий контроль4 клеток входит и вызывает звонок.

На U-образном пути quota1 выбирала геометрически ближайшего жителя с обходом
28 клеток вместо другого с20 клетками. Парные обычные назначения подтвердили
настоящее прибытие обоих и порядок. Теперь выбирается минимальный ETA реального
маршрута с учётом скорости и сохранённого участка. Дешёвая нижняя оценка
останавливает поиск, когда остальные жители уже не могут улучшить результат.
Неназначенные жители не меняются; текущие сегменты, занятые проходы,
перекрытия, лимит48 клеток и проверки пересечений сохраняются.

Оба RED сохранены; новые4 регрессии прошли. Затронутые14 файлов дали106 PASS,
ещё3 файла внешних перевозок/пересадок/подготовки —46 PASS, FAIL/SKIP/TODO0.
Это152 разных проверки, без суммирования повторных запусков.
Срок комментария32с, оценка подхода24с, плотность и5×50мс физических шагов
за кадр не увеличены. ETA без очереди и запас времени не гарантируют прибытие
при любой нагрузке. Для этих новых байтов сборка, browser-cases, замеры и CI
ещё ожидаются; прежние24/24 не переименованы новым результатом. Выпуска ещё нет.
Актуальная общая квалификация — в [Task53](https://tasktopia.online/task/53?countryId=4201d605-751a-469b-8d5f-a7e322a7ece1&taskId=4f2ef16c-8172-4715-8e2e-27f88979df78).

## 23 октября 2026 — выход из здания в уже занятый проход

Квалификация V19 на `cae01e7ada0a35300e15c0db56a16ae671bfe4f7` сохранила
отказ исходного школьного сценария WebKit: 1 FAIL за359849мс, три рейса,
ни одного подтверждённого входа школьного пассажира. В первых двух эпизодах
посадка не состоялась; в третьем посадка/высадка выросли на1, подход к школе
появился и истёк без прибытия. Вход50,-75, собственные UUID и календарь
отличались от прежнего CI; это не точный replay. Два ранних жителя сохраняли
направление/число шагов не менее353950мс, зона двери оставалась занятой.
Телеметрия не содержала их координат и причин ожидания, поэтому полная
причинность школьного отказа по этой записи не установлена.

Независимый минимальный парный public-seam RED подтвердил другую блокировку:
выходящий житель появлялся внутри зоны, уже отданной входящему посетителю.
Входящий останавливался с BODY, выходящий — с RESERVATION; все100 последних
шагов за5с обе позы оставались неизменны. Контрольный посетитель действительно
вошёл. Использованы два реальных жителя, один фиксированный seed19, обычные
назначения и перекрытие уже пройденной клетки; скрытых маршрутов или разрешений
тест не подменяет. Исходный отказ подготовки отдельного probe сохранён как
PRECONDITION_NOT_ESTABLISHED и не засчитывается продуктовым RED.

Исправление допуска выхода проверяет и владельца текущей зоны, и обещанный
другому участнику выход. Пока проход занят, житель остаётся внутри. После
настоящего входа владельца разрешение освобождается и второй житель продолжает
движение. Геометрия, текущие физические сегменты, скорость, перекрытия и
проверки пересечений сохраняются. Оба направления — встречное и поперечное —
прошли новые регрессии; IDs/сеть стабильны, safety counters0.

Затронутый набор **102/102 PASS в12 файлах**, FAIL/SKIP/TODO0; scoped ESLint
завершён с кодом0. Результаты RED/предыдущего V19 native сохранены. Полная новая
сборка, исходный школьный browser-case, замеры200/1000, exact CI и выпуск
на момент этого checkpoint ещё не завершены. Актуальный итог будет в
[задаче53](https://tasktopia.online/task/53?countryId=4201d605-751a-469b-8d5f-a7e322a7ece1&taskId=4f2ef16c-8172-4715-8e2e-27f88979df78).

## 23 октября 2026 — отменённый подход к школьной двери на повороте

[CI39954498847](https://github.com/afkbot-io/tasktopia/actions/runs/39954498847)
на `7399a5a43fce07c12dc8ce33605ac2137e141e84` завершён: 8 SUCCESS / 2 FAILURE,
unit2051 PASS / 362 файла; браузеры514 PASS / 1 FAIL / 176 SKIP / 0 NOT RUN.
Единственный функциональный отказ — школьный автобус WebKit: в каждом из трёх
рейсов посадка и высадка выросли на1, появился подход к школе, но прибытия к
двери не произошло. Сессия37, геометрия и одна физическая сеть сохранялись;
первые пять остановившихся жителей не двигались не менее309950мс физических шагов.
Это не таймаут900с и не успешная квалификация.

Один отдельный public-seam контроль использовал настоящую сцену новой
изолированной QA-страны с seed424242, seed37 для24 автомобилей/32 жителей. Известные
входы92,-165 и101,-99 совпали; собственные UUID, календарный выбор учреждения
и timing отличались, поэтому это не точный replay CI. Житель40 шёл к школе
при ACTIVITY; при LEAVE посещение отменилось. Затем он остановился перед
поворотом без visit с OCCUPIED_EXIT. Новый обычный BUS visit возобновил его
движение без изменения сети. Школьный пассажир также не дошёл до двери.
После контроля собственные объекты удалены, business40 и schema44 совпали.

Причина закреплена минимальным парным RED через публичный CityMobility:
один житель, пустая прямоугольная дорожка, настоящий вход0,0 на повороте.
Контроль вошёл, а отменённый подход простоял все60с перед пустым поворотом:
steps0, wait60000, OCCUPIED_EXIT в100 последних шагах. Отмена убирала
visitTarget, сохраняя маршрут, чей конец лежал внутри конфликтной зоны;
исключение для входа исчезало, а наружного выхода в маршруте не было.

Исправление завершает физический подход к существующей двери без
восстановления отменённого посещения. Если дверь уже удалена из сети,
ограниченный поиск продолжает сохранённый путь до безопасного наружного
выхода. Текущий сегмент, занятый выход, перекрытия, столкновения и скорость
не обходятся; жители не пересоздаются. Та же обработка применяется при
истечении срока посещения. Удалённая дверь не допускает скрытого входа.

Пять регрессий проверяют отмену до допуска и после начала движения,
удаление двери до/после отмены и expiry после удаления. Все5 PASS;
затронутый набор **100/100 PASS в11 файлах**, без FAIL/SKIP/TODO, включая
прежние retarget/budget, автобус, комментарии, поездки жителей, допуск и
пятиминутные проверки физики. Отдельные RED удаления двери и expiry
сохранены. На этом контрольном срезе браузерный школьный сценарий и измерение
200/1000 для изменённого runtime ещё не выполнены. V18 full24 остаётся
результатом прежних байтов. Последующая квалификация и выпуск фиксируются
в [Task53](https://tasktopia.online/task/53?countryId=4201d605-751a-469b-8d5f-a7e322a7ece1&taskId=4f2ef16c-8172-4715-8e2e-27f88979df78).

## 23 октября 2026 — после CI c1c4: маршруты жителей и наблюдение коротких фаз

[CI39935303498](https://github.com/afkbot-io/tasktopia/actions/runs/39935303498)
на `c1c4e4925497ff0a50698df0b4812b5ac4b0f6ca` завершён:
7 SUCCESS / 3 FAILURE, unit2032 PASS / 360 файлов; браузеры433 PASS,
5 FAIL,164 SKIP,89 NOT RUN. Chromium: SCHOOL accepted1/arrivals0 и
повторное чтение WORK уже в COVER до переключения качества. WebKit:
общий six-scenes timeout720с, COMMENT без DISCUSS, опрос пропустил
DEMOLISH:WORK. Отдельное outside-test-error notice сохранено;
его причина UNKNOWN. Это не успешная квалификация или выпуск.

Гонка quality воспроизведена на публичном select: разрыв между чтениями
1809мс превышал окно WORK1550мс. Контроль RED511мс → GREEN500мс;
действие теперь выполняется один раз в callback фактического WORK,
с обязательными NORMAL/shot/crew и публичными input/change. Исходные
OPEN_SCHOOL/stage5/idempotency/reload assertions сохранены. На прежнем
frozen V17 native Chromium1 PASS9274мс: crew5→ECONOMY crew3→открытие.
Новый observer сноса сохраняет фактически опубликованный WORK вместо
позднего повторного чтения. Native WebKit2 PASS: комментарии21619мс,
park/override demolition13440мс; retry0, ошибки страницы0. Ограниченная
история комментариев сохраняет phase/прибытия/физические шаги для
диагностики, не меняя проверки. Cleanup/бизнес-данные/схема44 прежние.

Six-scenes по-прежнему выполняет все6 видов, каждый20×2000мс реальных
физических шагов. В CI WebKit первые4 полных цикла заняли541395мс
API wall time, затем timeout во время SPORT; BIRDS не достигнут.
Совокупный QA timeout теперь1200с; NORMAL, плотность, DPR0,25 в CI,
физика, safety и требования реальных прибытий прежние. Это изменение
срока агрегатного теста на программном рендерере, не ускорение приложения
и не подтверждение успешных шести сцен. CI job70мин остаётся ограниченным.

Независимый маленький public regression воспроизвёл взаимную блокировку:
same-id retarget менял маршрут владельца занятого перехода, сохраняя
резерв прежнего выхода. Seed73/два жителя/обычные публичные visits:
контроль прошёл, treatment сохранял BODY/RESERVATION без изменения поз
последние100 шагов по50мс, safety0. Отдельный RED доказал назначение
доставки комментария на46 клеток, физически дольше исходных32с эффекта.
Оба исправления прошли отдельный TDD; они не объявляются доказанной
причиной исторических SCHOOL/KINDERGARTEN или COMMENT отказов CI.
Общий итоговый набор: **68/68 PASS в7 файлах**, без FAIL/SKIP/TODO;
исходники до/после проверки совпали. ESLint5 изменённых runtime/unit
файлов и обоих e2e файлов PASS. Same-id и fresh-id назначения, старый
выход, остановка внутри зоны, закрытый/недостижимый путь, общий предел48,
ETA полного обхода и сохранение позы проверены через публичный API.
Комментарий выбирает подход с оценкой движения до24с, оставляя8с из
прежних32с для ожидания/сигнала прибытия; это оценка свободного движения,
не гарантия при очередях. Иначе показывается исходный SIGNAL на6с.

V18 source `5ef3ef7e4b37e14d73d85d5fc98340c7759dc43ed3baa7196dad9295b63a6c6a`,
QA580 `723aeb13aa211cf4a56241eb480e42aadfbdc202a690c933d56db29fb4a93073`.
Одна стандартная build/full TSC/freeze прошла; backend/server и game assets
побайтно прежние. Native4 завершён с 3 PASS / 1 FAIL: quality8611мс,
шесть событий402296мс и park/demolition13672мс прошли. Во всех шести
событиях были реальные прибытия; собака принесла предмет. WebKit comments
37056мс завершился отказом старого oracle: первый SIGNAL/visitors0/arrived0
исчез через6с, а тест безусловно ждал DISCUSS. Этот исход сохранён;
он не устанавливает причину прежнего CI COMMENT/DELIVER2 без прибытия.

QA-only9ebb выбирает ветку по первому опубликованному admission.
Visitors>0 по-прежнему требуют DISCUSS за35с и arrived>0; visitors0 —
SIGNAL/staticfalse/arrived0, expiry и отсутствие replay. Сохранены duplicate,
burst5/comments6/merge/UPDATE, noSceneReads, stage smoke, safety и CPU.
Runtime прежний; frozen QA580723a сохранён, current QA580
`a44c89bfc0b0f03a8a545daa013685764bb6959af26b7bd02be27ca22fe206eb`
отличается только этим тестом. Его ESLint прошёл. Адресный native WebKit
прошёл за10722мс: первая ветка DELIVERY с2 посетителями, DISCUSS/arrived1
через2101мс публичного времени, серия и UPDATE объединились, стройка
показала WORK/дымок. Summary65d94db8; новый обязательный seed gate не вводится.
Это выполнение ветки DELIVERY; полный сценарий нулевой ветки отдельно
не заявляется пройденным. Собственный runtime/публикация822 неизменны;
процессы закрыты, порт5343 свободен, business40/schema44 сохранены.

V18 full24 завершён с **24/24 STRICT_PASS** без исключений и повторов:
4 профиля ×200/1000 задач ×3 замера, исходные нагрузки и бюджеты сохранены.
Максимальный cold DOM-ready для1000 задач: Chromium2114мс, Firefox2446мс,
Android CPU4/CDP network9530мс, iPhone WebKit1643мс. Максимальный warm157мс,
input p95 106мс, RAF p95 19мс; Chromium retained heap≤1118324байт.
HTTP:24 cold,0 pan/warm/legacy; ошибок приложения/консоли0, предупреждений54.
Steady LongTasks0 в12 поддерживающих замерах; остальные12 и heap FF/WebKit
недоступны и сохранены null, а не измеренным нулём. Геометрия/dumps200/1000
сохранены, порт5311 свободен и собственные DB connections0.
[Переносимый отчёт](https://tasktopia.online/api/attachments/99979326-b5c5-4a3e-9881-719c0546a33d),
SHA256 `fe462f716a23e6f9ac056cb4835e6580e57b7afdfaeb3808ca45bda4b7d592f9`.
Три замера дают range/median, не loading p95; DOM-ready не compositor paint,
RAF не INP, JS heap не GPU memory. Физические телефоны/CDN не измерялись.
Новый exact-head CI и выпуск ещё ожидаются. V17 ниже остаётся историей.

## Историческая точка V17: локальная квалификация PASS, три отказа CI и исправление тестового транспорта

На HEAD `b9399fe38069de3682551a403866190b4188f03d` одна стандартная build/full TSC/freeze и readonly200/1000 прошли; native9 — **9/9 PASS**, исходная full24 — **24/24 STRICT PASS**, без retry/exclusion. Performance summary `cb0675e660c70f56ca0cb2e95fedd82ec2ea33f27a00240fee6d12db87ed1e92` приложена к Task53. HTTP24cold/0pan/0warm/0legacy, console0errors/54warnings; недоступные FF/WebKit метрики остаются null. Только эмуляция телефонов. Эти результаты не заменяют отказавший CI.

[Полный CI39916145369](https://github.com/afkbot-io/tasktopia/actions/runs/39916145369) завершён: все10 jobs terminal,7SUCCESS/3FAILURE/0cancel; unit2032PASS/360files, browser512PASS/3FAIL/176SKIP/0NOTRUN. Отказы: Chromium KINDERGARTEN accepted3→arrivals0; Firefox не показал переименованную зависимость; WebKit delayed transfer опубликовал LIFT→EMPTY без CARRY. Причины первого и третьего пока UNKNOWN. Отдельные неизменённые локальные controls прошли: six-scene211622мс/KINDERGARTEN arrivals2 и transfer16807мс/CARRY. Они не переименовываются в успешный CI. Первый CDP-захват жителей INCONCLUSIVE из-за ограничения маршрута; его данные и отдельный исходный PASS сохранены.

Для Firefox actual trace доказал инъекцию synthetic42 в probing WebSocket до actual upgrade5. Предварительный и browser bootstrap совпали (cursor2906, event2907), поэтому гипотеза устаревшего курсора для этого отказа опровергнута. Контролируемая задержка native2probe: прежний OPEN-only helper дал RED15774мс на исходном rename15s; helper с существующим upgradedSet/send5 pattern дал GREEN1244мс, dependencyGET1→3 и исходные rename/delete/owner assertions. Page/console errors0, SWwarning1; cleanup и схема/рабочие данные прежние.

Тот же guard установлен в пяти QA helpers: task-card, news-feed, replay-recovery, navigation-scope и city-render. Тела сценариев, курсоры, таймауты и assertions вне guard byte-equal; scoped ESLint5 PASS. Disconnect продолжает закрывать все owned sockets; replay не ждёт online при удержанной истории. Промежуточный QA578 hash `3b3865832d6416f2cc9994ee8828482aaf9e0559ed3dc3418dd13cf2aaf4813a` фиксирует эти пять исправлений в коммите `1d8a88c5e5e0516cab1c058ee78f7ee4fcb0c8f5`. Исправление общей небезопасной примитивы не доказывает причины других исторических отказов.

Второй CDP-захват KINDERGARTEN завершён без ошибок: исходный сценарий **1PASS/203638мс**, пять снимков до/после назначения и перед clear; один выбранный ребёнок прошёл маршрут29 клеток, прибытие впервые наблюдалось через20,266с. Во всех снимках outdoor/noncarrier ожиданий>30с нет, IDs56 сохранены, safety0. Порядок DOG→KINDERGARTEN и selected1 отличаются от CI с пятью предыдущими сценами/selected3; первый неправильный переход не найден, причина CI остаётся UNKNOWN. Снимки не вводились обратно в приватное состояние приложения. Все собственные серверы/CLI закрыты,5343 свободен, бизнес-данные/схема44 прежние.

QA cinematic observer сохраняет время первого/последнего callback и11 существующих public host flags в прежних записях. Signature, cap32, три наблюдаемых атрибута, clear, CPUmax и assertions/deadlines не изменены; отдельного polling нет. Exact helper прошёл исходный native WebKit transfer: **1PASS/16807мс**, EMPTY→APPROACH→LIFT→CARRY, нужная видимость; CARRY наблюдался через4523мс после APPROACH. Это callback timestamps, не GPU presentation; промежуточные изменения host flags не восстанавливаются. Исторический LIFT→EMPTY не объяснён. Итоговый QA578 hash `974f3b3f42d5b338bc4807b7fce199cc024440a1ab1cc84a39f4414e17b878ec` включает пять transport guards и этот helper; runtime1263/source4402 byte-equal, frozen QA18f1 и все старые результаты сохранены. Новая build/native9/full24 для QA-only изменений не требуются; новый exact-head CI обязателен.

G03 повторно открыт:28/33, TESTING85. Итоговая ревизия/новый exact CI, merge, Builder, fresh backup, public smoke и300с наблюдения ещё не выполнены. Сайт не обновлён; актуальная область и полный review package находятся в [Task53](https://tasktopia.online/task/53?countryId=4201d605-751a-469b-8d5f-a7e322a7ece1&taskId=4f2ef16c-8172-4715-8e2e-27f88979df78) и [PR58](https://github.com/afkbot-io/tasktopia/pull/58).

## 23 октября 2026 — v17: приоритет видимых материалов (точка до CI и выпуска)

Source `4402a481f5aca94464ffc79c3f0afcb9a9d9885a21b0fd0ed39ccd1879d97861`, QA `18f1ee04358e3a6f43e614221920640ae8543c7d51e14f9b6668174efe7cf2d1`. Только WorldCanvas/map-frame-work и регрессия очереди: обе операции видимых деревьев получают приоритет1 вместо2, раньше любого padding halo2–5. Видимость переоценивается при исполнении; FIFO и лимиты1 interactive/3 initial/4ms сохранены. Остальные приоритеты и проверки готовности прежние.

TDD старой политики:9PASS/3FAIL →12PASS в2файлах; ещё56PASS в8 непересекающихся файлах, scoped ESLint3PASS. Изменённая очередь требует новой квалификации; V16 native8/full24 остаются отдельными историческими результатами.

В CI39911991751/c77 WebKit Back получил правильный сохранённый pose, но материал ещё готовился на15s: target terrain5→0, очередь/деревья продолжали работу. Ошибок сети/страницы нет; это не доказанный полный stall, точная причина замедления UNKNOWN. Тот же исходный native WebKit case без изменений прошёл локально за3,725s. Найденная приоритетная инверсия воспроизведена отдельно; она не выдаётся за доказанную причину CI. Таймаут15s и точность восстановления0,3 не ослаблены.

Новая сборка, native9, 200/1000 full24, exact CI и выпуск на этой контрольной точке ещё PENDING. Фактические результаты и окончательная ревизия фиксируются в [Task53](https://tasktopia.online/task/53?countryId=4201d605-751a-469b-8d5f-a7e322a7ece1&taskId=4f2ef16c-8172-4715-8e2e-27f88979df78) и [PR58](https://github.com/afkbot-io/tasktopia/pull/58). Исторические FAIL/UNKNOWN и прежние JSON сохранены. Все33 критерия, маска0,16/ACTIVE badges и продуктовая граница MCP остаются в области.

Область: [33 критерия общей цели](PLAN-WORLD-RELIABILITY-EVOLUTION-2026-10-16.md),
задача [№53](https://tasktopia.online/task/53?countryId=4201d605-751a-469b-8d5f-a7e322a7ece1&taskId=4f2ef16c-8172-4715-8e2e-27f88979df78).
База — `053e061d84dbcafdeaf1841010f9bd2286c9c5f8`, цель выпуска —
`game3/dev-server/dev/all` через Builder и официальный updater.

## 23 октября 2026 — v16: камера, quality и новая квалификация PASS; CI/выпуск ожидаются

V16 source `04f4ed0c9befff008bdf4ae5b5b56dbc86cf94dc8f1933dfc7a0cdfc36988cc7`, QA578 `258a2366a20e74bca07acefb6b8a805fbc57ac6286d56dde98391bae696e4931`. Против V15 изменены только WorldCanvas и city-cinematic-view: same-range reuse продолжает публикацию pending камеры; смена качества сохраняет принятый timeline/target-readiness, сразу уничтожая лишних рабочих и освобождая их пути до3/shot. Version/history/hard deadlines и штатные hidden/map exit/resync отмены сохранены; незагруженный target не подтверждает открытие.

Контролируемые public camera2/quality1 RED на V15 → новые native8 GREEN. Unit crew RED4PASS/1FAIL → affected48PASS/7files; camera80PASS/8files — непересекающиеся наборы. QA также исправляет устаревший async pad oracle и добавляет первый panFocus без quality lock. TOW/WATER разделены на два target-case: КАЖДЫЙ180s/9attempt/31×1s/arrival/cargo/closure/safety; до31 уже прочитанного frame сохраняются вfinally без extra RPC. Это изоляция прежнего общего180s, не утверждение о неизменном совокупном test wall budget или ускорении clock.

Одна build/full TSC/freeze PASS (`c0914411…`), server/assets byte-equal V15; новые client48be214c/HTML90e1ccea/manifestd9decfae. Readonly200/1000 (`82c49e9b…`) сохранил geometry/status/dumps без seed/restore. Native8 **8/8PASS/128,268977с**,0retry/SKIP/flaky (`eb68b1e3…`,postflight `780e73c2…`): camera2/lifecycle/quality/owner2, workers5→3→0/shots1→1→0 и OPEN_SCHOOL без replay; оба TOW-case31frames/safety0/arrival/trips1, BREAKDOWN cargo=true. Visible/target padding0 не требует пустой offscreen очереди9/terrain6/tree3. Intentional movement-timeout console error1 EXPECTED отделён от pageerror0 в исходных проверках. Fresh own822/920canonical,5343FREE/ownedserver+CLIclosed/DB0/business31fa40 прежний. Root native visual NO_OPEN только в2кадрах (`5b49731e…`).

Новая original full24 V16 — **24/24STRICT PASS**,8reports=24raw, все24 функционально завершены, error/violation/retry/exclusion0;4профиля×200/1000×3/NORMAL/CPU-network-DPR/churn20/steady8s и исходные performance budgets сохранены. Cold max200/1000(ms):Chrome1061,364/1955,707;Firefox1271,882/1856,733;PixelCPU4+network5421,036/8307,072;iPhone818,352/1148,148. Max warm99,146125ms/input p95 45,1ms/RAF p95 19ms/Chromium heap+1393032B. HTTP24cold/0pan/warm/legacy; console0errors/54warnings/trunc0. LongTasks/heap12available/12unavailable=null; все12 измеренных steadyLT0. Host gate5PASS, during294intervals weighted idle87,665%/min73,538% — только context, без исключений samples.5311FREE/ownedDBother0/readOnly/source920+822 fences прежние. Root2portrait1000 PNG NO_OPEN (`76ff1631…`), resized/emulation, не все состояния и не физические телефоны.

[Новая performance summary](evidence/city-scale-2026-10-23/task-focus-reliability-v16-summary.json), SHA `7c9f34836d0f50b041ad0279f759e9d7aeb625f2c11176fb1f11c5c251cc0252`; [новая qualification summary](evidence/city-scale-2026-10-23/task-focus-final-qualification-v16-summary.json). V15 JSON `03501bec…`/`7138c43f…` и все прежние FAIL/UNKNOWN сохранены, не переименованы. CI56 завершён FAILURE6SUCCESS/4FAILURE/10jobs (`c1bde5c0…`):unit2027PASS/1FAIL, browser414PASS/4FAIL/163SKIP/106NOTRUN. Новый HEAD/tree/exact CI/merge/Builder/public smoke/300с **PENDING**;29/33 приняты до окончательных CI/release, E01/E02/Q02/Q03 открыты. Полные33 критерия/U08/U09, MCP/security/recovery и прежние QA-контракты остаются в области; новых release gates нет.

## Историческая точка 23 октября 2026 — v15: compiler clearance, native2 и full24 PASS до V16

V15 source `9f8d417815a6e8adc786694e13e3c737eb49f82e367fc411ecda6f6b342091ee`, QA578 `9eef2d18bc767f1ca9ac56b7258157b5df612f5b6581b360cd7b2cbd0a973bee`. Из 1263 runtime inputs против V14 изменена одна строка city-everyday-life.ts: подходы зрителей исключают все восемь соседей animal pad, включая диагонали. Поворот walker с inset0,25/0,25 больше не допускается внутрь clearance0,8/0,8. Server/assets byte-equal V14; client/HTML новые. QA:5 изменённых файлов+2clock helper/spec. Причина исторического CI BIRDS остаётся UNKNOWN.

Публичный compiler TDD: RED10PASS/2FAIL из 12→первый GREEN11/12(старый perf pad0,1 теперь небезопасен)→final12/12PASS. Исправлена только fixture y+2/expected0,2; kinds3/lookup≤49/ground≤2N прежние. Affected73/8filesPASS и scoped ESLint PASS; пересекающиеся наборы не складываются в 85 уникальных тестов. Одна стандартная build/full TSC/freeze PASS(`bc434bbd…`); readonly200/1000(`18562d3a…`) сохранил geometry/status/descriptor/dumps без seed/restore/regeneration.

Новые исходные native WebKitDPR2 — **2/2PASS/342,922861 с**,0retry/SKIP/flaky(`988333c6…`): все шесть бытовых сцен с реальными arrivals, BIRDS animals3/scattered и DOG animals1/fetched, unavailableSlots0; сохранённые safety counters0. Construction1→2→3→4→5/WORK, TRANSFER:CARRY, DEMOLISH:COVER/ruins/audio прошли. Animal/phase/occupied-slot assertions и исходные deadlines не ослаблены. Root BIRDS PNG NO_OPEN только в просмотренном состоянии. Собственная новая V15 publication822 `f8a84f80…`/920canonical,5343FREE/server+CLIclosed/DB0/business31fa40 unchanged; старая V14 attestation не переносилась.

Новая V15 full24 — **24/24STRICT PASS**,8reports=24raw/errors0/violations0/retry0/exclusion0; root19775exit0. Исходные 4 профиля×200/1000×3/NORMAL/CPU/network/DPR/churn20/steady8s/strictbudgets сохранены. Cold1000max(ms):Chrome1962,219/Firefox1845,403/Pixel(CPU×4)8265,484/iPhone1147,981. Global max warm95,923ms/input p95 43,4ms/RAF p95 19ms/Chromium heap growth1281556B. Это три samples, не loadingp95. Console0errors/54warnings/trunc0; HTTP24cold/0pan/warm/legacy. LongTasks12Chromium steady0;12FF/WK unavailable=null, heap толькоChromium/RGBA неVRAM. Host gate5PASS; during load не отбрасывает samples.5311FREE/ownedDBother0/source920+822 fences unchanged.

Прежние clock/ground native15 и шесть reveal/transfer Chrome из native16 остаются отдельными reuse на неизменных границах; это не новые V15 прогоны и не byte-equal claim всего everyday spec. Full24 V14 `74efab04…` сохранена без изменений и не переименована в V15. QA-calibration history сохранена: visible critical readiness вместо полного background drain; safe passenger recovery после resume; public fixed-date/pause/system-time; phase JSON вfinally/snapshotsfalse. Ранее смешанный async planning limit50→20000ms — QA wall-контракт по owner deadline, не CPU-оптимизация; road50ms/CPU8ms/heap8MiB/workload прежние.

[Новая performance summary](evidence/city-scale-2026-10-23/task-focus-reliability-v15-summary.json), SHA `03501becf6cb3a7f5fcd824a03f2f1f3720af8e2381c0e94d9beafd6b04728e3`; [общая qualification summary](evidence/city-scale-2026-10-23/task-focus-final-qualification-summary.json), SHA `7138c43f1fe1e9d648e2dd3033cd400ecb8ec669cc2b9b2f9d3320dcd726e65a`. Все 33 критерия/U08/U09 и исторические RED/UNKNOWN сохранены. CI717/39896216677 завершён FAILURE6SUCCESS/4FAILURE/0CANCELLED; локальные PASS его не заменяют. Будущие HEAD/tree/exact CI, merge/Builder/public smoke/300 с **PENDING**, E01/E02/Q02/Q03 открыты. Только браузерная эмуляция; физических телефонов нет. Новых release gates не назначено.

## Историческая точка 23 октября 2026 — v14 native12/full24 PASS до исправлений QA

Source `51f67980cec9fe77c7f9cb617909c3a12a1b92f0065cfb6b6b292938ac33e247`: только4static render-group flags против v13, остальные1262runtime/576QA совпадают. Server/география/assets прежние. Одна сборка/full TSC/freeze (`bc0ebc39…`) и readonly200/1000 (`9de56c39…`) PASS; geometry/status/descriptor/dumps сохранены без seed/restore/regeneration.

Native12 — **12/12PASS/82,414293s**,0retry/SKIP/flaky, JSON↔journal12 exact (`ae209b6f…`). Root4actual PNG NO_OPEN: Pixel320/iPhone empty-mask, WK full-detail DAY, Chrome atlas maximum (`7a50ad79…`); resized WK не даёт exact pixel claim, физических телефонов нет. Собственная attestation822 `2cf06e36…`/920canonical и native cleanup5343FREE/DB0/business31fa unchanged сохранены.

Исходная full24 — **24/24STRICT PASS**,8reports/raw equality/functional24/errors0/violations0/retries0/exclusions0, launcher47586exit0. Четыре профиля×200/1000×3/NORMAL/churn20/steady8000/coldv2/CPU/network/budgets сохранены. Max warm79,781ms/input p95 45,2ms/RAF p95 19ms/Chromium heap growth1617468B. Cold max200/1000(ms): Chrome1077,524/1968,514; Firefox1292,307/1773,052; Pixel5412,436/8256,882; iPhone800,443/1141,136 — это не loading p95.

Console errors0/warnings54/trunc0; HTTP24cold/0pan/0warm/0legacy. LongTasks12Chromium steady0,12FF/WK unavailable=null; heap толькоChromium, RGBA estimate неVRAM. Postflight:5311FREE/owned2001000DBother0/readOnly/source/output fences unchanged/920+822. [Portable actual summary](evidence/city-scale-2026-10-23/task-focus-reliability-v14-summary.json), SHA `74efab046d379561c7e820cb1d82bed367ba4239d540fbde75d65bbf9f71e2ae`; private aggregate `106b6672…`. Исправлена только ссылка runnerV13→actualV14, raw/metrics не менялись.

V13 STRICT_RED23/1RAF33,34>20ms, V12 coldRED3813,698>3000ms и native137/formalnull/causeUNKNOWN сохранены. Диагностика `e162/f13d` RAFRED не воспроизвела; разные119→374→464builds/+3GL calls не дают общего speedup/causal claim. Новый exact-head all10CI, merge и managed release **PENDING**, E01/E02/Q02/Q03 открыты; все33 критерия/U08/U09 сохранены. Backup по runbook + применимость имеющегося restore-proof, без нового restore gate.

## Исторический кандидат v13: native PASS, full24 STRICT_RED

Runtime source `7b08afcbcc186eb839a2823d75985497ed2fea8cbaf82a196eaae7eedcc5e8c3`;
qualificationHash `4ede361bab37911dd3129044d3b71b7433f887741fd43e98f7c65d67f33b2307`.
Только `cooperative-preparation.ts` изменён против v12, остальные1262 runtime
inputs совпадают; QA576 содержит четыре изменённых файла и572 совпадающих.
Сервер/shared/package/lock/assets прежние. Compiled server `dbc7be70…`,
client `04271b71…`, HTML `f15ea4e5…`, manifest `cc55f8eb…`.
Одна `npm run build` с `npm run typecheck`→`tsc --noEmit`, freeze/verify и readonly200/1000 — PASS.
Новая собственная V13 attestation822 (`e75550b3…`) сохраняет920 canonical outputs;
повторные native startup проверяли её, без новой переаттестации и копирования v12.

Fairness policy даёт обычную owned MessageChannel/timer задачу после семи
native continuation. Slice4ms/checkpoint8192/owner20s, native receiver,
cancel/late-callback fences и обработка ошибок сохранены. TDD RED→GREEN;
итог **68PASS/6files**, scoped TS/lint PASS, промежуточные67/1 test-isolation
FAIL сохранены и не суммируются с68. Это не гарантия32ms wall turnaround
и не установленная причина прежнего Firefox cold3813,698ms.

Первая native22 оборвалась **exit137/INCOMPLETE**,13cases started/9notstarted;
formalPASS/FAIL=null, причина UNKNOWN, final JSON отсутствует. Старые raw
не изменены. Отдельная одобренная операция очистила только собственную оставшуюся
fixture исходным country→user cleanup в одной guarded transaction и проверила
business31fa до commit; QA40 восстановлена без seed/restore/reset.
Receipt cleanup `1846d028…`; никакого OOM/watchdog объяснения по137 не заявлено.

Отдельная R2 — **22/22PASS за454,832221s**, CLI/helper0, retry/SKIP/flaky0:
Chrome5/Firefox4/desktopWebKit5/Pixel5/iPhone2/Pixel3201;10 frozen QA файлов,
overrides0. Durable reporter/heartbeat добавили только наблюдаемость;
root точно сверил22 journal tuples/status/retry с обычным JSON.
Sixscene —312,849s/nativeDPR2/исходный720s deadline, все шесть видов с реальными
visitors/arrivals/safety. Controlled paused RAF regression, task-entry keyboard,
recovery/quality/resync/atlas/real-clock CPU/heap также прошли.
Root лично просмотрел четыре actual PNG error/Retry320/iPhone и task-card/preview320:
NO_OPEN в этих кадрах, receipt `228adcc4…`; физических устройств не было.

Новый **dense4 —4/4PASS13,748069s**: два прежних200-task case×Chrome native/WebKit
fallback. Geometry `59e5defd…`, business `6de64914…`, status160/30/10 неизменны;
native/fallback gates подтверждены. R2 и dense4 завершили ownedserver/CLI,
5343/5367FREE/DBother0/business/frozen920+822 cleanup PASS, без seed/restore/build.

| Фактическое локальное доказательство v13 | SHA256 |
| --- | --- |
| build/fullTS/freeze `.builder/world-perf-20261022/reliability-v13-build-summary.json` | `b30d29426dbd2029e2998f4d83872df774e2c050260b920c1c000de6b4edcb9d` |
| readonly200/1000 `.builder/world-perf-20261022/task-focus-reliability-v13-fixture-preflight.json` | `5a1072986ab97614aaf10343278dea830bdc7d029a70ab74be1060cb1e55ec44` |
| first native22 interrupted summary | `5cb2f4bdde282d476f2446820fb2d0a33140c344615f36d9662ff737bd548e6a` |
| exact own-fixture cleanup | `1846d0281ea0c81f5cb8b61f2d66948b2214dfbbf3f2877d244c2f658af9f276` |
| `.builder/native-qa40-scheduler-v13-r2-20261023/summary.json` —22PASS | `e93388fe62feee40cc5e3ca8e5710d1533396aad6af9b02ef9fdc50d00634109` |
| `.builder/native-qa40-scheduler-v13-r2-20261023/root-visual-review.json` —fourPNG | `228adcc458499e2dac714f61bd98ba9a2387c1124f490ec5d15009542225893b` |
| `.builder/native-scheduler-dense200-v13-20261023/summary.json` —4PASS | `7e0b7680452a52c151928418c8999432d248d6d9aa39dcf44ea4bcda7a25bcb7` |

**Full24 v13 — STRICT_RED:23 budget PASS/1 RAF RED, все24 функционально завершены.**
Launcher91512exit1,8reports; все raw sample равны report.results,
retries/исключений0, source/output fences сохранены. Original host gate прошёл.
Firefox1000 sample0 RAFp95=33,34ms>20ms;
остальные два RAF16,78/16,80ms и все cold1962,993/1834,709/1745,415ms<3000ms
прошли, errors0. Причина RAF UNKNOWN.
Console errors0,54warnings без усечения:24blockedSW/6contextlost/12texImage/
6lazyinitialization/6deprecatedrendererinfo. LongTasks12Chromium steady0,
12Firefox/WebKit unavailable=null, не измеренный ноль. HTTP24cold/0pan/warm/legacy;
postflight5311FREE/обеownedDBother0/source920canonical+822copies сохранены.
Aggregate `.builder/world-perf-20261022/task-focus-reliability-v13-summary.json`,
SHA256 `afd4944bd17799bc6da7e99cf56741869ea70479264f92c0b1e2bc373e01c50e`.
Исходные4profiles×200/1000×3, NORMAL/churn20/steady8000,
coldv2/budgets/CPU/network/DPR не менялись. Частичный exit0 не означает STRICT PASS;
v12 STRICT_RED ниже сохраняет собственную привязку, без retag/waiver/causalclaim.
Последний CI fd2 `39879045508` окончательно FAIL:6SUCCESS/3FAILURE/1CANCELLED;
browser4 totalsUNKNOWN при70min job timeout, progress161/168 не PASS count.
Новый exact-head CI, merge и managed release не выполнены и заблокированы
до ограниченного разбора/устранения RAF RED; общая цель33 критериев
не завершена. Для релиза остаётся свежая резервная копия по runbook и проверка
применимости уже имеющегося restore-доказательства; новый fresh-restore gate
этим документом не вводится. Public smoke и300s observation ещё не выполнены.
Следующий шаг — одна ограниченная диагностика RAF; на этой точке она ещё
не запускалась. Никакого waiver или нового PASS по итогам23/1 не заявлено.

## Историческая точка 23 октября 2026 — кандидат v12

Runtime source: `0f04382b237f2874545162f4ccbc80ccf9131c53d5b37ae05a9d625bc993ec1f`.
При наличии API подготовка города использует `scheduler.yield()`, с прежним
MessageChannel/timer fallback, порцией 4 мс/8192 checkpoints и owner deadline 20 с.
TDD выбора планировщика: RED→GREEN, итоговый затронутый набор **61 PASS / 6 файлов**;
пересекающиеся промежуточные наборы не складываются. Полный TypeScript в одной
стандартной сборке v12 и readonly preflight существующих городов 200/1000 — PASS.
Из 1263 runtime input только два CSS отличаются от v11; сервер, shared,
зависимости и игровые assets совпадают. Из 576 QA input изменён один spec.

V11 native17 дал **16 PASS / 1 FAIL**, не успешную матрицу: Firefox-перехватчик
JSON получил `Content-Encoding:zstd` после передачи браузерного Accept-Encoding.
В двух тестовых JSON fetch явно выбран `identity`, как в соседних сценариях;
production compression не менялась. Отдельные dense200 проверки — **4/4 PASS**:
реальные native scheduler и MessageChannel, отмена и позднее обновление.
Их неизменные логические границы сохраняют исходную привязку v11.

Просмотр PNG обнаружил настоящий мобильный дефект: подпись Retry требовала 79 px
при clientWidth 48 px, а alert пересекался с кнопкой экскурсии. Новая публичная
проверка получила этот RED на неизменном v11. V12 задаёт ширину, перенос и
положение alert через CSS. **8/8 новых native PASS за 28,365 с**, без SKIP/flaky:
ошибка/pan/обязательный Retry на desktop, Pixel, iPhone и 320×568; same-content
и resync в Firefox/Pixel. Четыре DOM attachment подтверждают границы и Retry 44 px;
основной агент просмотрел PNG iPhone и 320 px: обрезания и наложения нет.
Квитанция `.builder/native-streaming-error-layout-v12-20261023/summary.json`,
SHA256 `4a0476f55a16a8b178855f02d406aee1ab363fdc3e987650c70b5c7888775148`.
Это восемь новых проверок; исторические FAIL и RED сохранены.

Полная серия v12 завершилась **STRICT_RED: 23 PASS / 1 cold RED**, все 24 замера
и восемь групп выполнены. Firefox1000 sample1: **3813,698 мс > 3000 мс**;
остальные два — 1717,022 и 1656,412 мс. Функциональных ошибок нет; HTTP24 cold,
0 pan/warm/legacy. Ошибок console0, предупреждений54. LongTasks: 12 Chromium
окон имеют0, в 12 Firefox/WebKit эта метрика недоступна (null).
Между React-меткой готовности первого кадра и снятием переходного экрана
в RED наблюдалось около2,18с. Это не доказательство compositor paint или причины
задержки. Cause UNKNOWN, retries/исключений/изменения бюджетов нет. Собственные
процессы закрыты, данные и frozen bindings сохранены.
Квитанция `.builder/world-perf-20261022/task-focus-reliability-v12-summary.json`,
SHA256 `be18c34210835d89ecaa43ee764f298004d19bf7723e5087341816fa12c29b79`.
Новый exact-head CI, merge и managed release ещё не выполнены. Нельзя считать
исторические v10 результаты производительностью v12 или объяснением прежних
CI timeout. Точная итоговая ревизия/CI/выкладка фиксируются в задаче №53 и PR58.
Физические телефоны по решению пользователя не проверяются: только эмуляция.
Ранее принятый QA-порог async wall изменён **50→20000 мс** до существующего
owner deadline; road CPU 50 мс, paired CPU p95 8 мс и heap 8 MiB сохранены.
Это отдельное исправление смысла метрики, не утверждение о сохранении всех
исторических порогов и не доказательство причины старого CI max 1452,7 мс.

## Историческая точка 23 октября 2026 — v10: адресная приёмка PASS

Source v10: `2ecdc8bec3737d85a105e366a1037e01f057093a5aafab9ae358c0cfa44badd5`.
Открытый визуальный дефект v9 получил публичный RED **24 → 11** построек
при PNG503 вместо ≥23. V10 сохраняет **24 → 24**, фактический stage3 до PNG;
настоящий Retry восстанавливает count24 и фактический stage4.
Основной агент просмотрел новый PNG: соседние постройки и стиль сохранены.

Compiled native v10 — **16/16 PASS за 124,929476 с**, без SKIP/flaky:
6 Chromium, 4 эмулированных Pixel, 3 эмулированных iPhone и 3 WebKit.
Одна сборка с полным TypeScript и readonly-города 200/1000 — PASS;
независимое AI-ревью `827f3682…` — без открытых замечаний.
Frozen: **920 исходных файлов + 822 опубликованные копии**. Без seed,
business-данные сохранены; сервер/браузеры закрыты, порт 5343 свободен, DB other 0.
Квитанции: `.builder/native-qa40-reliability-v10-20261023/summary.json`
(SHA256 `a8ae45d9798781309d4a0a6f973c0315ff03a8e0f1da54bcb80e04fd4be2427e`)
и `.builder/world-perf-20261022/reliability-v10-build-summary.json`.

**Full24, новый exact-head CI, merge и deploy — PENDING.**
[Переносимый preflight v10](evidence/city-scale-2026-10-23/reliability-v10-preflight.json).
[Подробности текущего среза](QA-TASK-FOCUS-2026-10-22.md).
Исторические bindings ниже не переименовываются в v10.

## Историческая точка 23 октября 2026 — v9, визуальная приёмка была открыта

Локальный v8 (`60bbf1f1…`) завершил адресную native-серию **13/13 PASS,
41,4 с**, с эмулированными Pixel/iPhone и панелью 320/390px. Это не результат
полного CI. [CI `39866777088`](https://github.com/afkbot-io/tasktopia/actions/runs/39866777088)
точного HEAD `704818ee2d7327693e1d0b85cd1d28cfc4246b00` окончательно завершился
**FAIL во всех четырёх browser shards**; пропуски и не начатые кейсы не засчитаны.

Новый v9 учитывает в физике реальный `ticker.elapsedMS` с пределом 250 мс:
не более **5 × 50 мс** последовательных шагов, без изменения предела 50 мс
для эффектов и TTL комментария. Публичный RED со старым пределом закрыт **9/9 GREEN**;
адресные проверки физики, подготовки и доставки — **55 PASS / 6 SKIP**
в шести файлах, без запуска прежних длинных горизонтов. Уже опубликованный
CITY сохраняет canvas/Retry при отказе PNG. Наблюдатель фаз сноса
перенесён после `goto`/фокуса и проверяет реально опубликованный `COVER`
с прежним сроком ожидания. Независимое AI-ревью `54aa9606…` не имеет открытых замечаний.

Source v9 — `a5e40775a43603a7ec0ad47fef671cfa7d6654b5ba9ec39ea050f896176f6c3c`.
Ровно одна стандартная сборка с полным TypeScript и readonly-проверка
первоначальных городов 200/1000 — **PASS**; геометрия сохранена, проверка
выполнялась только на чтение, без seed/restore. Квитанция:
`.builder/world-perf-20261022/reliability-v9-build-summary.json`.
V9 native: **16/16 PASS за 122,999 с**, без SKIP/flaky — 6 Chromium,
4 эмулированных Pixel, 3 эмулированных iPhone и 3 ранее упавших WebKit-сценария.
Исходный DPR сохранён, seed не запускался, business-данные fixture не изменились;
собственные браузеры/сервер закрыты, порт 5343 свободен, других соединений
с собственной БД — 0. Квитанция:
`.builder/native-qa40-reliability-v9-20261023/summary.json`.
Визуальная приёмка ожидает разбора исчезновения построек при отказе PNG;
16 PASS не подтверждает сохранение всей entity-сцены.
**Full24, новый exact-head CI, merge и deploy — PENDING.**
[Подробности текущего среза](QA-TASK-FOCUS-2026-10-22.md).
Ниже сохранены исторические контрольные точки с исходными bindings;
локальные PASS не переименовываются в итоговую CI/performance-приёмку.

**Контрольная точка v7 перед новым CI и scale-проверкой, 23 октября:**
единственная сборка и полный TypeScript — PASS. Source hash —
`80b3015a0c1d5f791351290131e816d000c0c32c720beee3cad3612365466b69`.
MCP client/server/core зафиксированы на 2.3.0, Vite — 8.2.4; audit:
high 0, critical 0, moderate 6. Остаточные предупреждения проверены по исходникам
без открытых замечаний. Адресная MCP-регрессия — **33 PASS в 5 файлах**:
все 50 инструментов вызваны через настоящий HTTP; сложность входа 10000
принимается, 10001 отклоняется. Compiled MCP smoke новой сборки — PASS: modern/legacy, все 50 инструментов в каталоге, auth/scopes/revocation и границы сложности; business-данные fixture не изменены.

После Vite/Rolldown клиентский JavaScript изменился: 41→36 chunks. Три CSS-файла
побайтно совпадают, игровые assets `0c759074…` сохранены; 1260 runtime inputs
совпадают, изменены package/lock и MCP server. **Performance-приёмка v6 не
переиспользуется для v7.** Новая исходная серия: 4 профиля × 200/1000 × 3 samples,
всего 24; на этой точке она и новый exact-head CI — PENDING. Равенство server
bundle само по себе не доказывает применимость после изменения external dependencies.

CI `39864375087` ревизии `a22a23a5…` завершился FAIL на dependency audit:
build/unit/recovery прошли, MCP/browser — SKIPPED, `test` — FAIL. Пропущенные
проверки не считаются PASS. Закрыто 29/33 критериев; E01/E02/Q02/Q03 ожидают
CI/выпуска. [Фиксированные результаты security-preflight](evidence/city-scale-2026-10-22/task-focus-security-v7-preflight.json);
итоги последующей scale/CI и выпуска публикуются в задаче №53 и PR58.

**Историческая контрольная точка v6 перед CI на 23 октября: кандидат v6 заморожен; сборка/full TypeScript — PASS.
Performance-приёмка: 21 фактический PASS v5 переиспользуется с исходными
привязками, три новых Pixel1000-замера v6 — STRICT PASS. Это не новая полная
матрица 24 v6. На этой точке итоговый CI и выпуск ещё предстоят; их фактический результат публикуется в задаче №53 и PR58.** Source hash v6 —
`4173045433eb24e2b9e85d9a72270cb25b06d740c879b9f9e9302e712816e717`;
client `d92d2761…`, HTML `d3bc6db5…`. Server `dae136ca…` и игровые assets
`0c759074…` совпадают с v5; 1262 из 1263 runtime inputs не изменены.
В единственной изменённой строке `dispatchResponse` конечный BFS получает
единственную цель; маршруты и ограничения сохраняются, multi-target остаётся
полным поиском. TDD: три work-only RED BUS/SCHOOL_BUS/FIRE → **51 PASS/6 файлов**,
scoped TypeScript/ESLint и независимое source-review без открытых замечаний.
Диагностический trace v5 имеет leading gap 21,128 мс; событие 747 мс — запуск
CPU-profiler. Локальный 89,042-мс main-JS/RAF фрагмент включает BUS/SCHOOL_BUS
и маршрутизацию, но не атрибутирует исходный 61-мс longtask.
Полная серия v5 сохраняется историческим **STRICT_RED**: 24/24 функционально,
один Pixel1000 steady longtask 61 мс при бюджете 0; raw/portable не изменяются.
Прежние CPU4/network/DPR/NORMAL/steady8s/churn20 и бюджеты новых трёх samples
сохранены без retries/удаления выбросов. Cold — 9847,141/9511,834/8615,849 мс
при бюджете 12000 мс; steady longtasks 0/0/0, ошибок 0. Первый host preflight
остановился до браузера (0 samples); отдельный ручной preflight после изменения
нагрузки прошёл за 54,031 с с прежними условиями. Старые результаты сохранены.
[Раздельная итоговая сводка 21v5+3v6](evidence/city-scale-2026-10-22/task-focus-v6-summary.json).
После расширения цели закрыто 29/33
критериев: U08 проверен, U09 визуально принят после отдельного кадра видимого
world glyph; остаются E01/E02/Q02/Q03.
R02 закрыт после исправления владельцев retry
и адресной native-проверки восстановления зависшего обновления. Сборка и
полная типизация кандидатов 22 октября — PASS;
нативные серии v1 11/11 и пересекающаяся v2 3/3 сохранены отдельно. Для длинной
мобильной панели исправлены высота/прокрутка. Native v3: 9 PASS / 1 FAIL;
iPhone остановился на обычном Tab; отдельный разбор подтвердил достижение Album
через Alt+Tab. V4 содержит только CSS-исправления desktop-легенды и короткой
landscape-панели; остальные 1262 входных файла и JavaScript совпадают с v3.
Native v4: **2 PASS / 1 FAIL** — desktop и Pixel portrait/landscape прошли;
iPhone прошёл bounds/Alt+Tab/scroll, но ratio полной видимости Album составил
0.9911221862 вместо 1. Диагностика локализовала обрезку 0,390625px и подтвердила
ratio 1/открытие альбома после настоящего PageDown. Полный исправленный
iPhone-сценарий завершён отдельно: **1 PASS / 0 FAIL, 7,3 секунды**, включая
portrait/landscape, строгий ratio 1 и два настоящих альбома. Runtime v4
не изменён; прежний FAIL сохранён. Desktop/Pixel PASS переиспользуются
отдельно, это не новая единая серия из трёх сценариев и не 12 уникальных
проверок. Независимый просмотр пяти desktop/Pixel и двух новых iPhone PNG
не выявил дополнительных визуальных замечаний. Business-state hash и fences
исправленного запуска сохранены, браузеры и сервер закрыты.
В v3 вошли три проверенные по исходникам оптимизации: геометрия границы района,
резидентный индекс terrain и требования к ресурсам.
Историческая незавершённая серия v4 завершила 12 замеров на 200 задачах и три Chromium1000.
Firefox1000 sample 0 остановился на `mobilityReady:null` через 90 секунд
после atomic/ground queue 0; Pixel1000 и iPhone1000 не начинались.
Сохранены три cold-превышения: Chromium200 — 1758,58 > 1500 мс;
Pixel200 — 6088,669 и 6025,17 > 6000 мс. Во всех 15 завершённых замерах
геометрия, HTTP и canvas сохранены; зарегистрированных ошибок нет, но
`errors[]` не охватывает сообщения console об обработанных ошибках. Отказ Firefox1000
сохраняется отдельно; полная серия не пройдена. Сторонняя нагрузка хоста
не доказана как причина превышений, отказы не снимаются.
[Фактическая сводка v4](evidence/city-scale-2026-10-22/task-focus-v4-summary.json).
Единственная диагностика Firefox1000 завершена: функциональный PASS одного
sample, canonical 1000/72 и движение готовы; исходный timeout не воспроизведён
и остаётся неразрешённым. Cold 3911,511625 > 3000 мс под инструментацией
и наблюдавшейся нагрузкой — RED, не новая квалификация и не 16/24.
Console: 0 ошибок/6 предупреждений, включая context-lost до ambient;
причинного вывода нет. [Диагностическая сводка](evidence/city-scale-2026-10-22/task-focus-v4-ff1000-diagnostic.json).
V5 исправляет отдельный подтверждённый дефект стирания ошибки после pan:
native RED(v4)→GREEN(v5), ровно 1 PASS/4489 мс, test SHA `69364b1f…`.
Это не заявленное исправление причины исходного 90-секундного зависания.
Его отдельный resource probe: **4/4 PASS**, p95 20 настоящих переключений
на случай — 20,5/36 мс (200 Chromium/iPhone), 25,7/38 мс (1000), бюджет 100 мс.
Canonical/геометрия/canvas сохранены, scene/chunk HTTP 0, atlas 2904 bytes
и Sprite/Texture/source переиспользуются; owned cleanup/freeze fence PASS,
5367 свободен. [Фактическая сводка v5](evidence/city-scale-2026-10-22/task-focus-v5-resource-summary.json).
Просмотрены 12 PNG без новых замечаний; resident world badge bounds в этих
кадрах вне viewport. Отдельный corrected iPhone1000 visible-glyph сценарий
завершился PASS: 4 native mouse-pointer pan при прежнем 24/45s пределе,
строгие visibility/ownedbuilding/alpha1→0,16→1/scale0,8→0,95777/geo/canvas
assertions прошли. Первый неуспешный harness-precondition запуск сохранён,
дефект приложения по нему не заявлен. Все пять новых PNG просмотрены основным
агентом: world glyph принят без открытых замечаний, U09 закрыт.
[Отдельная видимость world glyph](evidence/city-scale-2026-10-22/task-focus-v5-visible-world-badge-summary.json).
Platform-alpha здесь unit-only; DOM scroll не выдаётся за trusted touch scroll,
page/HTTP errors 0 не означает полного console-аудита. Полная нагрузочная
серия v5 завершила 24/24 без функциональных отказов и нарушений геометрии,
HTTP/canvas, но остаётся STRICT_RED из-за одного 61-мс steady longtask
Pixel1000 при прежнем бюджете 0 longtasks. Отдельный trace-разбор не
атрибутировал исходный 61-мс longtask; отдельная приёмка v6 выше завершена.
Resource/visual PASS не заменяет performance-приёмку.
[Полная сводка v5](evidence/city-scale-2026-10-22/task-focus-v5-summary.json).
Нагрузочная серия `v2`
завершена: 24/24 замера, три cold-превышения, функциональных ошибок нет;
строгая performance-приёмка не пройдена. [Все результаты и ограничения](evidence/city-scale-2026-10-22/task-focus-summary.json).
[Фильтры, значки работ и границы новых проверок](QA-TASK-FOCUS-2026-10-22.md).
CI исторической ревизии `c9eeee27` завершился с отказами; его успешные отдельные
jobs не означают прохождения всего CI или проверки текущего source-среза.

**Историческая локальная квалификация runtime `03fc2d72`.** Он завершил
полную серию `final-v4`: 36/36 запусков без функциональных
ошибок и нарушений геометрии, запросов или идентичности canvas. В 11/12
профилях прошли исходные ограничения; три cold-превышения Firefox200 сохранены
в историческом отчёте. Причинный замер воспроизвёл задержку обнаружения готового
DOM автоопросом Playwright. Исправленная версионированная методика сохраняет
прежнее начало и бюджет, учитывает консервативную границу часов и отдельно
хранит Node-счётчик. Парные 3 baseline + 3 candidate Firefox200 прошли все
ограничения. Новая медиана 1306,8 мс против 1217,9 мс (+7,3%); диапазоны
перекрываются, ускорение этого профиля не заявляется.

Принята комбинация 11 прежних консервативных upper bounds и отдельной пары v2;
это не новая матрица 36 v2. [Методика, результаты и ограничения](QA-CITY-SCALE-2026-10-16.md).
Исторические RED v2/v3/v4 сохранены. На этом этапе было закрыто 27/31 критериев. Итоговый SCM SHA,
обязательный CI, managed merge, свежий backup, опубликованный smoke и
наблюдение 300 секунд ещё не выполнены; они фиксируются в итоговой записи задачи.

## Связь критериев с доказательствами

Сохранён отдельный [offline console-review v5 с ограниченной атрибуцией feature probe](evidence/city-scale-2026-10-22/task-focus-v5-console-review.json).

| Критерии | Проверенная граница | Доказательство и ограничения |
| --- | --- | --- |
| R01 | Последовательное восстановление событий; отказ второй страницы до commit live-буфера | `realtime-replay.test.ts`, `realtime-replay-recovery.spec.ts`; browser с настоящим Socket.IO и контролируемым HTTP503 |
| R02, P02–P04, P06 | Bounded refresh, content signatures, целый canonical snapshot, viewport/halo, camera fence, depth/metrics | Renderer pure/native regression и frozen200/1000; актуальные FIRSTatomic/phone5s — 6/6 в трёх движках, полная v4 и отдельная пара v2; предыдущие owner/fault проверки переиспользуются при неизменённых inputs |
| R03–R06, E03 | Lease/recovery/fairness, Socket session, Redis deadlines, lifetime task counter | [Backend QA](QA-BACKEND-RELIABILITY-2026-10-16.md): 181 уникальный тест в 27 файлах, три прогона с переиспользованием неизменённых результатов |
| P01 | Адресная инвалидация городов/стран и смежных transport ends | `city-scene-invalidation.test.ts`, `map-invalidation.test.ts` и интеграция scene cache; география не перегенерируется |
| P05, U04 | Compact MCP, bounded owned caches, Card, lazy collections50, документы, реальные зависимости/разрешённая хроника | Backend HTTP/SDK; `task-card-paging.spec.ts`: 1000 comments fixture, 503/retry и WS rename/delete соседней dependency; новые контракты не заменяют прежний full DTO |
| P07, U07 | Progressive auth art, password toggle, связанные ошибки/фокус/retry | [Auth QA](QA-AUTH-RELIABILITY-2026-10-16.md): 49 браузерных проверок и 15 pure; физические устройства не использовались |
| U01 | A→B→Back/Forward, CITY pose, direct links, cancellation, auth/scope fences | [Navigation QA](QA-NAVIGATION-SCOPE-2026-10-16.md) и финальная общая матрица ниже |
| U02 | Явное прочтение, paging, grouping, возврат и новые события во время ACK | [News QA](QA-NEWS-FEED-2026-10-16.md): 30 успешных сочетаний сценарий/профиль с указанным переиспользованием; footer320 RED→GREEN5 |
| U03, U05 | Каталог50, paging/filters/context, keyboard map, доступ без canvas-click | [Catalog QA](QA-TASK-CATALOG-2026-10-16.md) и [World observation QA](QA-WORLD-OBSERVATION-2026-10-16.md) |
| U06 | Opt-in audio, trusted gesture, voice cap и немедленное mute/cleanup | `city-audio.test.ts`; общий bell использует тот же владелец звука |
| G01–G03, G05 | Конкретные AIR/RAIL/SEA, добровольный follow/tour, реальные дорожные сцены и распорядок | [World observation QA](QA-WORLD-OBSERVATION-2026-10-16.md); жизнь/качество включены и в performance-измерениях |
| G04 | Ограниченные реальные вехи, comparison, deleted-task state, paging/error/focus | `city-album-presentation.test.ts`, `city-album.spec.ts`, [дизайн навигации](DESIGN-WORLD-NAVIGATION-2026-10-16.md) |
| E01 | Разделённые владельцы state/cleanup и изолированные CI границы | Type/lint и focused/native результаты; новый `.github/workflows/ci.yml` ещё должен пройти на итоговой ревизии |
| E02 | Private operator diagnostics, bounded query metrics, normal shutdown, публичный asset gate | [Runtime observability](RUNTIME-OBSERVABILITY-2026-10-16.md); настоящие local children4roles и public-gate6pure; реальный новый public release ещё не выполнен |
| Q01 | Те же точные200/1000, geometry hashes, NORMAL/life=true,3samples/profile | [Scale QA](QA-CITY-SCALE-2026-10-16.md): полная v4 сохраняет 36 functional PASS и historical RED3; 11 legacy conservative PASS плюс отдельная сопоставимая пара Firefox200 v2 закрывают бюджеты |
| Q02 | Native browser functional/visual матрица и emulated phones | Результаты ниже; полная обязательная SCM матрица ожидает итогового кандидата |
| Q03 | Exact SHA, SCM/Builder, fresh backup и публичная работоспособность | Ожидается после обязательного CI; ранний read-only recovery preflight не является выпуском |

## Общий production UI-кандидат

На `final-candidate-v1` выполнено **70/70 PASS**, 2,9 минуты: 14 сценариев
в Chromium, Firefox, WebKit, Pixel Chromium и iPhone WebKit. Это Album2,
navigation scope2, session2, Card2 и history6. Проверены реальные logout/login,
прямой возврат в карточку, delayed lazy/card/scene responses, cancel и два
повторных Back/Forward. Для pagination/error races используются изолированные
HTTP ответы; аутентификация, навигация и Socket.IO остаются настоящими.
Native PNG старого/нового состояния и320px comparison просмотрены, Axe/focus
прошли в проверенных панелях. Результат не означает Axe-аудит всех страниц.

На том же production bundle дополнительно **15/15 PASS**, 57,4 секунды:
AIR/RAIL/SEA, ROAD и keyboard/tour в Firefox, WebKit и iPhone WebKit.
Отдельные прежние Chromium/Pixel проверки перечислены в профильном отчёте.
Это не ещё одна полная пятибраузерная G-матрица.

Отдельная сверка плана добавила три проверки размеров и квитанций P05:
HTTP Card 3063/3065/3066 байт при 0/100/1000 существующих комментариях,
compact command 1018 байт и receipt 149 байт во всех трёх точках.
Весь затронутый контрактный файл прошёл 14/14; повторены только три точки
для записи чисел. [Точные границы измерения](evidence/task-read-sizing-2026-10-16/summary.json).

Хроника задачи U04 проверена отдельным браузерным сценарием: **2/2 PASS**
в Chromium и iPhone WebKit. Настоящие Card и events page сохраняют IDs,
количество и cursor; первая запись контролируется для разрешённых и
запрещённых изменений. Проверены четыре before→after строки, настоящее имя
аккаунта, отсутствие UUID/Markdown/internal полей, один lazy GET limit50 и
переносы на телефоне. Это хроника данных задачи; прежние history6 выше
проверяют историю навигации. [Сводка U04](evidence/task-history-2026-10-16/summary.json).

`final-v1` и `final-v2` имеют одинаковые compiled server/client bytes:
server `dae136ca64c93bbc7d0dfac2a675c38ed5edc800d895a5a78af7f4ed48c61937`,
client aggregate `ef5749e52e0aeb57af0b157f7af2f10ea06d622b4fb27a4fb6f37547e6cd02ae`.
Единственное source-различие frozen snapshots — число50 в `public/ai.md`.
Последующая нормализация одного EOF и адаптация legacy E2E не выдаются за
байтовое равенство всего editable source. Последующие кандидаты имеют отдельные
compiled hashes и затронутую квалификацию, перечисленную ниже.

После `final-v2` подготовка полного WALK/дорожного графа и распорядка разбита
на отменяемые короткие задачи. Независимое сравнение с `053e061d` на тех же
точных городах200/1000 сохранило дороги, порядок, маршруты, сигналы, остановки,
жителей и seeded motion. В первом кадре готов весь канонический снимок,
видимая земля, внешний фон, дороги и полный набор видимых/halo объектов.
Невидимая земля halo подготавливается после публикации через ту же ограниченную
очередь. Текстуры земли получают первые сетевые слоты перед декорацией.

Native-квалификация развивается по фиксированным кандидатам; эти числа не
складываются в один новый прогон:

| Кандидат | Результат | Проверенная граница |
| --- | --- | --- |
| `651a6e07` | 9/9 PASS | Исходный срок готовности телефона, отмена/возврат, настоящий defect update во время подготовки |
| `831102cf` | 18/18 PASS | Предыдущие сценарии и настоящие worker-ответы: overlap, поздняя работа после отказа, общий pending decode при retry500мс |
| `353bf444` | 21/21 PASS, 2,5мин | По семь сценариев в Chromium/Firefox/iPhone WebKit; дополнительно первый atomic кадр, независимая непрерывная геометрия viewport, полный canonical/entity набор, завершение halo и pan без HTTP |
| `934cac5a` | 6/6 PASS, 33,4с | После единственного переноса prefetch повторены первый кадр и прежний пятисекундный срок готовности/движения, те же три браузера |
| `03fc2d72` | 6/6 PASS, 30,3с | После исправления idle Graphics и статической дорожной подготовки повторены FIRSTatomic/full sources/pan и прежний phone5s в тех же трёх браузерах |

Оба worker-отказа сначала воспроизведены RED, затем закрыты GREEN без изменения
задержки retry. Дробные правый/нижний края CITY и внешнего фона имеют настоящие
RED/GREEN регрессии; **47/47** проверок в четырёх pure-файлах прошли. Ошибка
painter order также закрыта через публичные `zIndex` setters: **5/5** проверок
на настоящем Pixi `Container`/render group, включая добавление, удаление и
следующее пересечение. Статический кадр не инвалидирует структуру.

Снимки трёх движков просмотрены: пустых тайлов и швов в проверенных кадрах нет,
пиксельный стиль сохранён. Проверка исходных performance-бюджетов выполняется
отдельно и не выводится из native PASS. Все промежуточные RED, точные hashes и
[границы сравнительного доказательства](evidence/city-scale-2026-10-16/cooperative-preparation-summary.json)
сохранены.

`final-v3` сравнивает ровно те же200/1000 с базой053e: медиана открытия1000
в Chromium2336→1612мс, Pixel15189→8090мс. Отслеживаемый RGBA estimate1000
сократился примерно на47% на desktop и82% на телефонах. Это не измерение VRAM.
Улучшение медиан не отменяет четыре отказа; [полная парная сводка](evidence/city-scale-2026-10-16/final-v3-summary.json)
хранит каждый исходный sample и все неизменённые budgets. Ненулевые exitcodes
driver/compare сохранены, этот кандидат не объявлен готовым к выпуску.

В `03fc2d72` пустой Pixi Graphics больше не посылает обновление каждый idle
кадр; активный эффект по-прежнему очищается при завершении. Статическая
геометрия дорожных событий строится вместе с сетью, а текущие перекрытия,
занятость и доступность служб проверяются при событии. Адресные наборы прошли
31 и 39 проверок соответственно; они не складываются с повторными прогонами.
Расширенное сравнение на точных 200/1000 подтвердило целый core и восемь
упорядоченных дорожных состояний для каждого города относительно CBD и053e.
Все 129 inputs до/после совпали. [Доказательства и hashes](evidence/city-scale-2026-10-16/cooperative-preparation-summary.json).

Полная v4 и последующая парная квалификация measurement-v2 описаны в начале
отчёта. [Сводка v2](evidence/city-scale-2026-10-16/cold-measurement-v2-summary.json)
сохраняет все шесть наблюдений, обе метрики времени, версии контрактов и
ограничения переиспользования 11 прежних консервативных результатов.

## Данные, безопасность и границы

Управление работой остаётся в MCP с явным countryId. В UI нет создания,
назначения, редактирования или переключения рабочих стадий. Настройки,
авторизация, ссылки и явное прочтение уведомлений сохраняют свои controls.

Реальный SDK/HTTP контрактный набор вызывает все50 MCP tools; отдельный
собранный runtime smoke проверяет initialize/auth/capabilities/resources,
scope/revocation и error handlers. Эти разные доказательства не объединяются
в утверждение, что compiled smoke сам выполнил50 успешных CRUD.

Миграции0043/0044 additive. Свежий локальный restore существующего backup
от13октября и совместимость старого runtime проверены без удалённых изменений;
46 прежних таблиц/последовательности сохранены, world audit нарушений0.
Официальный updater всё равно должен создать новый pre-deploy backup.
После записей нового runtime image rollback сохраняет текущую БД, а не
откатывает новые пользовательские данные к старому dump.

Исторический dependency audit этого среза: high/critical0, moderate6; тогда зависимости не добавлялись. Актуальное обновление SDK/Vite описано в контрольной точке v7 выше.
Браузерная эмуляция не доказывает работу конкретного физического телефона,
батарею или все GPU. Input second-RAF proxy не называется INP, RGBA estimate
не называется VRAM, три cold samples дают median/range, а не loading p95.
Личные URI, токены и сырые производственные данные остаются в ignored0600
артефактах и не включены в репозиторий.
