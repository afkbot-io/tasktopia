# Веб-интерфейс и realtime UX

## Граница интерфейса MVP

Веб — это просмотр и исследование. Через него нельзя создавать проекты, спринты или задачи. Исключения:

- регистрация/вход/выход;
- создание, просмотр метаданных и отзыв MCP-токенов;
- локальные настройки камеры, звука и accessibility.

## Routes

- `/login`
- `/register`
- `/` — текущая страна и карта
- `/settings/integrations` — MCP endpoint, token create/copy/revoke, scopes
- `/settings/account`

Проект, sprint и task могут иметь shareable query/deep links (`/?project=...&task=...`), но карта остаётся основной страницей.

## Карта

### Header

- country name;
- online/reconnecting indicator;
- дата/локальное время мира как декоративное, не бизнес-состояние;
- project/sprint/task counters;
- кнопка интеграций.

### Sidebar

- список проектов/городов;
- внутри выбранного проекта — sprint list;
- active sprint выделен;
- status/counts, без `+` и edit controls;
- поиск по задаче/проекту с фокусировкой камеры.

### Camera

- wheel/pinch zoom;
- drag pan;
- fit country-known-area;
- focus selected city/sprint/task;
- bounds отсутствуют у мира, но zoom имеет min/max;
- camera state сохраняется локально и на сервере с debounce;
- reduced motion отключает плавные пролёты.

## Выбор здания

1. PixiJS hit area выбирает building id.
2. Renderer включает highlight, но не хранит task details.
3. React открывает DOM modal и при необходимости запрашивает task.
4. URL получает `task` query parameter.
5. WebSocket room `task:{id}` подключается на время открытой модалки.

## Task modal

### Header

- title;
- external key;
- project → sprint breadcrumb;
- status и progress;
- building type/visual stage.

### Body

- description;
- estimate `1|2|3|6`;
- priority;
- due date;
- created/updated timestamps;
- comments timeline;
- transition history;
- MCP actor label у AI-комментариев.

### UX rules

- read-only в MVP;
- focus trap, Escape close, восстановление фокуса на canvas selection proxy;
- loading skeleton только для detail section, не для всей карты;
- optimistic visual progress не нужен: UI получает committed event;
- если task deleted/archived externally, modal показывает final tombstone state;
- длинные комментарии сворачиваются, но полный текст доступен.

## Realtime client state

- Query cache хранит entity DTO.
- Chunk store находится отдельно от React query cache.
- Event reducer проверяет aggregate version.
- Дубликат event id игнорируется.
- Gap вызывает snapshot reconciliation.
- `chunk.invalidated` помечает chunk stale; загрузка происходит только если он видим или находится в prefetch margin.
- Building stage может анимировать короткий transition, но authoritative sprite меняется сразу.

## WebSocket rooms

- после auth: `country:{countryId}`;
- при фокусе города: optional `project:{projectId}`;
- при task modal: `task:{taskId}`.

Сервер не принимает country id из клиента без authorization check.

## Loading states

- initial: shell + country bootstrap skeleton;
- chunk: terrain placeholder одного нейтрального цвета, затем fade до 120 мс;
- city generation: reserved area + operation marker;
- building assignment: empty reserved footprint + planning sign;
- reconnect: карта остаётся доступной, mutations всё равно идут через MCP; сверху badge `Обновление соединения`;
- unrecoverable: snapshot reload без полного browser refresh.

## Accessibility

- canvas имеет DOM-панель выбранного объекта;
- sidebar/search позволяют открыть любую сущность без pixel-perfect клика;
- status не кодируется только цветом;
- modal полностью клавиатурная;
- контраст текста WCAG AA;
- `prefers-reduced-motion` останавливает camera fly и construction particles;
- декоративные звуки выключены по умолчанию до user gesture.

## Performance budget

- renderer запускается только на карте;
- вне видимости вкладки ticker ставится на паузу;
- offscreen chunks удаляются из scene graph и LRU;
- spritesheets используются вместо отдельных texture uploads;
- filters/masks не применяются на каждый гекс;
- city/sprint perimeter — небольшой Graphics object на loop, а не сотни масок;
- dynamic text в canvas минимален; основной текст в DOM;
- interactiveChildren=false для неинтерактивных chunk containers;
- hitArea задаётся только зданиям/важным объектам;
- FPS, visible sprites, loaded chunks и texture memory доступны в dev overlay.

