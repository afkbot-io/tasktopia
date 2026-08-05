# QA

## Preconditions

- Тестовая PostgreSQL.
- Детерминированная страна с одним городом, парком, переходом и несколькими районами.

## Positive scenarios

1. Зафиксировать agent IDs/positions, pan и zoom DETAIL → DETAIL: сохранившиеся в viewport IDs продолжают движение.
2. Reload: session seed и стартовый набор координат меняются, лимиты сохраняются.
3. Наблюдать машину на прямой, T- и X-перекрёстке: нет U-turn при альтернативе, маршрут не зациклен на одном узле.
4. Пешеход проходит CROSSWALK; машина ждёт занятую клетку.
5. Самолёт появляется редко, один, выше world layers; reduced motion его отключает.
6. Удалить задачу, район, город: сущность и локальная геометрия исчезают, соседние данные остаются.
7. Перегенерировать: IDs, тексты, статусы, comments/events прежние; seed/геометрия/декор новые; клиент получает одно обновление.

## Negative scenarios

- Viewer получает 403 на mutations.
- Неверное подтверждение не меняет мир.
- Ошибка во время regeneration откатывает seed и всю геометрию.
- Offscreen/hidden canvas останавливает ticker и не накапливает delta.

## Logs and audit

- Console без ошибок Pixi/Assets/CSP.
- `data-movement-rebuilds` не растёт при обычном pan.
- Agent/ambient/airplane counters не превышают лимиты.
- Контейнеры и память возвращаются к baseline после route cycle.
