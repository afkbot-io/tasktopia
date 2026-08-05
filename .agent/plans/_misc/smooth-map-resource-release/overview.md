# Smooth map and shared-resource release

## Goal

Убрать пустые кадры и запросный шторм карты, сделать управление очевидным и выпустить Tasktopia с безопасным ресурсным бюджетом рядом со вторым Docker-проектом.

## Scope

- Progressive/double-buffer загрузка чанков и текстур.
- Ограниченный клиентский cache по координатам и LOD, дедупликация и устойчивое переключение LOD.
- Loader до первого фактически нарисованного кадра и понятное состояние догрузки.
- Доступные активные состояния «План» и «Границы районов».
- Быстрое первое открытие управления страной.
- Docker CPU/RAM limits для Tasktopia и проверка совместной работы обоих проектов.
- Production-сборка, браузерная проверка, документация, backup и deploy.

## Non-goals

- Замена PixiJS или PostgreSQL.
- Увеличение тестового мира сверх 1 города / 10 районов.
- Изменение доменной модели и генератора мира.
- Изменение лимитов второго проекта без доказанной необходимости.

## Acceptance criteria

1. Loader остаётся до первого ground frame; пользователь не видит пустой canvas после него.
2. При задержке chunk API 450 мс быстрое перемещение не удаляет уже видимый ground до готовности замены.
3. Чанки рисуются постепенно; один медленный запрос не блокирует всю пачку.
4. Возврат к недавно просмотренному диапазону и LOD не создаёт повторной серверной загрузки каждого чанка.
5. В свежей вкладке нет CSP и Pixi cache warnings.
6. Canvas ticker останавливается вне viewport/hidden и корректно освобождается при unmount.
7. Кнопки имеют pointer cursor, hover/focus и видимый `aria-pressed` state; «Районы» переименованы по фактическому действию.
8. Первое открытие управления страной визуально начинается сразу и не скрыто `fallback=null`.
9. Tasktopia app/PostgreSQL имеют cgroup budgets; оба проекта остаются healthy при ограниченном совместном smoke.
10. Unit, lint, typecheck, build, production E2E, delayed-network regression and MCP smoke pass.

## Current status

Диагностика завершена; реализация начата.

## Risks

- Двойной buffer может временно увеличить GPU/JS memory; cache должен быть жёстко ограничен.
- Слишком агрессивный prefetch снова создаст запросный шторм; приоритет — видимые чанки, затем небольшой directional buffer.
- Docker limits не должны снижать latency карты; проверяется до и после deploy.

## Finish checklist

- [ ] Реализация и regression tests.
- [ ] Browser performance proof.
- [ ] Resource limits и совместный smoke.
- [ ] Code/stale/docs review.
- [ ] Backup, GitHub, production deploy и post-deploy smoke.
