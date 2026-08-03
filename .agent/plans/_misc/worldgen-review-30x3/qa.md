# QA

## Preconditions

- Чистая SQLite база.
- Country seed `424242`.
- Asset pack V4 собран.

## Positive scenarios

1. Создать три города, поочерёдно создать три района в каждом.
2. Добавить по десять задач в район; распределить статусы по пяти стадиям.
3. Открыть каждый город через кнопку «Города», осмотреть районы на обычном масштабе.
4. Отдалить карту до минимума и перемещаться до четырёх границ.
5. Открыть по одному зданию каждой стадии и проверить task modal.

## Negative / invariant scenarios

- Нет district/task/road overlap.
- Нет изолированного района или отдельного компонента национальной дороги.
- Нет моста на суше.
- Нет здания без доступа к дороге.
- Capacity каждого района не превышена.

## Logs and performance

- Browser console: 0 `error`, 0 unhandled rejection.
- Network: chunk requests 2xx, resident chunks ограничены.
- Fixture generation < 30 s; 12 chunks < 2 s.

## Expected result

Три визуально разные, более плотные города с тремя цветными районами и 30 зданиями каждый; дороги образуют понятную сеть и не режут здания.

## Result — 2026-08-03

- PASS: clean fixture `3 / 9 / 90`, violations `0`.
- PASS: 10-seed soak `10/10`.
- PASS: Playwright `2/2`, console errors `0`; desktop screenshots reviewed.
- PASS: scale `10 городов / 80 районов / 250 задач`.
- PASS: local demo audit and running dev server at `http://localhost:5273`.
