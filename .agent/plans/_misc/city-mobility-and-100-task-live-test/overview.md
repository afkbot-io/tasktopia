# City mobility and 100-task live test

## Goal

Проверить текущий город при пошаговом росте до 100 задач и сформировать исполнимую архитектуру улиц, тротуаров, пешеходных подходов, машин и менее навязчивого отображения районов.

## Scope

- Design critique текущего desktop-скриншота.
- Отдельный deterministic fixture: один город, пять районов, 20 задач на район.
- Снимки промежуточных состояний 20, 60 и 100 задач.
- Проверка расширения района/города, дорожной связности, footprint, производительности и визуальной плотности.
- Целевая модель road carriageway / sidewalk / pedestrian path / entrances / mobility graph.

## Non-goals

- Реализация полноценной симуляции населения и трафика в этом тестовом шаге.
- Перерисовка ассетов машин и людей.
- Миграция SQLite или изменение MCP-контракта.

## Acceptance criteria

1. Отдельная база создаёт один город, 5 районов и ровно 100 задач через публичные методы `AppService`.
2. Зафиксированы состояния после 20, 60 и 100 задач с метриками и desktop-скриншотами.
3. После каждого шага нет пересечений task/road/district, изолированных дорог и задач вне city bounds.
4. Измерены city/district growth, число дорог, участков, типов зданий, время генерации и загрузки чанков.
5. Для каждого здания измерен автомобильный и пешеходный доступ; отсутствие frontage классифицировано отдельно от допустимого короткого pedestrian path.
6. Результат содержит приоритетный интерфейсный и game-design backlog.

## Current status

Complete — live-test executed; two blocking mobility/growth findings documented.

## Risks

- Текущая модель хранит только road cells и не хранит sidewalk/entrance graph.
- Лимит 26 SP требует специального распределения 20 задач внутри района.
- Пять районов могут показать city expansion, но не пределы очень долгоживущего единственного sprint.

## Finish checklist

- [x] 20/60/100 fixture states generated and audited.
- [x] Screenshots reviewed at desktop scale.
- [x] Growth and accessibility findings documented.
- [x] Target road/pedestrian architecture documented.
- [x] Temporary test servers stopped; active user server preserved.
